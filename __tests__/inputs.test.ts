import * as core from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionInputs } from './helpers/inputs.js';

vi.mock('@actions/core', () => ({
  getBooleanInput: vi.fn(),
  getInput: vi.fn(),
  setSecret: vi.fn(),
}));

import { parseInputs } from '../src/inputs.js';

const getBooleanInput = vi.mocked(core.getBooleanInput);
const getInput = vi.mocked(core.getInput);

function useInputs(values: Readonly<Record<string, string>> = {}): void {
  getInput.mockImplementation(
    (name: string) => ({ kiro_api_key: 'test-key', ...values })[name] ?? '',
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useInputs();
  getBooleanInput.mockReturnValue(false);
});

describe('parseInputs', () => {
  it('reads and masks the required API key first, then returns defaults', () => {
    expect(parseInputs()).toEqual(createActionInputs({ kiroApiKey: 'test-key', githubToken: '' }));
    expect(getInput.mock.calls[0]).toEqual(['kiro_api_key', { required: true }]);
    expect(core.setSecret).toHaveBeenCalledOnce();
    expect(core.setSecret).toHaveBeenCalledWith('test-key');
  });

  it.each([
    ['kiro_cli_version', '2.27.1', { kiroCliVersion: '2.27.1' }],
    ['github_mcp_version', '0.23.0', { githubMcpVersion: '0.23.0' }],
  ])('accepts the minimum supported %s', (input, version, expected) => {
    useInputs({ [input]: version });

    expect(parseInputs()).toMatchObject(expected);
  });

  it('rejects kiro_cli_version below the minimum', () => {
    useInputs({ kiro_cli_version: '2.27.0' });

    expect(() => parseInputs()).toThrow(
      'Input kiro_cli_version is not supported: requested 2.27.0; supported versions are >=2.27.1',
    );
  });

  it('rejects github_mcp_version below the minimum', () => {
    useInputs({ github_mcp_version: '0.22.0' });

    expect(() => parseInputs()).toThrow(
      'Input github_mcp_version is not supported: requested 0.22.0; supported versions are >=0.23.0',
    );
  });

  it.each(['latest', 'v2.27.1', '2.27.1-beta.1'])('rejects kiro_cli_version %s', (value) => {
    useInputs({ kiro_cli_version: value });

    expect(() => parseInputs()).toThrow(
      `Input kiro_cli_version must be an exact version in X.Y.Z format; received: ${value}`,
    );
  });

  it('rejects github_mcp_version latest', () => {
    useInputs({ github_mcp_version: 'latest' });

    expect(() => parseInputs()).toThrow(
      'Input github_mcp_version must be an exact version in X.Y.Z format; received: latest',
    );
  });

  it('parses explicit input values', () => {
    useInputs({
      kiro_api_key: 'my-key',
      github_token: 'my-token',
      max_diff_size: '5000',
      trigger_phrase: '/review',
      model: 'model-id',
    });

    expect(parseInputs()).toMatchObject({
      githubToken: 'my-token',
      maxDiffSize: 5000,
      triggerPhrase: '/review',
      model: 'model-id',
    });
    expect(core.setSecret).toHaveBeenNthCalledWith(1, 'my-key');
    expect(core.setSecret).toHaveBeenNthCalledWith(2, 'my-token');
  });

  it('wires debug through getBooleanInput', () => {
    getBooleanInput.mockReturnValue(true);

    expect(parseInputs().debug).toBe(true);
    expect(getBooleanInput).toHaveBeenCalledWith('debug');
  });

  it.each(['1.5', '0', '9'.repeat(400)])('rejects max_diff_size %s', (value) => {
    useInputs({ max_diff_size: value });

    expect(() => parseInputs()).toThrow(
      `Input max_diff_size must be an integer from 1 to ${Number.MAX_SAFE_INTEGER}; received: ${value}`,
    );
  });

  it('accepts max_diff_size at its lower boundary', () => {
    useInputs({ max_diff_size: '1' });

    expect(parseInputs().maxDiffSize).toBe(1);
  });

  it.each([
    ['', 10],
    ['1', 1],
    ['360', 360],
  ])('parses timeout_minutes %j as %d', (value, expected) => {
    useInputs({ timeout_minutes: value });

    expect(parseInputs().timeoutMinutes).toBe(expected);
  });

  it.each(['0', '361', '1.5'])('rejects timeout_minutes %s', (value) => {
    useInputs({ timeout_minutes: value });

    expect(() => parseInputs()).toThrow(
      `Input timeout_minutes must be an integer from 1 to 360; received: ${value}`,
    );
  });
});
