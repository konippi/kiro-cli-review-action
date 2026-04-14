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
| `kiro_api_key` | Yes | — | Kiro CLI API key |
| `github_token` | No | `${{ github.token }}` | GitHub token for PR comments |
| `agent` | No | bundled `code-reviewer` | Custom agent JSON path |
| `max_diff_size` | No | `10000` | Maximum diff size in characters |
| `timeout_minutes` | No | `5` | Execution timeout |
| `debug` | No | `false` | Show full output (⚠️ may expose secrets) |

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

- **Config restoration**: `.kiro/`, `.mcp.json`, `.gitmodules`, `.husky` are restored from the base branch before kiro-cli execution to prevent RCE via malicious config files
- **Tool restriction**: Only read-only tools (`fs_read`, `grep`, `glob`, `code`) and GitHub MCP tools are available. `execute_bash` and `fs_write` are blocked by both agent config and hooks
- **Fork PR safety**: Uses `pull_request` trigger only. `pull_request_target` is **not supported** and must not be used
- **Secret masking**: `KIRO_API_KEY` and `GITHUB_TOKEN` are masked in logs via `core.setSecret()`
- **Binary pinning**: github-mcp-server version is pinned. kiro-cli is installed via the official script with SHA256 checksum verification

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
