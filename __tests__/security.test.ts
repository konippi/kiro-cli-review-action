import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
  cpSync: vi.fn(),
}));

vi.mock('@actions/core', () => ({
  info: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { restoreConfigFromBase } from '../src/security.js';

const mockExecFileSync = vi.mocked(execFileSync);
const mockExistsSync = vi.mocked(existsSync);

beforeEach(() => {
  vi.resetAllMocks();
  mockExistsSync.mockReturnValue(false);
});

describe('restoreConfigFromBase', () => {
  it.each([
    'main; rm -rf /',
    '',
    '$(whoami)',
    '../../etc',
  ])('throws on invalid branch name: %s', (branch) => {
    expect(() => restoreConfigFromBase(branch)).toThrow('Invalid branch name');
  });

  it('fetches from base branch with --no-recurse-submodules', () => {
    restoreConfigFromBase('feature/my-branch.1');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['fetch', 'origin', 'feature/my-branch.1', '--depth=1', '--no-recurse-submodules'],
      expect.any(Object),
    );
  });

  it('backs up existing sensitive paths before deletion', () => {
    mockExistsSync.mockReturnValue(true);
    restoreConfigFromBase('main');
    expect(cpSync).toHaveBeenCalled();
    expect(rmSync).toHaveBeenCalled();
  });

  it('deletes sensitive paths before fetch to prevent .gitmodules hang', () => {
    const calls: string[] = [];
    vi.mocked(rmSync).mockImplementation((...args) => {
      calls.push(`rm:${args[0]}`);
    });
    mockExecFileSync.mockImplementation((...args) => {
      calls.push(`exec:${(args as unknown[])[0]}`);
      return Buffer.from('');
    });

    restoreConfigFromBase('main');

    const firstRm = calls.findIndex((c) => c.startsWith('rm:.kiro'));
    const firstFetch = calls.indexOf('exec:git');
    expect(firstRm).toBeLessThan(firstFetch);
  });
});
