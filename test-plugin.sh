#!/usr/bin/env bash
# Test script for opencode-agent-tmux plugin
# This script will trigger OpenCode to spawn multiple agents in parallel

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}====================================${NC}"
echo -e "${BLUE}OpenCode Agent Tmux Test Script${NC}"
echo -e "${BLUE}====================================${NC}"
echo ""

# Check if we're inside tmux
if [ -z "$TMUX" ]; then
    echo -e "${YELLOW}WARNING: Not running inside tmux!${NC}"
    echo "The plugin requires tmux to spawn panes."
    echo ""
    echo "To fix this, run:"
    echo "  tmux"
    echo "  bash test-plugin.sh"
    exit 1
fi

echo -e "${GREEN}✓ Running inside tmux${NC}"

# Check if opencode is available
if ! command -v opencode &> /dev/null; then
    echo -e "${YELLOW}ERROR: opencode command not found${NC}"
    exit 1
fi

echo -e "${GREEN}✓ OpenCode is installed${NC}"

# Check if server is running
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
if ! curl -s "http://localhost:${OPENCODE_PORT}/health" > /dev/null 2>&1; then
    echo -e "${YELLOW}WARNING: OpenCode server not running on port ${OPENCODE_PORT}${NC}"
    echo ""
    echo "Please start OpenCode with:"
    echo "  opencode --port ${OPENCODE_PORT}"
    echo ""
    echo "Then run this script again."
    exit 1
fi

echo -e "${GREEN}✓ OpenCode server running on port ${OPENCODE_PORT}${NC}"
echo ""

# Create a test prompt that will spawn multiple agents
echo -e "${BLUE}Creating test prompt to spawn 3 agents...${NC}"
echo ""

cat > /tmp/opencode-test-prompt.md << 'EOF'
I need you to help me test the opencode-agent-tmux plugin by spawning multiple agents in parallel.

Please launch 3 background agents in parallel using the call_omo_agent tool:

1. **Explorer Agent 1**: Search for all TypeScript files in this directory and analyze the structure
2. **Explorer Agent 2**: Search for all JSON configuration files and list them
3. **Librarian Agent**: Look up documentation for the zod library and summarize its main features

Make sure to run these agents with run_in_background=true so they execute in parallel.

After launching them, report back with the task IDs.
EOF

echo -e "${GREEN}Test prompt created at: /tmp/opencode-test-prompt.md${NC}"
echo ""
echo -e "${YELLOW}Contents:${NC}"
cat /tmp/opencode-test-prompt.md
echo ""
echo -e "${BLUE}====================================${NC}"
echo ""
echo "Now sending this prompt to OpenCode..."
echo "You should see 3 new tmux panes spawn with live agent output!"
echo ""

# Send the prompt to OpenCode
opencode "$(cat /tmp/opencode-test-prompt.md)"
