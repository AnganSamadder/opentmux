#!/usr/bin/env bash
# Simple test script - just paste this prompt into OpenCode

cat << 'EOF'
===================================
OPENCODE AGENT TMUX TEST PROMPT
===================================

Paste this prompt into OpenCode to test the tmux plugin:

---

I need you to help me test the opencode-agent-tmux plugin.

Please launch 3 agents in parallel using the call_omo_agent tool with run_in_background=true:

1. **Explorer Agent**: Search the current directory for all TypeScript files and describe the project structure
2. **Explorer Agent**: Find all configuration files (JSON, YAML) in the project
3. **Librarian Agent**: Search GitHub for examples of OpenCode plugins and summarize what you find

Launch these agents in parallel (all in one response with multiple call_omo_agent calls).

After launching them, tell me the task IDs and wait for them to complete.

---

You should see 3 new tmux panes spawn automatically, each showing live output from a agent!

EOF
