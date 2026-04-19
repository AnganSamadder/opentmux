#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(dirname "$(realpath "$0")")
REPO_ROOT=$(realpath "$SCRIPT_DIR/../..")
EVIDENCE_DIR="$REPO_ROOT/.sisyphus/evidence/tui-hijack"
SIGINT_LOG="$EVIDENCE_DIR/opencode-attach-strace.log"
SIGTERM_LOG="$EVIDENCE_DIR/opencode-attach-strace-sigterm.log"
SERVER_LOG="$EVIDENCE_DIR/opencode-serve-4199.log"
PORT=4199
HOST=127.0.0.1
SERVER_URL="http://$HOST:$PORT"
PLATFORM=$(uname -s)

mkdir -p "$SCRIPT_DIR" "$EVIDENCE_DIR"

OPENCODE_PATH=$(which opencode 2>/dev/null || true)
OPENCODE_VERSION=$(opencode --version 2>&1 || true)
ATTACH_HELP=$(opencode attach --help 2>&1 || true)
STRACE_PATH=$(which strace 2>/dev/null || true)
export ATTACH_HELP

if [[ -z "$OPENCODE_PATH" ]]; then
  printf 'opencode not found on PATH\n' >&2
  exit 1
fi

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT

timeout 30 opencode serve --port "$PORT" --hostname "$HOST" --print-logs >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 30); do
  if curl -fsS "$SERVER_URL/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "$SERVER_URL/health" >/dev/null 2>&1; then
  printf 'server health check failed for %s\n' "$SERVER_URL" >&2
  exit 1
fi

run_probe() {
  local signal_name=$1
  local signal_number=$2
  local log_path=$3
  local session_id=$4

  python - "$signal_name" "$signal_number" "$log_path" "$SERVER_URL" "$session_id" "$PLATFORM" "$OPENCODE_PATH" "$OPENCODE_VERSION" "$STRACE_PATH" <<'PY'
import codecs
import os
import select
import signal
import subprocess
import sys
import time
from pathlib import Path

signal_name, signal_number, log_path, server_url, session_id, platform, opencode_path, opencode_version, strace_path = sys.argv[1:]
log_file = Path(log_path)
signum = int(signal_number)
attach_command = [
    "opencode",
    "attach",
    server_url,
    "--session",
    session_id,
    "--print-logs",
]

master_fd, slave_fd = os.openpty()
process = subprocess.Popen(
    attach_command,
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
    start_new_session=True,
    close_fds=True,
)
os.close(slave_fd)

start_ns = time.monotonic_ns()
signal_sent_ns = None
exit_ns = None
pty_eof_ns = None
timed_out = False
events: list[tuple[int, bytes]] = []
setup_tokens = [b"\x1b[?1049h", b"\x1b[?1006h"]
cleanup_tokens = [
    b"\x1b[?1003l",
    b"\x1b[?1002l",
    b"\x1b[?1000l",
    b"\x1b[?1006l",
    b"\x1b[?2004l",
    b"\x1b[?1049l",
]

def read_available(timeout_seconds: float) -> bool:
    ready, _, _ = select.select([master_fd], [], [], timeout_seconds)
    if not ready:
        return False
    try:
        chunk = os.read(master_fd, 65536)
    except OSError:
        return False
    if not chunk:
        global pty_eof_ns
        pty_eof_ns = time.monotonic_ns()
        return False
    events.append((time.monotonic_ns(), chunk))
    return True

while True:
    read_available(0.1)
    now_ns = time.monotonic_ns()
    combined_bytes = b"".join(chunk for _, chunk in events)
    setup_complete = all(token in combined_bytes for token in setup_tokens)
    cleanup_complete = all(token in combined_bytes for token in cleanup_tokens)

    if signal_sent_ns is None and setup_complete and now_ns - start_ns >= 3_000_000_000:
        os.killpg(process.pid, signum)
        signal_sent_ns = now_ns

    status = process.poll()
    if status is not None:
        exit_ns = time.monotonic_ns()
        if cleanup_complete:
            break

    if now_ns - start_ns >= 30_000_000_000:
        timed_out = True
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        exit_ns = time.monotonic_ns()
        break

drain_deadline = time.monotonic() + 2.0
while time.monotonic() < drain_deadline:
    if not read_available(0.05):
        break

os.close(master_fd)

output_bytes = b"".join(chunk for _, chunk in events)
signal_sent_ns = signal_sent_ns or exit_ns or start_ns
process_exit_ns = exit_ns or time.monotonic_ns()
stream_exit_ns = pty_eof_ns or process_exit_ns
latency_ms = (stream_exit_ns - signal_sent_ns) / 1_000_000

mode_tokens = {
    "?2004l": b"\x1b[?2004l",
    "?1049l": b"\x1b[?1049l",
    "?1000l": b"\x1b[?1000l",
    "?1002l": b"\x1b[?1002l",
    "?1003l": b"\x1b[?1003l",
    "?1004l": b"\x1b[?1004l",
    "?1006l": b"\x1b[?1006l",
}

post_signal_bytes = b""
for event_ns, chunk in events:
    if event_ns >= signal_sent_ns:
        post_signal_bytes += chunk

with log_file.open("w", encoding="utf-8") as handle:
    handle.write(f"# capture_mode=pty-fallback\n")
    handle.write(f"# platform={platform}\n")
    handle.write(f"# strace_available={'yes' if strace_path else 'no'}\n")
    handle.write(f"# opencode_path={opencode_path}\n")
    handle.write(f"# opencode_version={opencode_version.strip()}\n")
    handle.write(f"# signal={signal_name}\n")
    handle.write(f"# session_id={session_id}\n")
    handle.write(f"# child_pid={process.pid}\n")
    handle.write(f"# start_monotonic_ns={start_ns}\n")
    handle.write(f"# signal_monotonic_ns={signal_sent_ns}\n")
    handle.write(f"# process_exit_monotonic_ns={process_exit_ns}\n")
    handle.write(f"# pty_eof_monotonic_ns={pty_eof_ns}\n")
    handle.write(f"# exit_monotonic_ns={stream_exit_ns}\n")
    handle.write(f"# latency_ms={latency_ms:.3f}\n")
    handle.write(f"# return_code={process.returncode}\n")
    handle.write(f"# timed_out={'yes' if timed_out else 'no'}\n")
    for mode_name, token in mode_tokens.items():
        handle.write(f"# post_signal_{mode_name}_count={post_signal_bytes.count(token)}\n")
    handle.write("# attach_command=" + " ".join(attach_command) + "\n")
    handle.write("# attach_help_begin\n")
    handle.write(os.environ.get("ATTACH_HELP", ""))
    handle.write("# attach_help_end\n")
    handle.write("\n")
    handle.write(f"MARK {start_ns} START\n")
    handle.write(f"MARK {signal_sent_ns} SIGNAL {signal_name}\n")
    for event_ns, chunk in events:
        escaped = codecs.escape_encode(chunk)[0].decode("ascii")
        handle.write(f"EVENT {event_ns} {escaped}\n")
    if pty_eof_ns is not None:
        handle.write(f"MARK {pty_eof_ns} PTY_EOF\n")
    handle.write(f"MARK {process_exit_ns} PROCESS_EXIT return_code={process.returncode}\n")
    handle.write(f"MARK {stream_exit_ns} EXIT return_code={process.returncode}\n")
PY
}

run_probe SIGINT 2 "$SIGINT_LOG" "test-session-sigint-$$" <<<"$ATTACH_HELP"
run_probe SIGTERM 15 "$SIGTERM_LOG" "test-session-sigterm-$$" <<<"$ATTACH_HELP"

printf 'Created %s and %s\n' "$SIGINT_LOG" "$SIGTERM_LOG"
