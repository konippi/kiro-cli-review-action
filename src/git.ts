import { execFileSync } from 'node:child_process';
import * as core from '@actions/core';
import { type RetryOptions, withRetry } from './retry.js';

const COMMIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const SAFE_GIT_ARGS = ['-c', 'core.hooksPath=/dev/null', '-c', 'submodule.recurse=false'] as const;

/** Prefix arguments with options that disable hooks and recursive submodules. */
export function gitArgs(...args: string[]): string[] {
  return [...SAFE_GIT_ARGS, ...args];
}

/** Run a hardened git command and wrap failures with a safe message. */
export function git(
  args: string[],
  failureMessage: string,
  options?: { env?: NodeJS.ProcessEnv; stdio?: 'inherit' | 'pipe' },
): string {
  try {
    const commandOutput = execFileSync('git', gitArgs(...args), {
      encoding: 'utf8',
      ...options,
    });

    return typeof commandOutput === 'string' ? commandOutput.trim() : '';
  } catch (error: unknown) {
    throw new Error(failureMessage, { cause: error });
  }
}

/** Validate that a value is a full hexadecimal commit SHA. */
export function validateCommitSha(commitSha: string): void {
  if (!COMMIT_SHA_PATTERN.test(commitSha)) {
    throw new Error('Invalid commit SHA');
  }
}

/** Build an environment with token authentication appended and scoped to the GitHub origin. */
export function buildGitAuthEnv(parentEnv: NodeJS.ProcessEnv, token: string): NodeJS.ProcessEnv {
  if (!token) {
    return parentEnv;
  }

  const encodedCredentials = Buffer.from(`x-access-token:${token}`).toString('base64');
  core.setSecret(encodedCredentials);

  const origin = new URL(parentEnv.GITHUB_SERVER_URL || 'https://github.com').origin;
  const parsedCount = Number.parseInt(parentEnv.GIT_CONFIG_COUNT ?? '', 10);
  const count = Number.isNaN(parsedCount) || parsedCount < 0 ? 0 : parsedCount;

  return {
    ...parentEnv,
    GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: `http.${origin}/.extraheader`,
    [`GIT_CONFIG_VALUE_${count}`]: `AUTHORIZATION: basic ${encodedCredentials}`,
  };
}

/** Fetch and check out a pull request head commit in detached HEAD state. */
export async function checkoutPullRequestHead(
  headSha: string,
  token: string,
  options?: RetryOptions,
): Promise<void> {
  validateCommitSha(headSha);

  const shallowCheckFailureMessage = 'Failed to determine whether the repository is shallow';
  const isShallowRepository =
    git(['rev-parse', '--is-shallow-repository'], shallowCheckFailureMessage) === 'true';

  const fetchArgs = [
    'fetch',
    '--no-tags',
    '--no-recurse-submodules',
    ...(isShallowRepository ? ['--depth=1'] : []),
    'origin',
    headSha,
  ];
  const headLabel = `PR head ${headSha}`;
  const gitAuthEnv = buildGitAuthEnv(process.env, token);

  await withRetry(async () => {
    git(fetchArgs, `Failed to fetch ${headLabel}`, { stdio: 'inherit', env: gitAuthEnv });
  }, options);

  const checkoutArgs = ['checkout', '--detach', headSha, '--'];

  git(checkoutArgs, `Failed to check out ${headLabel}`, { stdio: 'inherit' });

  core.info(`Checked out ${headLabel}`);
}
