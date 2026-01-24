# AGENTS.md

Instructions for AI agents working on opencode-agent-tmux.

## Release Process

This project uses GitHub Actions for automated releases. Follow these steps:

### 1. Prepare Release

```bash
# Make your changes, commit them
git add .
git commit -m "feat: your changes"
git push

# Update version in package.json
# Bump version according to semver:
# - Patch (1.1.x): Bug fixes only
# - Minor (1.x.0): New features, backward compatible
# - Major (x.0.0): Breaking changes
```

### 2. Commit Version Bump

```bash
git add package.json
git commit -m "Bump version to X.Y.Z"
git push
```

### 3. Create GitHub Release

```bash
# Tag the release
git tag vX.Y.Z

# Push the tag
git push origin vX.Y.Z

# Create GitHub release (triggers automatic npm publish)
gh release create vX.Y.Z --title "vX.Y.Z" --notes "## What's Changed

- Feature 1
- Feature 2
- Bug fix 3
"
```

**IMPORTANT**: Do NOT run `npm publish` manually. The GitHub Actions workflow (`.github/workflows/release.yml`) automatically publishes to npm when a GitHub release is created.

### 4. Verify Release

Check that the GitHub Actions workflow completed successfully:
- Go to https://github.com/AnganSamadder/opencode-agent-tmux/actions
- Verify the "Release" workflow passed
- Verify the package published to npm: `npm view opencode-agent-tmux version`

### 5. Update Global Installation (For Maintainer)

```bash
npm install -g opencode-agent-tmux@latest
```

## Local Development

See [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) for contributor setup.

## Configuration

The correct OpenCode config key is `"plugin"` (singular), not `"plugins"`:

```json
{
  "plugin": [
    "opencode-agent-tmux"
  ]
}
```

## Common Tasks

### Test Locally
```bash
./scripts/dev-setup.sh
source ~/.zshrc
opencode
```

### Build
```bash
bun run build
```

### Watch Mode
```bash
bun run dev
```
