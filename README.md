[![CI](https://github.com/konippi/kiro-cli-review-action/actions/workflows/ci.yml/badge.svg)](https://github.com/konippi/kiro-cli-review-action/actions/workflows/ci.yml)
[![E2E](https://github.com/konippi/kiro-cli-review-action/actions/workflows/e2e.yml/badge.svg)](https://github.com/konippi/kiro-cli-review-action/actions/workflows/e2e.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

# Kiro CLI Review Action

Automated PR code review using [kiro-cli](https://kiro.dev/cli/) with ACP (Agent Client Protocol) integration.

## Usage

```yaml
name: Kiro Review
on:
  pull_request:
    types: [opened, synchronize, ready_for_review]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          persist-credentials: false
      - uses: konippi/kiro-cli-review-action@0000000000000000000000000000000000000000 # v0
        with:
          kiro_api_key: ${{ secrets.KIRO_API_KEY }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `kiro_api_key` | Yes | — | Kiro CLI API key ([generate here](https://app.kiro.dev)) |
| `github_token` | No | `GITHUB_TOKEN` env | GitHub token for MCP Server and PR comments |
| `agent` | No | bundled `code-reviewer` | Custom agent name |
| `prompt` | No | — | Direct prompt to execute without PR context |
| `max_diff_size` | No | `10000` | Maximum diff size in characters |
| `debug` | No | `false` | Show full ACP messages in logs. Only enable in non-sensitive environments |
| `github_mcp_version` | No | `0.32.0` | github-mcp-server version to install |

## Outputs

| Output | Description |
|--------|-------------|
| `review_result` | `pass`, `fail`, or `skip` |
| `exit_code` | `0` (success) or `1` (failure) |

## How It Works

1. Restores `.kiro/` config from base branch (prevents malicious config injection)
2. Installs kiro-cli and github-mcp-server
3. Starts ACP session with the `code-reviewer` agent
4. kiro-cli autonomously reviews the PR diff and posts inline comments via GitHub MCP Server

## Security

- **Config restoration**: `.kiro/`, `.amazonq/`, `.gitmodules`, `.husky`, `AGENTS.md` are restored from the base branch before kiro-cli execution to prevent RCE via malicious config files
- **Tool restriction**: Only read-only tools (`fs_read`, `grep`, `glob`, `code`) and GitHub MCP tools are available. `execute_bash` and `fs_write` are blocked by both agent config and hooks
- **Fork PR safety**: Uses `pull_request` trigger only. `pull_request_target` is **not supported** and must not be used
- **Secret masking**: `KIRO_API_KEY` and `GITHUB_TOKEN` are masked in logs via `core.setSecret()`
- **Binary pinning**: github-mcp-server version is pinned. kiro-cli is installed via the official script (which verifies SHA256 checksums internally)

See [SECURITY.md](SECURITY.md) for the full security model.

## Customization

Place `.kiro/agents/code-reviewer.json` in your repository (on the default branch) to override the default agent configuration.

> **Note**: Only configurations merged to the base branch take effect. PR-authored changes to `.kiro/` are ignored for security.

## Development

```bash
pnpm install
pnpm run check    # lint + typecheck + test
pnpm run build    # bundle to dist/
```

## License

[MIT](LICENSE)
