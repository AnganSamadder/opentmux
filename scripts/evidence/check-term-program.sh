#!/usr/bin/env bash
set -euo pipefail

SOCK="env-check-$$"
EVIDENCE_BASE=".sisyphus/evidence/tui-hijack"
OUTSIDE_ENV="$EVIDENCE_BASE/env-outside-tmux.txt"
INSIDE_ENV="$EVIDENCE_BASE/env-inside-tmux.txt"
UPDATE_ENV="$EVIDENCE_BASE/update-env.txt"
INSIDE_TMP="/tmp/inside-env-$$.txt"

mkdir -p "$EVIDENCE_BASE"

# 1) Capture env outside tmux
env | grep -iE "term|ghostty|colorterm|terminfo" > "$OUTSIDE_ENV"

# 2) Start fresh tmux server with unique socket and no user config
tmux -L "$SOCK" -f /dev/null new-session -d -s test -x 200 -y 50 /bin/sh

# 3) Query default update-environment propagation
tmux -L "$SOCK" show-options -g update-environment > "$UPDATE_ENV" 2>&1 || true

# 4) Send a command to the new pane to dump env inside tmux pane
tmux -L "$SOCK" send-keys -t test "env | grep -iE 'TERM|GHOSTTY|COLORTERM' | tee $INSIDE_TMP" Enter
sleep 0.6

# 5) Capture the pane content
tmux -L "$SOCK" capture-pane -t test -p > "$INSIDE_ENV"

# 6) Cleanup tmux server
tmux -L "$SOCK" kill-server

# 7) Interpret results
VERDICT="DROP"
if grep -qi "TERM_PROGRAM" "$INSIDE_ENV" ; then
  VERDICT="RELY"
fi

# 8) Write analysis
TERM_INSIDE=$(grep -qi "TERM_PROGRAM" "$INSIDE_ENV" && echo "YES" || echo "NO")
GHOSTTY_INSIDE=$(grep -qi "GHOSTTY" "$INSIDE_ENV" && echo "YES" || echo "NO")
ANALYSIS="$EVIDENCE_BASE/term-program-analysis.md"

cat > "$ANALYSIS" <<MD
(a) Is TERM_PROGRAM in tmux's default update-environment? - ${TERM_DEFAULT:-UNKNOWN}
(b) Does TERM_PROGRAM survive into fresh pane? - ${TERM_INSIDE}
(c) Can the plugin reliably detect Ghostty without user config? - ${GHOSTTY_INSIDE}
(d) VERDICT: ${VERDICT}
MD

# 9) Final info
echo "Env outside: $OUTSIDE_ENV"
echo "Env inside tmux: $INSIDE_ENV"
echo "Update env: $UPDATE_ENV"
echo "Analysis: $ANALYSIS"

exit 0
