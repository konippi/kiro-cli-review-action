import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@actions/core', () => ({
  warning: vi.fn(),
}));

import * as core from '@actions/core';
import { prepareAgentConfig } from '../src/agent-config.js';

const originalWorkingDirectory = process.cwd();
let temporaryDirectory: string;
let actionPath: string;
let destination: string;
let bundled: string;

beforeEach(() => {
  vi.clearAllMocks();
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'kiro-agent-config-'));
  actionPath = join(temporaryDirectory, 'action');
  const repositoryPath = join(temporaryDirectory, 'repository');
  destination = join(repositoryPath, '.kiro', 'agents', 'code-reviewer.json');
  bundled = join(actionPath, 'agents', 'code-reviewer.json');

  mkdirSync(join(actionPath, 'agents'), { recursive: true });
  mkdirSync(repositoryPath, { recursive: true });
  writeFileSync(bundled, JSON.stringify({ name: 'bundled', setting: true }, null, 2));
  process.chdir(repositoryPath);
});

afterEach(() => {
  process.chdir(originalWorkingDirectory);
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('prepareAgentConfig', () => {
  it('returns a custom agent and warns only when a model is also specified', () => {
    expect(prepareAgentConfig({ agent: 'custom-agent', model: '', actionPath })).toBe(
      'custom-agent',
    );
    expect(core.warning).not.toHaveBeenCalled();

    expect(prepareAgentConfig({ agent: 'custom-agent', model: 'claude', actionPath })).toBe(
      'custom-agent',
    );
    expect(core.warning).toHaveBeenCalledOnce();
    expect(core.warning).toHaveBeenCalledWith(
      'model input is ignored when agent input is specified',
    );
  });

  it('copies the bundled agent when the destination is missing', () => {
    expect(prepareAgentConfig({ agent: '', model: '', actionPath })).toBe('code-reviewer');
    expect(readFileSync(destination, 'utf8')).toBe(readFileSync(bundled, 'utf8'));
  });

  it('leaves an existing destination unchanged when no model is specified', () => {
    mkdirSync(join('.kiro', 'agents'), { recursive: true });
    writeFileSync(destination, 'existing config');

    prepareAgentConfig({ agent: '', model: '', actionPath });

    expect(readFileSync(destination, 'utf8')).toBe('existing config');
  });

  it('injects a model into the bundled configuration', () => {
    prepareAgentConfig({ agent: '', model: 'claude', actionPath });

    expect(JSON.parse(readFileSync(destination, 'utf8'))).toEqual({
      name: 'bundled',
      setting: true,
      model: 'claude',
    });
  });

  it('prefers an existing destination when injecting a model', () => {
    mkdirSync(join('.kiro', 'agents'), { recursive: true });
    writeFileSync(destination, JSON.stringify({ name: 'existing', setting: false }));

    prepareAgentConfig({ agent: '', model: 'claude', actionPath });

    expect(JSON.parse(readFileSync(destination, 'utf8'))).toEqual({
      name: 'existing',
      setting: false,
      model: 'claude',
    });
  });

  it('falls back to the bundled configuration when the destination is invalid JSON', () => {
    mkdirSync(join('.kiro', 'agents'), { recursive: true });
    writeFileSync(destination, 'not JSON');

    prepareAgentConfig({ agent: '', model: 'claude', actionPath });

    expect(JSON.parse(readFileSync(destination, 'utf8'))).toEqual({
      name: 'bundled',
      setting: true,
      model: 'claude',
    });
  });

  it('falls back to the bundled configuration when the destination is not an object', () => {
    mkdirSync(join('.kiro', 'agents'), { recursive: true });
    writeFileSync(destination, '[]');

    prepareAgentConfig({ agent: '', model: 'claude', actionPath });

    expect(JSON.parse(readFileSync(destination, 'utf8'))).toEqual({
      name: 'bundled',
      setting: true,
      model: 'claude',
    });
  });
});
