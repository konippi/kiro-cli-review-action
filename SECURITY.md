# Security Policy

## Reporting a Vulnerability

Do not open public issues for security vulnerabilities. Report them privately through [GitHub Security Advisories](https://github.com/konippi/kiro-cli-review-action/security/advisories/new).

## Supported Versions

Only the latest release is supported with security updates.

## Security Model

### Trust Boundaries

Workflow authors and configuration from a pull request's base branch are trusted, including custom agents and their MCP server commands. Pull request content is untrusted, including diffs, files, comment text, and fork code.

### Configuration and Tool Isolation

Before Kiro runs, the action restores `.kiro/`, `.amazonq/`, `AGENTS.md`, `README.md`, `AmazonQ.md`, and `CONTRIBUTING.md` from the base branch in PR and comment modes, and in prompt mode on `pull_request` events.

Kiro loads only the generated agent, from `KIRO_AGENT_CONFIG_DIR` outside the checkout, and never workspace agents or `mcp.json`. The generated agent has no hooks and exposes only the read-only `read`, `grep`, and `glob` built-ins, which are approved for workspace paths only. Kiro's implicit default resources stay off unless the base branch's `.kiro/settings/cli.json` re-enables them. Files referenced by a custom agent's `prompt` or `resources` may be outside the workspace, but inside it they should, like custom MCP commands, use only paths restored from the base branch because other workspace paths come from the PR. The GitHub MCP server is limited to `pull_request_read`, `pull_request_review_write`, and `add_comment_to_pending_review`, which can still submit any review event, including approvals, on pull requests the token can reach. Grant only the permissions documented in the README, and keep **Allow GitHub Actions to create and approve pull requests** disabled so `GITHUB_TOKEN` cannot approve.

If the generated agent cannot be loaded, Kiro exits with `agent_not_loaded` instead of falling back to its default agent; the action accepts only Kiro CLI versions that provide this behaviour.

### Credentials and Downloads

From the workflow, Kiro receives only the Kiro API key and GitHub token supplied through the action inputs and the [documented environment variables](README.md#environment-variables). Every MCP server, including custom ones, inherits this environment and therefore both credentials; trusted custom MCP definitions may add explicit environment entries.

Default tool versions are verified against SHA-256 digests embedded in the action. Overridden versions are verified against the release's published checksums from the same host, which detect corruption but not a compromised release host. Tools are installed via the Actions tool cache.

### Workflow Hardening

Do not run this action on `pull_request_target`; that event can expose base-repository secrets while processing untrusted content and is unsupported. Automatic `pull_request` runs from forks are skipped.

Comment triggers require repository write access. An authorized comment on a fork pull request checks out fork code, so trigger one only after trusting the code being reviewed.

Configure custom MCP server commands to invoke installed binaries directly, not pull-request-controlled scripts or executable configuration. Grant the workflow only the permissions it needs, and treat generated comments as untrusted until reviewed.

### Reporting Scope

Report bypasses of these boundaries or controls and unintended access to secrets, repository contents, or GitHub operations. Behavior explicitly authorized by trusted base-branch configuration or custom MCP servers, and model output quality alone, are out of scope.
