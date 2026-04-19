#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(dirname "$(realpath "$0")")
REPO_ROOT=$(realpath "$SCRIPT_DIR/../..")
EVIDENCE_DIR="$REPO_ROOT/.sisyphus/evidence/tui-hijack"
LOG_FILE="$EVIDENCE_DIR/task-2-capture.log"

mkdir -p "$SCRIPT_DIR" "$EVIDENCE_DIR"
: > "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "missing required command: $1"
    exit 1
  fi
}

require_cmd tmux
require_cmd python3

SOCKET_SUFFIX=""
if [[ -r /proc/sys/kernel/random/uuid ]]; then
  SOCKET_SUFFIX=$(head -c 8 /proc/sys/kernel/random/uuid | tr -d '\n' || true)
fi

if [[ -z "$SOCKET_SUFFIX" ]] && command -v openssl >/dev/null 2>&1; then
  SOCKET_SUFFIX=$(openssl rand -hex 4)
fi

if [[ -z "$SOCKET_SUFFIX" ]]; then
  SOCKET_SUFFIX=$$
fi

SOCKET="opentmux-t2-${SOCKET_SUFFIX}"
BASELINE_GOOD="$EVIDENCE_DIR/baseline-good.bin"
BASELINE_AFTER_SPLIT="$EVIDENCE_DIR/baseline-after-split.bin"
BASELINE_AFTER_KILL="$EVIDENCE_DIR/baseline-after-kill.bin"
REPRO_PRE="$EVIDENCE_DIR/repro-plugin-pre.bin"
REPRO_DURING="$EVIDENCE_DIR/repro-plugin-during.bin"
REPRO_POST="$EVIDENCE_DIR/repro-plugin-post.bin"

for artifact in \
  "$BASELINE_GOOD" \
  "$BASELINE_AFTER_SPLIT" \
  "$BASELINE_AFTER_KILL" \
  "$REPRO_PRE" \
  "$REPRO_DURING" \
  "$REPRO_POST"; do
  rm -f "$artifact"
done

BASELINE_STUB=$(mktemp)
REPRO_STUB=$(mktemp)

cat > "$BASELINE_STUB" <<'EOF'
#!/usr/bin/env bash
printf 'hello\r\n'
sleep 1
EOF

cat > "$REPRO_STUB" <<'EOF'
#!/usr/bin/env bash
printf '\033[?1000h\033[?1002h\033[?1006h\033[?2004h\033[?1049h'
sleep 3
EOF

chmod +x "$BASELINE_STUB" "$REPRO_STUB"

tmux_cmd() {
  tmux -L "$SOCKET" -f /dev/null "$@"
}

cleanup() {
  set +e
  tmux_cmd kill-server >/dev/null 2>&1 || true
  rm -f "$BASELINE_STUB" "$REPRO_STUB"
}

trap cleanup EXIT

capture_attach_session() {
  local session_name=$1
  local artifact_path=$2
  local action_kind=$3
  local action_target=$4
  local action_value=$5
  local wait_ms=$6

  python3 - "$SOCKET" "$session_name" "$artifact_path" "$action_kind" "$action_target" "$action_value" "$wait_ms" <<'PY'
import os
import pty
import select
import signal
import subprocess
import sys
import time

socket, session_name, artifact_path, action_kind, action_target, action_value, wait_ms = sys.argv[1:8]
wait_seconds = int(wait_ms) / 1000.0

master_fd, slave_fd = pty.openpty()
env = os.environ.copy()
env.setdefault('TERM', 'xterm-256color')
process = subprocess.Popen(
    ['tmux', '-L', socket, '-f', '/dev/null', 'attach-session', '-t', session_name],
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
    start_new_session=True,
    close_fds=True,
    env=env,
)
os.close(slave_fd)

chunks: list[bytes] = []
action_done = action_kind == 'noop'
start_time = time.monotonic()

def tmux(*args: str) -> None:
    subprocess.run(['tmux', '-L', socket, '-f', '/dev/null', *args], check=True)

def tmux_output(*args: str) -> str:
    return subprocess.check_output(['tmux', '-L', socket, '-f', '/dev/null', *args], text=True).strip()

def run_action() -> None:
    if action_kind == 'noop':
        return
    if action_kind == 'send-keys':
        tmux('send-keys', '-t', action_target, action_value, 'Enter')
        return
    if action_kind == 'split-baseline':
        child_id = tmux_output('split-window', '-h', '-d', '-P', '-F', '#{pane_id}', '-t', action_target, action_value)
        tmux('select-pane', '-t', child_id, '-T', 'baseline-good')
        return
    if action_kind == 'split-repro':
        child_id = tmux_output('split-window', '-h', '-d', '-P', '-F', '#{pane_id}', '-t', action_target, action_value)
        tmux('select-pane', '-t', child_id, '-T', 'repro-plugin')
        return
    if action_kind == 'kill-pane':
        tmux('kill-pane', '-t', action_target)
        tmux('select-layout', '-t', action_value, 'tiled')
        return
    raise RuntimeError(f'unknown action kind: {action_kind}')

try:
    while True:
        now = time.monotonic()
        if not action_done and now - start_time >= 0.25:
            run_action()
            action_done = True

        ready, _, _ = select.select([master_fd], [], [], 0.05)
        if ready:
            try:
                chunk = os.read(master_fd, 65536)
            except OSError:
                chunk = b''
            if chunk:
                chunks.append(chunk)
            elif process.poll() is not None:
                break

        if action_done and now - start_time >= wait_seconds:
            break

    with open(artifact_path, 'wb') as handle:
        for chunk in chunks:
            handle.write(chunk)
finally:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

    try:
        process.wait(timeout=1)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()

    os.close(master_fd)
PY
}

capture_pipe_pane() {
  local pane_id=$1
  local artifact_path=$2
  local action_kind=$3
  local action_target=$4
  local action_value=$5
  local wait_ms=$6

  python3 - "$SOCKET" "$pane_id" "$artifact_path" "$action_kind" "$action_target" "$action_value" "$wait_ms" <<'PY'
import os
import subprocess
import sys
import tempfile
import time

socket, pane_id, artifact_path, action_kind, action_target, action_value, wait_ms = sys.argv[1:8]
wait_seconds = int(wait_ms) / 1000.0
fd, tmp_path = tempfile.mkstemp(prefix='opentmux-t2-', suffix='.bin')
os.close(fd)
os.unlink(tmp_path)

def tmux(*args: str, check: bool = True) -> None:
    subprocess.run(['tmux', '-L', socket, '-f', '/dev/null', *args], check=check)

def tmux_output(*args: str) -> str:
    return subprocess.check_output(['tmux', '-L', socket, '-f', '/dev/null', *args], text=True).strip()

tmux('pipe-pane', '-o', '-t', pane_id, f"cat >> '{tmp_path}'")
time.sleep(0.1)

child_id = ''
if action_kind == 'send-keys':
    tmux('send-keys', '-t', action_target, action_value, 'Enter')
elif action_kind == 'split-baseline':
    child_id = tmux_output('split-window', '-h', '-d', '-P', '-F', '#{pane_id}', '-t', action_target, action_value)
    tmux('select-pane', '-t', child_id, '-T', 'baseline-good')
elif action_kind == 'split-repro':
    child_id = tmux_output('split-window', '-h', '-d', '-P', '-F', '#{pane_id}', '-t', action_target, action_value)
    tmux('select-pane', '-t', child_id, '-T', 'repro-plugin')
elif action_kind == 'kill-pane':
    time.sleep(0.5)
    tmux('kill-pane', '-t', action_target)
    tmux('select-layout', '-t', action_value, 'tiled', check=False)

time.sleep(wait_seconds)
tmux('pipe-pane', '-t', pane_id)

data = b''
if os.path.exists(tmp_path):
    data = open(tmp_path, 'rb').read()

with open(artifact_path, 'wb') as handle:
    handle.write(data)

if os.path.exists(tmp_path):
    os.unlink(tmp_path)

if child_id:
    print(child_id)
PY
}

get_first_pane() {
  tmux_cmd list-panes -t "$1" -F '#{pane_id}' | head -n 1
}

start_session() {
  local session_name=$1
  tmux_cmd new-session -d -s "$session_name" -x 200 -y 50 sh
}

log "socket=$SOCKET"
start_session baseline
tmux_cmd set-option -g remain-on-exit on
tmux_cmd set-option -g status off

BASELINE_PARENT=$(get_first_pane 'baseline:0')
log "baseline parent pane=$BASELINE_PARENT"

log 'capture baseline-good.bin'
capture_pipe_pane "$BASELINE_PARENT" "$BASELINE_GOOD" send-keys "$BASELINE_PARENT" "printf 'hello\\r\\n'; sleep 1" 1500 >/dev/null

log 'capture baseline-after-split.bin'
capture_attach_session baseline "$BASELINE_AFTER_SPLIT" split-baseline 'baseline:0' "$BASELINE_STUB" 2200
BASELINE_CHILD=$(tmux_cmd list-panes -t 'baseline:0' -F '#{pane_id}' | tail -n 1)

log 'capture baseline-after-kill.bin'
capture_attach_session baseline "$BASELINE_AFTER_KILL" kill-pane "$BASELINE_CHILD" 'baseline:0' 1200

start_session repro
REPRO_PARENT=$(get_first_pane 'repro:0')
log "repro parent pane=$REPRO_PARENT"

log 'capture repro-plugin-pre.bin'
capture_pipe_pane "$REPRO_PARENT" "$REPRO_PRE" send-keys "$REPRO_PARENT" "printf 'repro plugin pre\\r\\n'" 400 >/dev/null

log 'capture repro-plugin-during.bin'
capture_attach_session repro "$REPRO_DURING" split-repro 'repro:0' "$REPRO_STUB" 4000
REPRO_CHILD=$(tmux_cmd list-panes -t 'repro:0' -F '#{pane_id}' | tail -n 1)

log 'capture repro-plugin-post.bin'
capture_attach_session repro "$REPRO_POST" kill-pane "$REPRO_CHILD" 'repro:0' 1200

for artifact in \
  "$BASELINE_GOOD" \
  "$BASELINE_AFTER_SPLIT" \
  "$BASELINE_AFTER_KILL" \
  "$REPRO_PRE" \
  "$REPRO_DURING" \
  "$REPRO_POST"; do
  log "$(basename "$artifact") bytes=$(wc -c < "$artifact")"
done

log 'capture complete'
