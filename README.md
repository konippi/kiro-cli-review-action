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
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
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
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: konippi/kiro-cli-review-action@v1
        with:
          kiro_api_key: ${{ secrets.KIRO_API_KEY }}
```

The action handles all event filtering internally. Non-matching events exit immediately without consuming API credits. Accepted comments receive a 👀 reaction, which requires `issues: write`.

## Inputs

| Input | Required | Default | Description |
| ----- | -------- | ------- | ----------- |
| `kiro_api_key` | Yes | — | Kiro CLI API key ([Kiro Pro/Pro+/Power](https://kiro.dev) subscription required) |
| `github_token` | No | `${{ github.token }}` | GitHub token for PR checkout, PR metadata, and the GitHub MCP server |
| `agent` | No | `code-reviewer` | Agent name in `.kiro/agents/<name>.json` |
| `model` | No | Kiro CLI default | Model ID for Kiro CLI (ignored when `agent` is specified) |
| `timeout_minutes` | No | `10` | Kiro execution timeout in minutes (1–360); keep below the job's `timeout-minutes` |
| `prompt` | No | — | Direct prompt to execute without PR context |
| `trigger_phrase` | No | `@kiro` | Trigger phrase for comment-based review |
| `max_diff_size` | No | `10000` | Diff size hint in characters for the reviewer (not enforced) |
| `debug` | No | `false` | Log raw stream-json events and Kiro CLI stderr; may expose sensitive tool output |
| `github_mcp_version` | No | `0.32.0` | github-mcp-server version to install |
| `kiro_cli_version` | No | `2.27.1` | Kiro CLI version to install |

`kiro_cli_version` must be at least `2.27.1` and `github_mcp_version` at least `0.23.0`; older releases lack behaviour this action requires.

## Environment variables

Kiro and its MCP servers receive only standard process variables such as `PATH` and `HOME`, plus these workflow variables:

| Variable | Purpose |
| -------- | ------- |
| `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `http_proxy`, `https_proxy`, `no_proxy` | Proxy for downloads, GitHub API requests, and Kiro/MCP |
| `SSL_CERT_FILE`, `SSL_CERT_DIR` | Custom CA certificates |
| `KIRO_DISABLE_TELEMETRY` | Set to `true` to disable Kiro telemetry |

## Outputs

| Output | Description |
| ------ | ----------- |
| `conclusion` | `success`, `skipped`, `timed_out`, `mcp_startup_failure`, `agent_not_loaded`, `run_error`, `incomplete`, or `setup_error` |

The step fails for every conclusion except `success` and `skipped`. Use `steps.<id>.outcome` for success or failure and `steps.<id>.outputs.conclusion` for the reason:

```yaml
- id: review
  uses: konippi/kiro-cli-review-action@v1
  continue-on-error: true
  with:
    kiro_api_key: ${{ secrets.KIRO_API_KEY }}
- if: steps.review.outcome == 'failure'
  run: echo "Kiro review failed: $CONCLUSION"
  env:
    CONCLUSION: ${{ steps.review.outputs.conclusion }}
```

## Customization

Place `.kiro/agents/code-reviewer.json` in your repository (on the base branch) to override the default agent configuration. Custom agents contribute prompt, resources, model, and MCP servers; the tool policy is fixed by the action.

## Security

See [SECURITY.md](SECURITY.md) for the security model and vulnerability reporting.

## License

[MIT](LICENSE)
