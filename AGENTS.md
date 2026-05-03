# AGENTS.md

OpenCode plugin published to npm as `opentmux`. Spawns tmux panes that mirror subagent execution. TypeScript + Bun + tsup, ESM-only, no runtime framework.

## Entrypoints (read these first)

- **Plugin entry**: `src/index.ts` — default-exports `OpencodeAgentTmux: Plugin`. OpenCode loads it when `~/.config/opencode/opencode.json` contains `"plugin": ["opentmux"]`.
- **CLI binary**: `src/bin/opentmux.ts` → `dist/bin/opentmux.js`. This is the "smart wrapper" that end users alias as `opencode`; it detects tmux, picks a port, and exec's the real `opencode`.
- **Postinstall**: `src/scripts/install.ts` → `dist/scripts/install.js`. Print-only: detects the user's shell, prints the snippet they should append to their rc file (alias on bash/zsh/fish, `function opencode` on PowerShell), and lists the legacy marker blocks (`opentmux`, `opencode-agent-tmux`, `opencode-subagent-tmux`) they should remove first. It does **not** read, create, or modify any rc files. The npm `postinstall` script gates on `test -f dist/scripts/install.js`, so it silently no-ops in fresh clones until you `bun run build`.
- **`update-plugins`**: `src/scripts/update-plugins.ts` rewrites entries in the user's `opencode.json` plugin array. It mutates user config — read it before changing.

`src/index.ts` and `src/bin/opentmux.ts` are independent: changing the plugin doesn't touch the wrapper, and vice versa.

## Commands

```bash
bun install
bun run build       # tsup → dist/ (esm). Entries: index, bin/opentmux, scripts/install, scripts/update-plugins
bun run dev         # tsup --watch
bun run typecheck   # tsc --noEmit (strict, ESNext, moduleResolution: bundler)
bun test                                  # Bun's native runner picks up src/**/*.test.ts
bun test src/__tests__/config.test.ts     # single file
```

There is **no `test` script** in `package.json` — call `bun test` directly. Tests live in `src/__tests__/*.test.ts` plus a colocated `src/utils/layout.test.ts` and use `bun:test`.

No ESLint, no Prettier. `bun run typecheck` is the only static check; CI does not currently run tests.

## Config files (user-facing JSON)

`src/utils/config-loader.ts` searches in this order, first hit wins:

1. `<projectDir>/opentmux.json`
2. `<projectDir>/opencode-agent-tmux.json`  *(legacy name, project-level only)*
3. `~/.config/opencode/opentmux.json`

Note the legacy `opencode-agent-tmux.json` name is **only** honoured at the project level — there is no `~/.config/opencode/opencode-agent-tmux.json` fallback.

Schema: `PluginConfigSchema` in `src/config.ts` (Zod). It has many more fields than the README documents — `spawn_delay_ms`, `layout_debounce_ms`, `max_agents_per_column`, all `reaper_*`, `rotate_port`, `max_ports`. Update the README when adding fields.

Runtime log file is `${os.tmpdir()}/opencode-agent-tmux.log`, not `/tmp/opentmux.log` as the README claims.

## Style conventions worth preserving

Not enforced by tooling — easy to break silently:

- `import type` for type-only imports.
- `node:` prefix on built-ins (`node:fs`, `node:path`, `node:child_process`). Plain `'fs'` will typecheck but is wrong here.
- No `.ts` extensions on relative imports (`moduleResolution: bundler`).
- File names: kebab-case. Constants: `UPPER_SNAKE_CASE`. Everything else follows standard TS.

## Release & publish (fully automated — do not bypass)

**Do not** run `npm publish`, do not push `vX.Y.Z` tags by hand, do not edit `package.json` `version` or `CHANGELOG.md` manually. `release-please` owns all of that.

Flow (`.github/workflows/release.yml` + `publish.yml`):

1. Push Conventional Commits (`feat:`, `fix:`, `feat!:` …) to `main`.
2. `google-github-actions/release-please-action@v4` opens or updates a release PR with the version bump and changelog.
3. Merging that PR creates a GitHub Release.
4. The `release: published` event triggers `publish.yml`: `bun install` → `bun run build` → `npm publish --access public --provenance` using **npm trusted publishing (OIDC)**. The workflow explicitly clears `NODE_AUTH_TOKEN` / `NPM_TOKEN` — don't add an `NPM_TOKEN` secret, it would silently disable OIDC.

If release-please isn't producing a PR, the cause is almost always non-conventional commit subjects on `main`.

`docs/LOCAL_DEVELOPMENT.md` still tells contributors to run `npm publish` — that section is stale; ignore it.

## Local dev install

`./scripts/dev-setup.sh` symlinks the npm-global `opentmux` binary at `dist/bin/opentmux.js`, so the existing user `alias opencode='opentmux'` resolves to your working copy. Re-run `bun run build` (or keep `bun run dev` running) to refresh.

## Repo layout gotchas

- Many root-level `*.md` files (`PLAN.md`, `MULTI_PORT.md`, `SETUP_COMPLETE.md`, `SISYPHUS-PROMPT.md`, `TMUX_LAUNCHER.md`) and the root-level `test-*.sh` scripts are historical / pre-current-layout and contain hardcoded paths like `/Users/angansamadder/...`. Treat as scratch, not authoritative. The only live script is `scripts/dev-setup.sh`.
- `.sisyphus/`, `.opencode/`, `ai-todo.md` are gitignored agent scratch. `.kilo/` is untracked local state and `opencode-fake` is a tracked test stub — none of these should be referenced from production code.
- The npm package ships `dist/` only (`files: ["dist"]`).
