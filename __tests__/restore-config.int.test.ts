import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as core from '@actions/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@actions/core', () => ({ info: vi.fn(), warning: vi.fn() }));

import { checkoutPullRequestHead } from '../src/git.js';
import { restoreConfigFromBase, SENSITIVE_PATHS } from '../src/restore-config.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', ...args],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

function commitFiles(cwd: string, message: string, files: Record<string, string>): void {
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), contents);
  }
  git(cwd, 'add', '--all');
  git(cwd, 'commit', '-q', '-m', message);
}

let originRoot: string;
let origin: string;
let pullRequestHeadSha: string;
let originalCwd: string;
let testRoot: string;
let workspace: string;

beforeAll(() => {
  originRoot = mkdtempSync(join(tmpdir(), 'kiro-v1-base-origin-'));
  origin = join(originRoot, 'origin.git');
  const seed = join(originRoot, 'seed');

  git(originRoot, 'init', '-q', '--bare', '--initial-branch=main', origin);
  mkdirSync(seed);
  git(seed, 'init', '-q', '--initial-branch=main');
  commitFiles(seed, 'main configuration', { 'README.md': 'base\n' });

  git(seed, 'switch', '-q', '-c', 'release/v1');
  commitFiles(seed, 'release configuration', {
    'README.md': 'trusted release base\n',
    '.kiro/agents/code-reviewer.json': '{"source":"release/v1"}\n',
  });

  git(seed, 'switch', '-q', '-c', 'pull-request', 'main');
  commitFiles(seed, 'pull request', { 'README.md': 'pull request\n' });
  pullRequestHeadSha = git(seed, 'rev-parse', 'HEAD').trim();

  git(seed, 'push', '-q', origin, 'main', 'release/v1', 'pull-request');
});

beforeEach(() => {
  originalCwd = process.cwd();
  testRoot = mkdtempSync(join(tmpdir(), 'kiro-v1-base-workspace-'));
  workspace = join(testRoot, 'workspace');
  git(testRoot, 'clone', '-q', '--depth=1', '--branch=main', `file://${origin}`, workspace);
  process.chdir(workspace);
  vi.clearAllMocks();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(testRoot, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(originRoot, { recursive: true, force: true });
});

describe('base configuration restoration', () => {
  it('checks out an exact PR head commit with detached HEAD', async () => {
    await checkoutPullRequestHead(pullRequestHeadSha, '', { minSeconds: 0, maxSeconds: 0 });

    expect(git(workspace, 'rev-parse', 'HEAD').trim()).toBe(pullRequestHeadSha);
    expect(() => git(workspace, 'symbolic-ref', '-q', 'HEAD')).toThrow();
  });

  it('restores a non-default base branch in a shallow clone', async () => {
    expect(() =>
      git(workspace, 'show-ref', '--verify', 'refs/remotes/origin/release/v1'),
    ).toThrow();

    writeFileSync(join(workspace, 'README.md'), 'pull request\n');
    mkdirSync(join(workspace, '.kiro', 'agents'), { recursive: true });
    writeFileSync(
      join(workspace, '.kiro', 'agents', 'code-reviewer.json'),
      '{"source":"pull-request"}\n',
    );

    await restoreConfigFromBase('release/v1');

    expect(readFileSync(join(workspace, 'README.md'), 'utf8')).toBe('trusted release base\n');
    expect(readFileSync(join(workspace, '.kiro', 'agents', 'code-reviewer.json'), 'utf8')).toBe(
      '{"source":"release/v1"}\n',
    );
    expect(readFileSync(join(workspace, '.kiro-pr', 'README.md'), 'utf8')).toBe('pull request\n');
    expect(git(workspace, 'show-ref', '--verify', 'refs/remotes/origin/release/v1')).toContain(
      'refs/remotes/origin/release/v1',
    );
  });

  it('removes a pull-request-only path and snapshots it before restoring managed paths', async () => {
    mkdirSync(join(workspace, '.amazonq'));
    writeFileSync(join(workspace, '.amazonq', 'untrusted.json'), '{}');

    const restoredPaths = await restoreConfigFromBase('main');

    expect(existsSync(join(workspace, '.amazonq'))).toBe(false);
    expect(readFileSync(join(workspace, '.kiro-pr', '.amazonq', 'untrusted.json'), 'utf8')).toBe(
      '{}',
    );
    expect(restoredPaths).toEqual(SENSITIVE_PATHS);
  });

  it('throws when checkout fails for a path present on the base', async () => {
    writeFileSync(join(workspace, 'README.md'), 'pull request\n');
    writeFileSync(join(workspace, '.git', 'index.lock'), 'locked');

    await expect(restoreConfigFromBase('main')).rejects.toThrow(
      'Failed to restore README.md from origin/main',
    );
  });

  it('preserves existing exclusions and adds the snapshot exclusion exactly once', async () => {
    const excludePath = join(workspace, '.git', 'info', 'exclude');
    writeFileSync(excludePath, 'existing-pattern\n');

    await restoreConfigFromBase('main');
    await restoreConfigFromBase('main');

    const excludeContents = readFileSync(excludePath, 'utf8');
    const exclusionLines = excludeContents.split(/\r?\n/).filter((line) => line === '/.kiro-pr/');
    expect(excludeContents).toContain('existing-pattern\n');
    expect(exclusionLines).toHaveLength(1);
  });

  it('truncates the snapshot at the configured file-count cap', async () => {
    mkdirSync(join(workspace, '.amazonq'));
    writeFileSync(join(workspace, '.amazonq', 'a.json'), 'a');
    writeFileSync(join(workspace, '.amazonq', 'b.json'), 'b');
    writeFileSync(join(workspace, '.amazonq', 'c.json'), 'c');

    await restoreConfigFromBase('main', undefined, undefined, {
      maxFiles: 2,
      maxBytes: Number.MAX_SAFE_INTEGER,
    });

    const copiedFiles = ['a.json', 'b.json', 'c.json'].filter((name) =>
      existsSync(join(workspace, '.kiro-pr', '.amazonq', name)),
    );
    const truncationNotice = readFileSync(
      join(workspace, '.kiro-pr', 'SNAPSHOT_TRUNCATED.txt'),
      'utf8',
    );
    expect(copiedFiles).toHaveLength(2);
    expect(truncationNotice).toContain('maximum file count (2) would be exceeded');
    expect(core.warning).toHaveBeenCalledTimes(1);
    expect(core.info).toHaveBeenCalledWith('Snapshot: 2 files, 1 placeholders -> .kiro-pr');
  });
});
