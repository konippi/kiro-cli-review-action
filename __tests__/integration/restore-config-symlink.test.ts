import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => Buffer.alloc(0)) }));
vi.mock('@actions/core', () => ({ info: vi.fn(), warning: vi.fn() }));

import { restoreConfigFromBase } from '../../src/restore-config.js';

let originalCwd: string;
let root: string;
let workspace: string;

beforeEach(() => {
  vi.clearAllMocks();
  originalCwd = process.cwd();
  root = mkdtempSync(join(tmpdir(), 'kiro-v1-snapshot-'));
  workspace = join(root, 'workspace');
  mkdirSync(workspace);
  process.chdir(workspace);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(root, { recursive: true, force: true });
});

describe('PR config snapshot symlink safety', () => {
  it('writes placeholders for top-level and nested symlinks without reading outside files', async () => {
    const outside = join(root, 'outside-secret.txt');
    writeFileSync(outside, 'must-not-be-copied');
    symlinkSync(outside, join(workspace, 'README.md'));
    mkdirSync(join(workspace, '.kiro', 'agents'), { recursive: true });
    writeFileSync(join(workspace, '.kiro', 'agents', 'safe.json'), '{}');
    symlinkSync(outside, join(workspace, '.kiro', 'agents', 'linked.json'));
    const danglingTarget = '../missing-target';
    symlinkSync(danglingTarget, join(workspace, 'AmazonQ.md'));

    await restoreConfigFromBase('main');

    const rootPlaceholder = readFileSync(join(workspace, '.kiro-pr', 'README.md'), 'utf8');
    const nestedPlaceholder = readFileSync(
      join(workspace, '.kiro-pr', '.kiro', 'agents', 'linked.json'),
      'utf8',
    );
    const danglingPlaceholder = join(workspace, '.kiro-pr', 'AmazonQ.md');
    expect(rootPlaceholder).toContain(outside);
    expect(nestedPlaceholder).toContain(outside);
    expect(rootPlaceholder).not.toContain('must-not-be-copied');
    expect(nestedPlaceholder).not.toContain('must-not-be-copied');
    expect(readFileSync(join(workspace, '.kiro-pr', '.kiro', 'agents', 'safe.json'), 'utf8')).toBe(
      '{}',
    );
    expect(existsSync(danglingPlaceholder)).toBe(true);
    expect(readFileSync(danglingPlaceholder, 'utf8')).toContain(danglingTarget);
    expect(core.warning).toHaveBeenCalledTimes(3);
    expect(execFileSync).toHaveBeenCalled();
  });

  it('does not dereference a symlinked sensitive directory', async () => {
    const outsideDir = join(root, 'outside-kiro');
    const outsideFile = join(outsideDir, 'agents', 'secret.json');
    mkdirSync(dirname(outsideFile), { recursive: true });
    writeFileSync(outsideFile, 'outside-directory-secret');
    symlinkSync(outsideDir, join(workspace, '.kiro'));

    await restoreConfigFromBase('main');

    const snapshot = readFileSync(join(workspace, '.kiro-pr', '.kiro'), 'utf8');
    expect(snapshot).toContain(outsideDir);
    expect(snapshot).not.toContain('outside-directory-secret');
    expect(existsSync(join(workspace, '.kiro-pr', '.kiro', 'agents', 'secret.json'))).toBe(false);
  });
});
