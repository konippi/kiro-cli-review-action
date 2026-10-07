import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@actions/core';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

vi.mock('@actions/core', () => ({
  getBooleanInput: vi.fn(),
  getInput: vi.fn(),
  setSecret: vi.fn(),
}));

import {
  DEFAULT_MAX_DIFF_SIZE,
  DEFAULT_TIMEOUT_MINUTES,
  DEFAULT_TRIGGER_PHRASE,
  parseInputs,
} from '../src/inputs.js';
import { ALLOWED_ENV_KEYS } from '../src/kiro/env.js';
import { DEFAULT_GITHUB_MCP_VERSION } from '../src/setup/github-mcp.js';
import { DEFAULT_KIRO_CLI_VERSION } from '../src/setup/kiro-cli.js';

const projectRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const actionPath = resolve(projectRoot, 'action.yml');
const actionSource = readFileSync(actionPath, 'utf8');
const action = parse(actionSource);
const readmeSource = readFileSync(resolve(projectRoot, 'README.md'), 'utf8');

describe('action.yml', () => {
  it('keeps input defaults synchronized with code', () => {
    expect(action.inputs).toMatchObject({
      debug: { default: 'false' },
      timeout_minutes: { default: DEFAULT_TIMEOUT_MINUTES },
      trigger_phrase: { default: DEFAULT_TRIGGER_PHRASE },
      max_diff_size: { default: DEFAULT_MAX_DIFF_SIZE },
      github_mcp_version: { default: DEFAULT_GITHUB_MCP_VERSION },
      kiro_cli_version: { default: DEFAULT_KIRO_CLI_VERSION },
    });
  });

  it('declares exactly the inputs read by the implementation', () => {
    const getInput = vi.mocked(core.getInput);
    const getBooleanInput = vi.mocked(core.getBooleanInput);
    getInput.mockImplementation((name) => (name === 'kiro_api_key' ? 'x' : ''));
    getBooleanInput.mockReturnValue(false);

    parseInputs();

    const names = [...getInput.mock.calls, ...getBooleanInput.mock.calls].map(([name]) => name);
    expect([...new Set(names)].sort()).toEqual(Object.keys(action.inputs).sort());
  });

  it('declares the public output contract', () => {
    expect(Object.keys(action.outputs)).toEqual(['conclusion']);
  });

  it('uses Node 24 and references existing entry points', () => {
    expect(action.runs.using).toBe('node24');
    expect(existsSync(resolve(projectRoot, action.runs.main))).toBe(true);
    expect(existsSync(resolve(projectRoot, action.runs.post))).toBe(true);
  });
});

describe('README.md', () => {
  it('keeps the documented Kiro environment allowlist synchronized with code', () => {
    const environmentSection = /^## Environment variables\n([\s\S]*?)(?=^## )/m.exec(
      readmeSource,
    )?.[1];

    expect(environmentSection).toBeDefined();
    if (environmentSection === undefined) return;
    expect(environmentSection).toMatch(/proxy[^\n]*GitHub API requests/i);

    const documentedKeys = [
      ...environmentSection.matchAll(/`((?:[A-Z][A-Z0-9_]*|(?:http|https|no)_proxy))`/g),
    ].map((match) => match[1]);
    const runtimeKeys = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL'];
    expect(new Set([...documentedKeys, ...runtimeKeys])).toEqual(new Set(ALLOWED_ENV_KEYS));
  });
});
