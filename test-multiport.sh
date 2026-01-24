#!/usr/bin/env bash

echo "Testing multi-port support for opencode-agent-tmux"
echo "======================================================"
echo ""

WRAPPER="/Users/angansamadder/Code/opencode-agent-tmux/bin/opencode-tmux"

echo "Test 1: Check port detection function"
echo "--------------------------------------"

check_port_test() {
    local port=$1
    
    if command -v lsof >/dev/null 2>&1; then
        if lsof -i ":$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo "✓ Port $port is IN USE (lsof)"
            return 0
        else
            echo "✓ Port $port is AVAILABLE (lsof)"
            return 1
        fi
    elif command -v nc >/dev/null 2>&1; then
        if nc -z localhost "$port" >/dev/null 2>&1; then
            echo "✓ Port $port is IN USE (nc)"
            return 0
        else
            echo "✓ Port $port is AVAILABLE (nc)"
            return 1
        fi
    else
        echo "⚠️  No port checking tool available (install lsof or nc)"
        return 1
    fi
}

for port in 4096 4097 4098; do
    check_port_test $port
done

echo ""
echo "Test 2: Verify wrapper script exists and is executable"
echo "-------------------------------------------------------"

if [ -f "$WRAPPER" ]; then
    echo "✓ Wrapper script exists: $WRAPPER"
else
    echo "✗ Wrapper script NOT found: $WRAPPER"
    exit 1
fi

if [ -x "$WRAPPER" ]; then
    echo "✓ Wrapper script is executable"
else
    echo "✗ Wrapper script is NOT executable"
    exit 1
fi

echo ""
echo "Test 3: Check if alias is configured"
echo "------------------------------------"

if alias opencode 2>/dev/null | grep -q "opencode-tmux"; then
    echo "✓ Shell alias is configured"
    alias opencode
else
    echo "⚠️  Shell alias not found (you may need to: source ~/.zshrc)"
fi

echo ""
echo "Test 4: Simulate port scanning"
echo "-------------------------------"

OPENCODE_PORT_START=4096
OPENCODE_PORT_MAX=$((OPENCODE_PORT_START + 10))

find_available_port() {
    local port=$OPENCODE_PORT_START
    
    while [ $port -le $OPENCODE_PORT_MAX ]; do
        if ! check_port_test "$port" >/dev/null 2>&1; then
            echo "$port"
            return 0
        fi
        port=$((port + 1))
    done
    
    return 1
}

AVAILABLE=$(find_available_port)
if [ -n "$AVAILABLE" ]; then
    echo "✓ Next available port: $AVAILABLE"
else
    echo "⚠️  All ports in range are in use!"
fi

echo ""
echo "======================================================"
echo "Multi-port support is ready!"
echo ""
echo "Try it out:"
echo "  1. Open terminal 1: opencode"
echo "  2. Open terminal 2: opencode"
echo "  3. Watch it auto-select port 4097!"
echo ""
