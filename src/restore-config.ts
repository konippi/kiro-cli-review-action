import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import * as core from '@actions/core';
import type { PullRequestTarget } from './context.js';
import { isErrnoException } from './errors.js';
import { buildGitAuthEnv, checkoutPullRequestHead, git } from './git.js';
import { type RetryOptions, withRetry } from './retry.js';

/** PR-controlled paths that Kiro loads at startup. Restored from the base branch before Kiro runs. */
export const SENSITIVE_PATHS = [
  '.kiro',
  '.amazonq',
  'AGENTS.md',
  'README.md',
  'AmazonQ.md',
  'CONTRIBUTING.md',
] as const;

const SNAPSHOT_DIRECTORY = '.kiro-pr';
const SNAPSHOT_EXCLUSION = '/.kiro-pr/';
const SNAPSHOT_MAX_FILES = 1_000;
const SNAPSHOT_MAX_BYTES = 50 * 1024 * 1024;

interface SnapshotLimits {
  maxFiles?: number;
  maxBytes?: number;
}

interface SnapshotState {
  copiedFiles: number;
  placeholders: number;
  totalFiles: number;
  totalBytes: number;
  truncated: boolean;
}

function truncateSnapshot(reason: string, state: SnapshotState): void {
  if (state.truncated) return;

  const message = `Snapshot truncated: ${reason}.`;

  mkdirSync(SNAPSHOT_DIRECTORY, { recursive: true });
  writeFileSync(join(SNAPSHOT_DIRECTORY, 'SNAPSHOT_TRUNCATED.txt'), `${message}\n`);
  state.placeholders += 1;
  state.truncated = true;
  core.warning(message);
}

function snapshotConfigPath(
  source: string,
  destination: string,
  state: SnapshotState,
  limits: Required<SnapshotLimits>,
): void {
  if (state.truncated) return;

  let sourceStats: ReturnType<typeof lstatSync>;

  try {
    sourceStats = lstatSync(source);
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === 'ENOENT') return;

    throw error;
  }

  if (sourceStats.isSymbolicLink()) {
    if (state.totalFiles + 1 > limits.maxFiles) {
      truncateSnapshot(`maximum file count (${limits.maxFiles}) would be exceeded`, state);
      return;
    }

    const linkTarget = readlinkSync(source);

    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, `Symbolic link not copied: ${source} -> ${linkTarget}\n`);
    state.totalFiles += 1;
    state.placeholders += 1;
    core.warning(
      `Stored a placeholder instead of symbolic link ${JSON.stringify(source)} -> ${JSON.stringify(linkTarget)}`,
    );

    return;
  }

  if (sourceStats.isDirectory()) {
    mkdirSync(destination, { recursive: true });

    for (const directoryEntry of readdirSync(source)) {
      snapshotConfigPath(
        join(source, directoryEntry),
        join(destination, directoryEntry),
        state,
        limits,
      );
      if (state.truncated) break;
    }

    return;
  }

  if (!sourceStats.isFile()) return;

  if (state.totalFiles + 1 > limits.maxFiles) {
    truncateSnapshot(`maximum file count (${limits.maxFiles}) would be exceeded`, state);
    return;
  }

  if (state.totalBytes + sourceStats.size > limits.maxBytes) {
    truncateSnapshot(`maximum byte count (${limits.maxBytes}) would be exceeded`, state);
    return;
  }

  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  state.copiedFiles += 1;
  state.totalFiles += 1;
  state.totalBytes += sourceStats.size;
}

function snapshotPullRequestConfig(limits: SnapshotLimits): void {
  const resolvedLimits = {
    maxFiles: limits.maxFiles ?? SNAPSHOT_MAX_FILES,
    maxBytes: limits.maxBytes ?? SNAPSHOT_MAX_BYTES,
  };
  const state: SnapshotState = {
    copiedFiles: 0,
    placeholders: 0,
    totalFiles: 0,
    totalBytes: 0,
    truncated: false,
  };

  rmSync(SNAPSHOT_DIRECTORY, { recursive: true, force: true });

  for (const sensitivePath of SENSITIVE_PATHS) {
    snapshotConfigPath(
      sensitivePath,
      join(SNAPSHOT_DIRECTORY, sensitivePath),
      state,
      resolvedLimits,
    );
    if (state.truncated) break;
  }

  core.info(
    `Snapshot: ${state.copiedFiles} files, ${state.placeholders} placeholders -> ${SNAPSHOT_DIRECTORY}`,
  );
}

function ensureSnapshotExcluded(): void {
  const gitDirectory = git(['rev-parse', '--git-dir'], 'Failed to resolve git directory', {
    stdio: 'pipe',
  });
  const excludePath = join(gitDirectory, 'info', 'exclude');
  let excludeContents = '';

  try {
    excludeContents = readFileSync(excludePath, 'utf8');
  } catch (error: unknown) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
  }

  const lines = excludeContents.split(/\r?\n/);
  const exclusionCount = lines.filter((line) => line === SNAPSHOT_EXCLUSION).length;

  mkdirSync(dirname(excludePath), { recursive: true });

  if (exclusionCount === 0) {
    const separator = excludeContents.length > 0 && !excludeContents.endsWith('\n') ? '\n' : '';

    writeFileSync(excludePath, `${excludeContents}${separator}${SNAPSHOT_EXCLUSION}\n`);
    return;
  }

  if (exclusionCount > 1) {
    let foundExclusion = false;
    const deduplicatedLines = lines.filter((line) => {
      if (line !== SNAPSHOT_EXCLUSION) return true;
      if (foundExclusion) return false;

      foundExclusion = true;
      return true;
    });

    writeFileSync(excludePath, deduplicatedLines.join('\n'));
  }
}

/** Restore Kiro config and context from the base branch before Kiro runs. */
export async function restoreConfigFromBase(
  baseBranch: string,
  gitEnvironment?: NodeJS.ProcessEnv,
  retryOptions?: RetryOptions,
  limits: SnapshotLimits = {},
): Promise<void> {
  if (!/^[\w.\-/]+$/.test(baseBranch) || baseBranch.includes('..')) {
    throw new Error(`Invalid branch name: ${baseBranch}`);
  }

  core.info(`Restoring ${SENSITIVE_PATHS.join(', ')} from origin/${baseBranch}`);

  // Back up PR versions for review agent inspection.
  snapshotPullRequestConfig(limits);
  ensureSnapshotExcluded();

  // Delete PR versions before fetching the base branch.
  for (const sensitivePath of SENSITIVE_PATHS) {
    rmSync(sensitivePath, { recursive: true, force: true });
  }

  const baseRevision = `origin/${baseBranch}`;
  const baseRefspec = `+refs/heads/${baseBranch}:refs/remotes/${baseRevision}`;

  await withRetry(async () => {
    git(
      ['fetch', 'origin', baseRefspec, '--depth=1', '--no-recurse-submodules'],
      `Failed to fetch base branch ${baseBranch}`,
      { stdio: 'inherit', ...(gitEnvironment ? { env: gitEnvironment } : {}) },
    );
  }, retryOptions);

  const restoredPaths: string[] = [];

  for (const sensitivePath of SENSITIVE_PATHS) {
    try {
      git(
        ['cat-file', '-e', `${baseRevision}:${sensitivePath}`],
        `Failed to find ${sensitivePath} on ${baseRevision}`,
        { stdio: 'pipe' },
      );
    } catch {
      core.info(`${sensitivePath} is not on ${baseRevision}; left removed`);
      continue;
    }

    git(
      ['checkout', baseRevision, '--', sensitivePath],
      `Failed to restore ${sensitivePath} from ${baseRevision}`,
      { stdio: 'pipe' },
    );
    restoredPaths.push(sensitivePath);
  }

  if (restoredPaths.length > 0) {
    git(['reset', '--', ...restoredPaths], 'Failed to unstage restored configuration', {
      stdio: 'pipe',
    });
  }
}

/** Checks out the pull request head and restores trusted base configuration. */
export async function prepareWorkspace(
  target: PullRequestTarget,
  githubToken: string,
): Promise<void> {
  await checkoutPullRequestHead(target.headSha, githubToken);
  await restoreConfigFromBase(target.baseBranch, buildGitAuthEnv(process.env, githubToken));
}
