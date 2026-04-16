# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue.**
2. Email the maintainer or use [GitHub Security Advisories](https://github.com/konippi/kiro-cli-review-action/security/advisories/new).
3. Include steps to reproduce and potential impact.

We aim to respond within 48 hours and release a fix within 7 days for critical issues.

## Security Model

### Threat: Malicious PR Config Injection

PR authors can modify `.kiro/`, `.amazonq/`, `.gitmodules`, `.husky`, and `AGENTS.md` to inject malicious configurations that kiro-cli reads at startup. This action restores these paths from the base branch before execution.

**References:** CVE-2025-59536, CVE-2026-21852 (Claude Code equivalent vulnerabilities)

### Threat: Prompt Injection via PR Diff

PR diffs are untrusted input. The review agent's system prompt explicitly instructs the LLM to ignore instructions embedded in code. Additionally, `execute_bash` and `fs_write` tools are excluded from the agent and blocked by `preToolUse` hooks.

### Threat: Fork PR Secret Exfiltration

Fork PRs are automatically skipped — secrets are unavailable in `pull_request` workflows triggered from forks. The `isFork` check in the action provides an additional early return.

**⚠️ `pull_request_target` is NOT supported and MUST NOT be used.** It grants fork PRs access to secrets, enabling exfiltration attacks (ref: GhostAction campaign, tj-actions/changed-files CVE-2025-30066).

### Threat: Comment Trigger Abuse

Comment-triggered reviews (`@kiro`) are restricted to trusted users (OWNER, MEMBER, COLLABORATOR `author_association`). User request text is sanitized to mitigate prompt injection: HTML comments, invisible/bidi characters, HTML entities, angle brackets, and markdown image alt text are stripped. Input is truncated to 2048 characters and wrapped in XML delimiters marked as untrusted.

Bot comments are ignored to prevent infinite loops. Only `created` action is processed (not edits/deletes).

## Supported Versions

Only the latest release is supported with security updates.
