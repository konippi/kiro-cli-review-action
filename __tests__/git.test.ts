import { execFileSync } from 'node:child_process';
import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('@actions/core', () => ({ info: vi.fn(), setSecret: vi.fn() }));

import { buildGitAuthEnv, checkoutPullRequestHead, validateCommitSha } from '../src/git.js';

const mockExecFileSync = vi.mocked(execFileSync);
const SAFE_GIT_ARGS = ['-c', 'core.hooksPath=/dev/null', '-c', 'submodule.recurse=false'];
const NO_WAIT = { minSeconds: 0, maxSeconds: 0 };
const sha40 = '0123456789abcdef0123456789abcdef01234567';
const sha64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.GITHUB_SERVER_URL;
});

afterEach(() => {
  delete process.env.GITHUB_SERVER_URL;
});

describe('git command hardening', () => {
  it('accepts valid commit SHAs and rejects invalid values', () => {
    for (const sha of [sha40, sha64]) expect(() => validateCommitSha(sha)).not.toThrow();
    for (const sha of ['abc123', `${sha40}0`, sha40.toUpperCase(), '', 'g'.repeat(40)]) {
      expect(() => validateCommitSha(sha)).toThrow('Invalid commit SHA');
    }
  });
});

describe('buildGitAuthEnv', () => {
  it('keeps empty-token environments unchanged', () => {
    const parentEnv = { PATH: '/usr/bin' };

    expect(buildGitAuthEnv(parentEnv, '')).toBe(parentEnv);
  });

  it.each([
    {
      name: 'no existing count',
      parentEnv: { PATH: '/usr/bin' },
      expected: {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      },
    },
    {
      name: 'an invalid existing count',
      parentEnv: { PATH: '/usr/bin', GIT_CONFIG_COUNT: 'abc' },
      expected: {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      },
    },
    {
      name: 'an existing config entry',
      parentEnv: {
        GITHUB_SERVER_URL: 'https://github.example.com/enterprise/',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'safe.directory',
        GIT_CONFIG_VALUE_0: '/workspace',
      },
      expected: {
        GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: 'safe.directory',
        GIT_CONFIG_VALUE_0: '/workspace',
        GIT_CONFIG_KEY_1: 'http.https://github.example.com/.extraheader',
      },
    },
  ])('appends a masked scoped header after $name', ({ parentEnv, expected }) => {
    const encoded = Buffer.from('x-access-token:secret-token').toString('base64');
    const index = Number.parseInt(expected.GIT_CONFIG_COUNT, 10) - 1;

    expect(buildGitAuthEnv(parentEnv, 'secret-token')).toEqual({
      ...parentEnv,
      ...expected,
      [`GIT_CONFIG_VALUE_${index}`]: `AUTHORIZATION: basic ${encoded}`,
    });
    expect(core.setSecret).toHaveBeenCalledWith(encoded);
  });
});

describe('checkoutPullRequestHead', () => {
  function command(args: readonly unknown[] | undefined): unknown[] {
    return [...(args ?? [])].slice(SAFE_GIT_ARGS.length);
  }

  function callsFor(subcommand: string) {
    return mockExecFileSync.mock.calls.filter(([, args]) => command(args)[0] === subcommand);
  }

  function mockGit(shallow: boolean): void {
    mockExecFileSync.mockImplementation((_file, args) => {
      const gitCommand = command(args);
      if (gitCommand[0] === 'rev-parse' && gitCommand[1] === '--is-shallow-repository') {
        return `${shallow}\n`;
      }
      return Buffer.alloc(0);
    });
  }

  it('fetches with auth and shallow depth and checks out detached', async () => {
    mockGit(true);
    await checkoutPullRequestHead(sha40, 'token', NO_WAIT);

    expect(callsFor('fetch')).toEqual([
      [
        'git',
        [
          ...SAFE_GIT_ARGS,
          'fetch',
          '--no-tags',
          '--no-recurse-submodules',
          '--depth=1',
          'origin',
          sha40,
        ],
        expect.objectContaining({
          stdio: 'inherit',
          env: expect.objectContaining({ GIT_CONFIG_COUNT: '1' }),
        }),
      ],
    ]);
    expect(callsFor('checkout')).toEqual([
      [
        'git',
        [...SAFE_GIT_ARGS, 'checkout', '--detach', sha40, '--'],
        { encoding: 'utf8', stdio: 'inherit' },
      ],
    ]);
    for (const [file, args] of mockExecFileSync.mock.calls) {
      expect(file).toBe('git');
      expect(args?.slice(0, SAFE_GIT_ARGS.length)).toEqual(SAFE_GIT_ARGS);
    }
    expect(mockExecFileSync.mock.calls[0]?.[2]).not.toHaveProperty('env');
    expect(callsFor('checkout')[0]?.[2]).not.toHaveProperty('env');
  });

  it('omits shallow depth for a full clone', async () => {
    mockGit(false);
    await checkoutPullRequestHead(sha40, 'token', NO_WAIT);
    expect(callsFor('fetch')[0]?.[1]).not.toContain('--depth=1');
  });

  it('retries fetch twice, logs safe waiting messages, then succeeds', async () => {
    let fetchAttempts = 0;
    mockGit(true);
    mockExecFileSync.mockImplementation((_file, args) => {
      const gitCommand = command(args);
      if (gitCommand[0] === 'rev-parse' && gitCommand[1] === '--is-shallow-repository') {
        return 'true\n';
      }
      if (gitCommand[0] === 'fetch' && ++fetchAttempts < 3) {
        throw new Error(`Command failed: git ${gitCommand.join(' ')}`);
      }
      return Buffer.alloc(0);
    });

    await checkoutPullRequestHead(sha40, 'secret-token', NO_WAIT);

    expect(callsFor('fetch')).toHaveLength(3);
    expect(
      vi
        .mocked(core.info)
        .mock.calls.filter(([message]) => message === 'Waiting 0 seconds before trying again'),
    ).toHaveLength(2);
    const logs = vi.mocked(core.info).mock.calls.flat().join('\n');
    expect(logs).not.toContain('secret-token');
    expect(logs).not.toContain(Buffer.from('x-access-token:secret-token').toString('base64'));
  });

  it('propagates the third fetch failure with its cause', async () => {
    const cause = new Error('git fetch failed');
    mockExecFileSync.mockImplementation((_file, args) => {
      const gitCommand = command(args);
      if (gitCommand[0] === 'rev-parse') return 'true\n';
      if (gitCommand[0] === 'fetch') throw cause;
      return Buffer.alloc(0);
    });

    await expect(checkoutPullRequestHead(sha40, 'token', NO_WAIT)).rejects.toMatchObject({
      message: `Failed to fetch PR head ${sha40}`,
      cause,
    });
    expect(callsFor('fetch')).toHaveLength(3);
  });

  it('does not retry checkout failures', async () => {
    const cause = new Error('git checkout failed');
    mockExecFileSync.mockImplementation((_file, args) => {
      const gitCommand = command(args);
      if (gitCommand[0] === 'rev-parse') return 'true\n';
      if (gitCommand[0] === 'checkout') throw cause;
      return Buffer.alloc(0);
    });

    await expect(checkoutPullRequestHead(sha40, 'token', NO_WAIT)).rejects.toMatchObject({
      message: `Failed to check out PR head ${sha40}`,
      cause,
    });
    expect(callsFor('fetch')).toHaveLength(1);
    expect(callsFor('checkout')).toHaveLength(1);
  });
});
