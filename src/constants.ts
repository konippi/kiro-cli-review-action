/** PR-controlled paths that Kiro loads at startup. Restored from the base branch before Kiro runs. */
export const SENSITIVE_PATHS = [
  '.kiro',
  '.amazonq',
  'AGENTS.md',
  'README.md',
  'AmazonQ.md',
] as const;

export const SIGTERM_GRACE_MS = 5_000;

export const MAX_USER_REQUEST_LENGTH = 2048;
