# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue.**
2. Email the maintainer or use [GitHub Security Advisories](https://github.com/konippi/kiro-cli-review-action/security/advisories/new).
3. Include steps to reproduce and potential impact.

We aim to respond within 48 hours and release a fix within 7 days for critical issues.

## Security Model

### Threat: Malicious PR Config Injection

PR authors can modify `.kiro/`, `.amazonq/`, `.gitmodules`, and `.husky` to inject malicious configurations that kiro-cli reads at startup. This action restores these paths from the base branch before execution.

**References:** CVE-2025-59536, CVE-2026-21852 (Claude Code equivalent vulnerabilities)

### Threat: Prompt Injection via PR Diff

PR diffs are untrusted input. The review agent's system prompt explicitly instructs the LLM to ignore instructions embedded in code. Additionally, `execute_bash` and `fs_write` tools are excluded from the agent and blocked by `preToolUse` hooks.

### Threat: Fork PR Secret Exfiltration

This action uses `pull_request` trigger only. Fork PRs receive a read-only `GITHUB_TOKEN` with no access to repository secrets.

**⚠️ `pull_request_target` is NOT supported and MUST NOT be used.** It grants fork PRs access to secrets, enabling exfiltration attacks (ref: GhostAction campaign, tj-actions/changed-files CVE-2025-30066).

### Threat: Supply Chain Attack

- All GitHub Actions in CI workflows are pinned by commit SHA (not tags)
- github-mcp-server binary is version-pinned. kiro-cli is installed via the official script with SHA256 checksum verification
- `.npmrc` enforces `ignore-scripts=true`, `save-exact=true`, and `min-release-age=1`
- `actions/checkout` uses `persist-credentials: false`

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | ✅        |
