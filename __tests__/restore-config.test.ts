import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceMocks = vi.hoisted(() => {
  const calls: string[] = [];

  return {
    calls,
    buildGitAuthEnv: vi.fn(),
    checkoutPullRequestHead: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({
  copyFileSync: vi.fn(),
  lstatSync: vi.fn(() => ({
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
    size: 0,
  })),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(() => ''),
  readlinkSync: vi.fn(),
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('../src/git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/git.js')>();
  return {
    ...actual,
    buildGitAuthEnv: workspaceMocks.buildGitAuthEnv,
    checkoutPullRequestHead: workspaceMocks.checkoutPullRequestHead,
  };
});
vi.mock('@actions/core', () => ({ info: vi.fn(), warning: vi.fn() }));

import { execFileSync } from 'node:child_process';
import { lstatSync, rmSync } from 'node:fs';
import * as core from '@actions/core';
import { prepareWorkspace, restoreConfigFromBase, SENSITIVE_PATHS } from '../src/restore-config.js';
import { createPullRequestTarget } from './helpers/context.js';

const mockExecFileSync = vi.mocked(execFileSync);
const mockLstatSync = vi.mocked(lstatSync);
const SAFE_GIT_ARGS = ['-c', 'core.hooksPath=/dev/null', '-c', 'submodule.recurse=false'];
const NO_WAIT = { minSeconds: 0, maxSeconds: 0 };

function gitCommand(args: readonly string[] | null | undefined): string | undefined {
  return args?.[SAFE_GIT_ARGS.length];
}

beforeEach(() => {
  vi.resetAllMocks();
  workspaceMocks.calls.length = 0;
  mockExecFileSync.mockImplementation((_file, args) =>
    gitCommand(args) === 'rev-parse' ? '.git\n' : Buffer.alloc(0),
  );
  mockLstatSync.mockImplementation(() => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  });
});

describe('restoreConfigFromBase', () => {
  it.each(['main; rm -rf /', '', '$(whoami)', '../../etc'])(
    'throws on invalid branch name: %s',
    async (branch) =>
      await expect(restoreConfigFromBase(branch)).rejects.toThrow('Invalid branch name'),
  );

  it('hardens every git call and passes auth only to the explicit base fetch', async () => {
    const env = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'header' };
    await restoreConfigFromBase('feature/my-branch.1', env, NO_WAIT);

    for (const [file, args] of mockExecFileSync.mock.calls) {
      expect(file).toBe('git');
      expect(args?.slice(0, SAFE_GIT_ARGS.length)).toEqual(SAFE_GIT_ARGS);
    }
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      [
        ...SAFE_GIT_ARGS,
        'fetch',
        'origin',
        '+refs/heads/feature/my-branch.1:refs/remotes/origin/feature/my-branch.1',
        '--depth=1',
        '--no-recurse-submodules',
      ],
      { encoding: 'utf8', stdio: 'inherit', env },
    );
    const nonFetchCalls = mockExecFileSync.mock.calls.filter(
      ([, args]) => gitCommand(args) !== 'fetch',
    );
    expect(nonFetchCalls).not.toHaveLength(0);
    const catFileCalls = nonFetchCalls.filter(([, args]) => gitCommand(args) === 'cat-file');
    expect(catFileCalls).toHaveLength(SENSITIVE_PATHS.length);
    const checkoutCalls = nonFetchCalls.filter(([, args]) => gitCommand(args) === 'checkout');
    expect(checkoutCalls).toHaveLength(SENSITIVE_PATHS.length);
    for (const sensitivePath of SENSITIVE_PATHS) {
      const catFile = mockExecFileSync.mock.calls.findIndex(([, args]) =>
        args?.includes(`origin/feature/my-branch.1:${sensitivePath}`),
      );
      const checkout = mockExecFileSync.mock.calls.findIndex(
        ([, args]) => args?.includes('checkout') && args.includes(sensitivePath),
      );
      expect(catFile).toBeGreaterThanOrEqual(0);
      expect(checkout).toBeGreaterThan(catFile);
    }
    for (const call of [...catFileCalls, ...checkoutCalls]) {
      expect(call[2]).toEqual(expect.objectContaining({ stdio: 'pipe' }));
    }
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      [...SAFE_GIT_ARGS, 'reset', '--', ...SENSITIVE_PATHS],
      expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' }),
    );
    for (const call of nonFetchCalls) {
      expect(call[2]).not.toHaveProperty('env');
    }
  });

  it('classifies cat-file failures as paths absent from the base', async () => {
    mockExecFileSync.mockImplementation((_file, args) => {
      if (gitCommand(args) === 'rev-parse') return '.git\n';
      if (gitCommand(args) === 'cat-file' || gitCommand(args) === 'reset') {
        throw new Error('git failed');
      }
      return Buffer.alloc(0);
    });

    await restoreConfigFromBase('main', undefined, NO_WAIT);

    expect(
      mockExecFileSync.mock.calls.filter(([, args]) => gitCommand(args) === 'checkout'),
    ).toHaveLength(0);
    expect(
      mockExecFileSync.mock.calls.filter(([, args]) => gitCommand(args) === 'reset'),
    ).toHaveLength(0);
    for (const sensitivePath of SENSITIVE_PATHS) {
      expect(core.info).toHaveBeenCalledWith(
        `${sensitivePath} is not on origin/main; left removed`,
      );
    }
  });

  it('propagates reset failures when at least one path was restored', async () => {
    const restoredPath = 'README.md';

    mockExecFileSync.mockImplementation((_file, args) => {
      if (gitCommand(args) === 'rev-parse') return '.git\n';
      if (gitCommand(args) === 'cat-file' && !args?.includes(`origin/main:${restoredPath}`)) {
        throw new Error('path absent');
      }
      if (gitCommand(args) === 'reset') throw new Error('reset failed');
      return Buffer.alloc(0);
    });

    await expect(restoreConfigFromBase('main', undefined, NO_WAIT)).rejects.toThrow(
      'Failed to unstage restored configuration',
    );
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      [...SAFE_GIT_ARGS, 'reset', '--', restoredPath],
      expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' }),
    );
  });

  it('retries the base fetch twice before restoring config', async () => {
    let fetchAttempts = 0;
    mockExecFileSync.mockImplementation((_file, args) => {
      if (gitCommand(args) === 'rev-parse') return '.git\n';
      if (gitCommand(args) === 'fetch' && ++fetchAttempts < 3) {
        throw new Error('git fetch failed');
      }
      return Buffer.alloc(0);
    });

    await restoreConfigFromBase('main', undefined, NO_WAIT);

    const fetchCalls = mockExecFileSync.mock.calls.filter(
      ([, args]) => gitCommand(args) === 'fetch',
    );
    expect(fetchCalls).toHaveLength(3);
    expect(fetchCalls.every((call) => call[2]?.stdio === 'inherit')).toBe(true);
    expect(
      vi
        .mocked(core.info)
        .mock.calls.filter(([message]) => message === 'Waiting 0 seconds before trying again'),
    ).toHaveLength(2);
  });

  it('propagates lstat errors other than ENOENT', async () => {
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    mockLstatSync.mockImplementation(() => {
      throw denied;
    });

    await expect(restoreConfigFromBase('main', undefined, NO_WAIT)).rejects.toBe(denied);
  });

  it('deletes PR-controlled paths before fetching the base branch', async () => {
    await restoreConfigFromBase('main', undefined, NO_WAIT);
    const firstSensitiveDelete = vi
      .mocked(rmSync)
      .mock.calls.findIndex(([path]) => path === '.kiro');
    const fetch = mockExecFileSync.mock.calls.findIndex(([, args]) => args?.includes('fetch'));
    expect(firstSensitiveDelete).toBeGreaterThanOrEqual(0);
    expect(fetch).toBeGreaterThanOrEqual(0);
    expect(vi.mocked(rmSync).mock.invocationCallOrder[firstSensitiveDelete]).toBeLessThan(
      mockExecFileSync.mock.invocationCallOrder[fetch] ?? Number.POSITIVE_INFINITY,
    );
  });
});

describe('prepareWorkspace', () => {
  it('checks out the head before restoring the base with authenticated git', async () => {
    const target = createPullRequestTarget();
    const gitEnvironment = { SAFE: 'true' };
    workspaceMocks.checkoutPullRequestHead.mockImplementationOnce(async () => {
      workspaceMocks.calls.push('checkout');
    });
    workspaceMocks.buildGitAuthEnv.mockImplementationOnce(() => {
      workspaceMocks.calls.push('auth');
      return gitEnvironment;
    });

    await prepareWorkspace(target, 'github-token');

    expect(workspaceMocks.calls).toEqual(['checkout', 'auth']);
    expect(workspaceMocks.checkoutPullRequestHead).toHaveBeenCalledWith(
      target.headSha,
      'github-token',
    );
    expect(workspaceMocks.buildGitAuthEnv).toHaveBeenCalledWith(process.env, 'github-token');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      [
        ...SAFE_GIT_ARGS,
        'fetch',
        'origin',
        `+refs/heads/${target.baseBranch}:refs/remotes/origin/${target.baseBranch}`,
        '--depth=1',
        '--no-recurse-submodules',
      ],
      { encoding: 'utf8', stdio: 'inherit', env: gitEnvironment },
    );
  });
});
