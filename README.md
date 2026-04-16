<p align="center">
  <img src="assets/kiro.png" alt="Kiro CLI Review Action" width="120">
</p>

<h1 align="center">Kiro CLI Review Action</h1>

<p align="center">
  Automated PR code review powered by <a href="https://kiro.dev/cli/">Kiro CLI</a>.
  <br>
  Autonomously reads diffs, analyzes code, and posts inline review comments.
</p>

<p align="center">
  <a href="https://github.com/konippi/kiro-cli-review-action/actions/workflows/ci.yml"><img src="https://github.com/konippi/kiro-cli-review-action/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/konippi/kiro-cli-review-action/actions/workflows/e2e.yml"><img src="https://github.com/konippi/kiro-cli-review-action/actions/workflows/e2e.yml/badge.svg" alt="E2E"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

## Usage

### Quick Start

> **Note**: For production use, consider [pinning actions to a full-length commit SHA](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions) for immutable releases.

```yaml
name: Kiro Review
on:
  pull_request:
    types: [opened, ready_for_review]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
      - uses: konippi/kiro-cli-review-action@v1
        with:
          kiro_api_key: ${{ secrets.KIRO_API_KEY }}
```

### With `@kiro` Comment Trigger

Add `issue_comment` to also trigger reviews on demand by commenting `@kiro` on a PR.

```yaml
name: Kiro Review
on:
  pull_request:
    types: [opened, ready_for_review]
  issue_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ github.event.pull_request.head.sha || '' }}
      - uses: konippi/kiro-cli-review-action@v1
        with:
          kiro_api_key: ${{ secrets.KIRO_API_KEY }}
```

The action handles all event filtering internally — only PR comments containing `@kiro` from trusted users (OWNER, MEMBER, COLLABORATOR) are processed. Non-matching events exit immediately without consuming API credits.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `kiro_api_key` | Yes | — | Kiro CLI API key ([Kiro Pro/Pro+/Power](https://kiro.dev) subscription required) |
| `github_token` | No | `GITHUB_TOKEN` env | GitHub token for MCP Server and PR comments |
| `agent` | No | bundled `code-reviewer` | Custom agent name |
| `model` | No | Kiro CLI default | Model ID for Kiro CLI (ignored when `agent` is specified) |
| `prompt` | No | — | Direct prompt to execute without PR context |
| `trigger_phrase` | No | `@kiro` | Trigger phrase for comment-based review |
| `max_diff_size` | No | `10000` | Maximum diff size in characters |
| `debug` | No | `false` | Show full ACP JSON-RPC messages in logs. WARNING: may include tool execution results containing sensitive data. Only enable for debugging in non-sensitive environments |
| `github_mcp_version` | No | `0.32.0` | github-mcp-server version to install |

## Outputs

| Output | Description |
|--------|-------------|
| `review_result` | `pass`, `fail`, or `skip` |
| `exit_code` | `0` (success) or `1` (failure) |

## Customization

Place `.kiro/agents/code-reviewer.json` in your repository (on the default branch) to override the default agent configuration.

> **Note**: Only configurations merged to the base branch take effect. PR-authored changes to `.kiro/` are ignored for security.

## License

[MIT](LICENSE)
