import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
}));

vi.mock('@actions/github', () => ({
  context: {
    eventName: 'pull_request',
    repo: { owner: 'test-owner', repo: 'test-repo' },
    payload: {
      pull_request: {
        number: 42,
        base: { ref: 'main' },
        head: { sha: 'abc123', repo: { fork: false } },
      },
    },
  },
}));

import * as core from '@actions/core';
import { parseEventContext, parseInputs } from '../src/context.js';

const getInput = vi.mocked(core.getInput);

beforeEach(() => {
  vi.resetAllMocks();
  process.env.GITHUB_TOKEN = 'ghs_test';
  getInput.mockReturnValue('');
});

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
});

describe('parseInputs', () => {
  it('returns defaults when no inputs provided', () => {
    getInput.mockImplementation((name: string) => {
      if (name === 'kiro_api_key') return 'test-key';
      return '';
    });
    const inputs = parseInputs();
    expect(inputs.kiroApiKey).toBe('test-key');
    expect(inputs.githubToken).toBe('ghs_test');
    expect(inputs.maxDiffSize).toBe(10000);
    expect(inputs.timeoutMinutes).toBe(5);
    expect(inputs.debug).toBe(false);
  });

  it('parses explicit values', () => {
    getInput.mockImplementation((name: string) => {
      const map: Record<string, string> = {
        kiro_api_key: 'my-key',
        github_token: 'my-token',
        max_diff_size: '5000',
        timeout_minutes: '3',
        debug: 'true',
      };
      return map[name] ?? '';
    });
    const inputs = parseInputs();
    expect(inputs.githubToken).toBe('my-token');
    expect(inputs.maxDiffSize).toBe(5000);
    expect(inputs.timeoutMinutes).toBe(3);
    expect(inputs.debug).toBe(true);
  });
});

describe('parseEventContext', () => {
  it('parses pull_request event', () => {
    const event = parseEventContext();
    expect(event).not.toBeNull();
    expect(event?.eventName).toBe('pull_request');
    expect(event?.owner).toBe('test-owner');
    expect(event?.repo).toBe('test-repo');
    expect(event?.prNumber).toBe(42);
    expect(event?.baseBranch).toBe('main');
    expect(event?.isFork).toBe(false);
  });

  it('returns null when not a pull_request event', async () => {
    const github = await import('@actions/github');
    (github.context.payload as Record<string, unknown>).pull_request = undefined;
    try {
      expect(parseEventContext()).toBeNull();
    } finally {
      (github.context.payload as Record<string, unknown>).pull_request = {
        number: 42,
        base: { ref: 'main' },
        head: { sha: 'abc123', repo: { fork: false } },
      };
    }
  });
});
