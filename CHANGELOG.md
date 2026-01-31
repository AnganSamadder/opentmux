# Changelog

## v1.3.0

Summary
- Smart multi-column layout update with safer config handling for OpenCode.

Highlights
- Multi-column tmux layout for balanced agent panes.
- Hard-coded main pane sizing for predictable focus.
- Config safety fix to avoid writing the wrong `plugins` key.

Behavior Changes
- Tmux layout now prefers multi-column for agent sessions with a fixed main pane size.
- Plugin config writes stay aligned with `plugin` (singular) to prevent invalid OpenCode config.

Upgrade Notes
- No action required; layout updates apply automatically. Verify any custom tmux layout overrides.

## v1.2.7

Summary
- Re-release of v1.2.5 to supersede the glitchy v1.2.6 publish.

Highlights
- No functional changes; metadata-only bump for a clean patch line.

Behavior Changes
- None. Behavior is identical to v1.2.5.

Upgrade Notes
- Safe to upgrade from v1.2.5 or v1.2.6. No config changes required.
