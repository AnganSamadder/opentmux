# OpenCode Agent Tmux Plugin - Build Plan

## Project Overview

**Name:** opencode-agent-tmux
**Location:** `~/Code/opencode-agent-tmux`
**Purpose:** Standalone OpenCode plugin that provides tmux integration for viewing agent execution in real-time
**Compatibility:** Works with ANY OpenCode agents (Sisyphus, Oracle, Explorer, Librarian, etc.)

## Key Features

1. **Automatic Tmux Pane Spawning**: When any agent starts, automatically spawn a tmux pane
2. **Live Streaming**: Each pane runs `opencode attach` to show real-time agent output
3. **Auto-Cleanup**: Panes automatically close when agents complete
4. **Configurable Layout**: Support multiple tmux layouts (main-vertical, tiled, etc.)
5. **Agent-Agnostic**: Works with oh-my-opencode, omoc-slim, or vanilla OpenCode

## Technical Architecture

### Core Components

1. **TmuxSessionManager** (TypeScript class)
   - Subscribes to OpenCode's `session.created` event
   - Detects child sessions (agents) by checking for `parentID`
   - Spawns tmux pane for each agent
   - Polls session status and closes pane when complete

2. **Tmux Utilities** (Helper functions)
   - `spawnTmuxPane(sessionId, title, config, serverUrl)`: Create new pane
   - `closeTmuxPane(paneId, layout)`: Clean up pane when done
   - `isInsideTmux()`: Check if running inside tmux
   - `checkServerHealth(serverUrl)`: Verify OpenCode server is reachable

3. **Plugin Entry Point** (`index.ts`)
   - Export `init()` function that registers with OpenCode
   - Load configuration from `opencode-agent-tmux.json`
   - Initialize TmuxSessionManager on startup

4. **Configuration Schema**
   ```json
   {
     "enabled": true,
     "port": 4096,
     "layout": "main-vertical",
     "paneOptions": "-h -d"
   }
   ```

## Project Structure

```
~/Code/opencode-agent-tmux/
├── package.json
├── tsconfig.json
├── README.md
├── .gitignore
├── src/
│   ├── index.ts              # Plugin entry point
│   ├── tmux-session-manager.ts
│   └── utils/
│       └── tmux.ts           # Tmux utilities
├── config/
│   └── default.json          # Default configuration
└── scripts/
    └── install.sh            # Installation helper
```

## Installation Instructions (for end user)

```bash
# 1. Clone/Navigate to plugin directory
cd ~/Code/opencode-agent-tmux

# 2. Install dependencies
bun install

# 3. Build the plugin
bun run build

# 4. Install to OpenCode
bun run install:plugin

# 5. Start OpenCode with tmux support
tmux
opencode --port 4096
```

## Configuration

Edit `~/.config/opencode/opencode-agent-tmux.json`:

```json
{
  "enabled": true,
  "port": 4096,
  "layout": "main-vertical",
  "paneTitle": "🤖 {agentType}",
  "autoClose": true
}
```
