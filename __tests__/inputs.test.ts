import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
}));

import { parseInputs } from '../src/inputs.js';

const getInput = vi.mocked(core.getInput);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = 'ghs_test';
  getInput.mockReturnValue('');
});

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
});

describe('parseInputs', () => {
  it('returns defaults when no optional inputs are provided', () => {
    getInput.mockImplementation((name: string) => (name === 'kiro_api_key' ? 'test-key' : ''));

    expect(parseInputs()).toMatchObject({
      kiroApiKey: 'test-key',
      githubToken: 'ghs_test',
      model: '',
      maxDiffSize: 10000,
      debug: false,
      triggerPhrase: '@kiro',
      githubMcpVersion: '0.32.0',
      kiroCliVersion: '2.27.1',
    });
  });

  it.each([
    ['kiro_cli_version', 'latest'],
    ['kiro_cli_version', 'v2.27.1'],
    ['kiro_cli_version', '2.27'],
    ['kiro_cli_version', '^2.27.0'],
    ['github_mcp_version', '0.32.0-beta.1'],
  ])('rejects invalid exact version input %s=%s', (input, value) => {
    getInput.mockImplementation((name: string) => {
      if (name === 'kiro_api_key') return 'test-key';
      if (name === input) return value;
      return '';
    });

    expect(() => parseInputs()).toThrow(
      `Input ${input} must be an exact version in X.Y.Z format; received: ${value}`,
    );
  });

  it('parses explicit input values', () => {
    getInput.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        kiro_api_key: 'my-key',
        github_token: 'my-token',
        max_diff_size: '5000',
        debug: 'true',
        trigger_phrase: '/review',
        model: 'model-id',
        github_mcp_version: '0.33.0',
        kiro_cli_version: '2.28.0',
      };

      return values[name] ?? '';
    });

    expect(parseInputs()).toMatchObject({
      githubToken: 'my-token',
      maxDiffSize: 5000,
      debug: true,
      triggerPhrase: '/review',
      model: 'model-id',
      githubMcpVersion: '0.33.0',
      kiroCliVersion: '2.28.0',
    });
  });

  it.each(['1junk', '1.5', '0'])('rejects max_diff_size %s', (value) => {
    getInput.mockImplementation((name: string) => {
      if (name === 'kiro_api_key') return 'test-key';
      if (name === 'max_diff_size') return value;
      return '';
    });

    expect(() => parseInputs()).toThrow(
      `Input max_diff_size must be a positive integer; received: ${value}`,
    );
  });
});
