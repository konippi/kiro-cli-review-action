export const GITHUB_MCP_VERSION = '0.32.0';

/**
 * Paths that are PR-controllable and read by kiro-cli at startup.
 * Restored from base branch before kiro-cli execution to prevent
 * RCE via malicious config (CVE-2025-59536 / CVE-2026-21852 equivalent).
 */
export const SENSITIVE_PATHS = ['.kiro', '.amazonq', '.gitmodules', '.husky', 'AGENTS.md'] as const;

export const SIGTERM_GRACE_MS = 5_000;
