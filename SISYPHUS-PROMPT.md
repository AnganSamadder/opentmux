# Prompt for Sisyphus: Build OpenCode Subagent Tmux Plugin

## Project Goal

Build a standalone OpenCode plugin called **opencode-subagent-tmux** that provides tmux integration for viewing subagent execution in real-time. This plugin must work with ANY OpenCode subagents (including the current Sisyphus orchestrator setup) without conflicts.

## Project Location & Setup

**Location:** `~/Code/opencode-subagent-tmux`

### Step 1: Repository Creation

```bash
# Create project directory
mkdir -p ~/Code/opencode-subagent-tmux
cd ~/Code/opencode-subagent-tmux

# Initialize git repository
git init
echo "# OpenCode Subagent Tmux Plugin" > README.md
git add README.md
git commit -m "Initial commit"

# Create project structure
mkdir -p src/utils
mkdir -p config
mkdir -p scripts
```

### Step 2: Package Configuration

Create `package.json` with:

```json
{
  "name": "opencode-subagent-tmux",
  "version": "1.0.0",
  "description": "Tmux integration for OpenCode subagents - view subagent execution in real-time tmux panes",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "dev": "tsup src/index.ts --format esm --dts --watch",
    "install:plugin": "node scripts/install.js"
  },
  "keywords": ["opencode", "plugin", "tmux", "subagent"],
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.0.0"
  },
  "dependencies": {}
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Create `.gitignore`:

```
node_modules/
dist/
*.log
.DS_Store
```

## Implementation Requirements

### Core Functionality to Extract from omoc-slim

You need to extract and adapt the tmux integration code from **oh-my-opencode-slim**:

**Source files:**
- https://raw.githubusercontent.com/alvinunreal/oh-my-opencode-slim/master/src/background/tmux-session-manager.ts
- https://raw.githubusercontent.com/alvinunreal/oh-my-opencode-slim/master/src/utils/tmux.ts

**Key components to extract:**

1. **TmuxSessionManager class** - Main orchestrator that:
   - Listens for OpenCode `session.created` events
   - Detects child sessions (subagents) by checking for `parentID` property
   - Spawns tmux pane for each subagent session
   - Polls session status and closes pane when session becomes `idle`
   - Handles errors gracefully (not in tmux, server down, etc.)

2. **Tmux utility functions**:
   - `spawnTmuxPane(sessionId, title, config, serverUrl)`: Creates new tmux pane running `opencode attach <serverUrl> --session <sessionId>`
   - `closeTmuxPane(paneId, layout)`: Closes pane and reapplies layout
   - `isInsideTmux()`: Checks `process.env.TMUX`
   - `checkServerHealth(serverUrl)`: Verifies OpenCode server is running via `/health` endpoint

3. **Event subscription pattern**:
   - How to subscribe to OpenCode's event system
   - How to filter for child sessions (subagents)
   - How to pass context between event handlers

### Critical Adaptations Required

**DO NOT** bring in omoc-slim's agent system. This plugin must be:
- ✅ Standalone - no dependencies on omoc-slim or oh-my-opencode
- ✅ Agent-agnostic - works with ANY subagent system
- ✅ Non-invasive - doesn't modify existing OpenCode behavior
- ✅ Configurable - users can customize layout, port, etc.

**Key changes from omoc-slim code:**
1. Remove BackgroundTaskManager dependency - we only need the tmux viewing part
2. Make it work as a standalone OpenCode plugin (may need to research OpenCode plugin API)
3. Load configuration from `~/.config/opencode/opencode-subagent-tmux.json`
4. Add comprehensive error handling and logging

## File Structure & Implementation

### `src/index.ts` - Plugin Entry Point

This file should:
1. Export an `init()` function that OpenCode calls when loading the plugin
2. Load configuration from `~/.config/opencode/opencode-subagent-tmux.json`
3. Initialize TmuxSessionManager
4. Register cleanup handlers

Pseudocode:
```typescript
export async function init(context: PluginContext) {
  const config = await loadConfig();
  
  if (!config.enabled) {
    console.log('opencode-subagent-tmux: disabled in config');
    return;
  }

  if (!isInsideTmux()) {
    console.log('opencode-subagent-tmux: not running inside tmux, skipping');
    return;
  }

  const manager = new TmuxSessionManager(config, context);
  await manager.start();
  
  console.log('opencode-subagent-tmux: initialized');
}
```

### `src/tmux-session-manager.ts` - Core Logic

Extract from omoc-slim's TmuxSessionManager but adapt for standalone use:

**Key methods:**
- `constructor(config, context)` - Initialize with config and OpenCode context
- `start()` - Subscribe to session.created events
- `handleSessionCreated(session)` - Check if it's a subagent, spawn pane if so
- `monitorSession(sessionId, paneId)` - Poll status, close pane when done
- `stop()` - Cleanup and unsubscribe

**Critical logic:**
```typescript
async handleSessionCreated(session: Session) {
  // Only handle child sessions (subagents)
  if (!session.parentID) {
    return;
  }

  // Check if tmux pane can be spawned
  if (!isInsideTmux()) {
    return;
  }

  // Verify OpenCode server is reachable
  const serverUrl = `http://localhost:${this.config.port}`;
  const isHealthy = await checkServerHealth(serverUrl);
  if (!isHealthy) {
    console.error('OpenCode server not reachable');
    return;
  }

  // Spawn tmux pane
  const title = `${session.agentType || 'subagent'}`;
  const paneId = await spawnTmuxPane(
    session.id,
    title,
    this.config,
    serverUrl
  );

  if (paneId) {
    // Monitor session and close pane when done
    this.monitorSession(session.id, paneId);
  }
}
```

### `src/utils/tmux.ts` - Tmux Utilities

Extract from omoc-slim but make standalone:

**Key functions:**
- `isInsideTmux()`: Check if `process.env.TMUX` is set
- `spawnTmuxPane(sessionId, title, config, serverUrl)`: Run `tmux split-window -h -d -P -F '#{pane_id}' "opencode attach <serverUrl> --session <sessionId>"`
- `closeTmuxPane(paneId, layout)`: Run `tmux kill-pane -t <paneId>` and reapply layout
- `checkServerHealth(serverUrl)`: Fetch `${serverUrl}/health`

**Example implementation:**
```typescript
export async function spawnTmuxPane(
  sessionId: string,
  title: string,
  config: Config,
  serverUrl: string
): Promise<string | null> {
  if (!isInsideTmux()) {
    return null;
  }

  try {
    const command = `opencode attach ${serverUrl} --session ${sessionId}`;
    const { stdout } = await execAsync(
      `tmux split-window ${config.paneOptions} -P -F '#{pane_id}' "${command}"`
    );
    
    const paneId = stdout.trim();
    
    // Apply layout
    if (config.layout) {
      await execAsync(`tmux select-layout ${config.layout}`);
    }
    
    return paneId;
  } catch (error) {
    console.error('Failed to spawn tmux pane:', error);
    return null;
  }
}
```

### `config/default.json` - Default Configuration

```json
{
  "enabled": true,
  "port": 4096,
  "layout": "main-vertical",
  "paneOptions": "-h -d",
  "autoClose": true,
  "debug": false
}
```

### `scripts/install.js` - Installation Script

Create a script that:
1. Builds the TypeScript code
2. Adds the plugin to OpenCode's plugin configuration
3. Creates config file at `~/.config/opencode/opencode-subagent-tmux.json`

```javascript
#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const configDir = path.join(os.homedir(), '.config', 'opencode');
const pluginConfigPath = path.join(configDir, 'opencode-subagent-tmux.json');
const openCodeConfigPath = path.join(configDir, 'opencode.json');

// 1. Build the plugin
console.log('Building plugin...');
execSync('bun run build', { stdio: 'inherit' });

// 2. Create plugin config if it doesn't exist
if (!fs.existsSync(pluginConfigPath)) {
  console.log('Creating plugin configuration...');
  const defaultConfig = JSON.parse(
    fs.readFileSync('config/default.json', 'utf-8')
  );
  fs.writeFileSync(pluginConfigPath, JSON.stringify(defaultConfig, null, 2));
}

// 3. Add to OpenCode plugins list
console.log('Registering plugin with OpenCode...');
const openCodeConfig = JSON.parse(fs.readFileSync(openCodeConfigPath, 'utf-8'));

if (!openCodeConfig.plugins) {
  openCodeConfig.plugins = [];
}

const pluginPath = path.resolve('./dist/index.js');
if (!openCodeConfig.plugins.includes(pluginPath)) {
  openCodeConfig.plugins.push(pluginPath);
  fs.writeFileSync(openCodeConfigPath, JSON.stringify(openCodeConfig, null, 2));
  console.log('Plugin registered successfully!');
} else {
  console.log('Plugin already registered.');
}

console.log('\nInstallation complete!');
console.log('\nTo use the plugin:');
console.log('1. Start tmux: tmux');
console.log('2. Start OpenCode with port flag: opencode --port 4096');
console.log('3. Spawn subagents and watch them appear in new panes!');
```

### `README.md` - Documentation

Create comprehensive documentation including:
- What the plugin does
- Installation instructions
- Configuration options
- Usage examples
- Troubleshooting guide
- How it works (technical overview)

## Testing & Verification

After building, test with:

1. **Installation test:**
   ```bash
   cd ~/Code/opencode-subagent-tmux
   bun install
   bun run build
   bun run install:plugin
   ```

2. **Runtime test:**
   ```bash
   # Start tmux
   tmux
   
   # Start OpenCode with port flag
   opencode --port 4096
   
   # Give this test prompt:
   # "Search the codebase for all SwiftUI views and analyze the architecture. Work in parallel."
   ```

3. **Verify:**
   - New tmux panes spawn when subagents start
   - Panes show live output from `opencode attach`
   - Panes close automatically when subagents complete
   - Works with existing Sisyphus configuration

## Important Notes

1. **OpenCode Server Port:** The plugin requires OpenCode to be started with `--port` flag matching the config (default: 4096)

2. **Tmux Requirement:** Plugin gracefully does nothing if not running inside tmux

3. **Event System:** You may need to research how OpenCode plugins subscribe to events. Look for:
   - Plugin API documentation
   - Example plugins
   - OpenCode SDK or types package

4. **Session Detection:** The key is detecting child sessions (those with `parentID` property) - these are subagents

5. **Compatibility:** This should work with oh-my-opencode, omoc-slim, or any other system that spawns OpenCode subagents

## Source Code References

Extract and adapt code from:
- https://github.com/alvinunreal/oh-my-opencode-slim/blob/master/src/background/tmux-session-manager.ts
- https://github.com/alvinunreal/oh-my-opencode-slim/blob/master/src/utils/tmux.ts
- https://github.com/alvinunreal/oh-my-opencode-slim/blob/master/src/background/index.ts

Focus on extracting ONLY the tmux viewing functionality, not the agent orchestration parts.

## Success Criteria

✅ Plugin builds without errors
✅ Installs cleanly to OpenCode
✅ Spawns tmux panes when subagents start
✅ Shows live streaming output
✅ Panes close when subagents complete
✅ Works with existing Sisyphus setup
✅ No conflicts with oh-my-opencode
✅ Configurable via JSON
✅ Comprehensive README and error messages

## Additional Research Needed

You may need to research:
1. OpenCode plugin API - how to register a plugin
2. OpenCode event system - how to subscribe to `session.created`
3. Session object structure - what properties are available
4. How to access OpenCode client/context from a plugin

Look for documentation, examples, or inspect oh-my-opencode's code to understand the plugin system.

## Build Command Summary

```bash
# Setup
cd ~/Code/opencode-subagent-tmux
bun install

# Development
bun run dev  # Watch mode

# Build
bun run build

# Install to OpenCode
bun run install:plugin

# Test
tmux
opencode --port 4096
# Then spawn subagents and verify panes appear
```

Good luck! Focus on extracting the tmux functionality cleanly and making it work as a standalone plugin. Keep the code simple and well-documented.
