import type { PullRequestTarget } from '../../src/context.js';

/** Creates a valid pull request target with optional test-specific overrides. */
export function createPullRequestTarget(
  overrides: Partial<PullRequestTarget> = {},
): PullRequestTarget {
  return {
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 42,
    baseBranch: 'main',
    headSha: '0123456789abcdef0123456789abcdef01234567',
    isFork: false,
    ...overrides,
  };
}
