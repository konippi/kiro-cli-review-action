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
  destination = join('.kiro', 'agents', 'code-reviewer.json');
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

function getThrownError(callback: () => unknown): Error {
  try {
    callback();
  } catch (error: unknown) {
    if (error instanceof Error) return error;
    throw error;
  }

  throw new Error('Expected callback to throw');
}

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
    const contents = JSON.stringify({ name: 'existing', setting: false });
    mkdirSync(join('.kiro', 'agents'), { recursive: true });
    writeFileSync(destination, contents);

    prepareAgentConfig({ agent: '', model: '', actionPath });

    expect(readFileSync(destination, 'utf8')).toBe(contents);
  });

  it('injects a model into the bundled configuration', () => {
    prepareAgentConfig({ agent: '', model: 'claude', actionPath });

    expect(JSON.parse(readFileSync(destination, 'utf8'))).toEqual({
      name: 'bundled',
      setting: true,
      model: 'claude',
    });
  });

  it('injects a model into an existing destination', () => {
    mkdirSync(join('.kiro', 'agents'), { recursive: true });
    writeFileSync(destination, JSON.stringify({ name: 'existing', setting: false }));

    prepareAgentConfig({ agent: '', model: 'claude', actionPath });

    expect(JSON.parse(readFileSync(destination, 'utf8'))).toEqual({
      name: 'existing',
      setting: false,
      model: 'claude',
    });
  });

  it('throws on invalid JSON without overwriting the destination', () => {
    const contents = '{ invalid';
    mkdirSync(join('.kiro', 'agents'), { recursive: true });
    writeFileSync(destination, contents);

    const error = getThrownError(() =>
      prepareAgentConfig({ agent: '', model: 'claude', actionPath }),
    );

    expect(error.message).toBe(`Invalid JSON in agent configuration at ${destination}`);
    expect(error.message).not.toContain(contents);
    expect(readFileSync(destination, 'utf8')).toBe(contents);
  });

  it('throws when the configuration is not a JSON object', () => {
    const contents = '[]';
    mkdirSync(join('.kiro', 'agents'), { recursive: true });
    writeFileSync(destination, contents);

    const error = getThrownError(() =>
      prepareAgentConfig({ agent: '', model: 'claude', actionPath }),
    );

    expect(error.message).toBe(`Agent configuration at ${destination} must be a JSON object`);
    expect(error.message).not.toContain(contents);
  });

  it('validates an existing configuration even when no model is specified', () => {
    const contents = '{ invalid';
    mkdirSync(join('.kiro', 'agents'), { recursive: true });
    writeFileSync(destination, contents);

    const error = getThrownError(() => prepareAgentConfig({ agent: '', model: '', actionPath }));

    expect(error.message).toBe(`Invalid JSON in agent configuration at ${destination}`);
    expect(error.message).not.toContain(contents);
  });

  it('throws when the destination cannot be read', () => {
    mkdirSync(destination, { recursive: true });

    const error = getThrownError(() => prepareAgentConfig({ agent: '', model: '', actionPath }));

    expect(error.message).toBe(`Unable to read agent configuration at ${destination}`);
  });
});
