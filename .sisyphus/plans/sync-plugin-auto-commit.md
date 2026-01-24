# Sync Plugin Auto-Commit Plan

## Goals
- Make config sync auto-commit and auto-push by default, with opt-out flags.
- Keep synced files tight and safe; never include secrets unless explicitly allowed.
- Ensure sync pulls the improved behavior on future runs.

## Include Targets
- `opencode.json`
- `opencode.jsonc`
- `AGENTS.md`
- `README.md`
- `dcp.jsonc`
- `oh-my-opencode.json`
- `opencode-subagent-tmux.json`
- `opencode-synced.jsonc`
- `.opencode/agent`
- `.opencode/command`
- `.opencode/mode`
- `.opencode/tool`
- `.opencode/themes`
- `.opencode/plugin`
- `profiles/` (if present)

## Exclusions
- `node_modules/`
- `.auto-update.*`
- `*.bak` and `*.backup`
- `antigravity-accounts.json`
- `auth.json`, `mcp-auth.json` unless `includeSecrets=true`
- Sessions and prompt stash unless `includeSessions=true` / `includePromptStash=true`

## Safety Rules
- Skip commit if no changes.
- Never add secrets unless `includeSecrets` is true.
- Only include MCP secrets when `includeMcpSecrets` is true.
- Respect `extraSecretPaths` only when `includeSecrets` is true.

## Implementation Plan
1. Add `autoCommit` and `autoPush` options (default true) to sync config.
2. Update sync flow to use these flags before `git commit`/`git push`.
3. Ensure MCP secret scrubbing remains default unless explicitly allowed.
4. Update `opencode-synced.jsonc` defaults to enable new behavior.
5. Apply updated plugin and sync config repo.
