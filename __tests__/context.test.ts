import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  info: vi.fn(),
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
import * as github from '@actions/github';
import { parseCommentContext, parseEventContext, parseInputs } from '../src/context.js';

const getInput = vi.mocked(core.getInput);
const ctx = github.context as { eventName: string; payload: Record<string, unknown> };

beforeEach(() => {
  vi.resetAllMocks();
  process.env.GITHUB_TOKEN = 'ghs_test';
  getInput.mockReturnValue('');
  ctx.eventName = 'pull_request';
  ctx.payload = {
    pull_request: {
      number: 42,
      base: { ref: 'main' },
      head: { sha: 'abc123', repo: { fork: false } },
    },
  };
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
    expect(inputs.debug).toBe(false);
    expect(inputs.triggerPhrase).toBe('@kiro');
  });

  it('parses explicit values', () => {
    getInput.mockImplementation((name: string) => {
      const map: Record<string, string> = {
        kiro_api_key: 'my-key',
        github_token: 'my-token',
        max_diff_size: '5000',
        debug: 'true',
        trigger_phrase: '/review',
      };
      return map[name] ?? '';
    });
    const inputs = parseInputs();
    expect(inputs.githubToken).toBe('my-token');
    expect(inputs.maxDiffSize).toBe(5000);
    expect(inputs.debug).toBe(true);
    expect(inputs.triggerPhrase).toBe('/review');
  });
});

describe('parseEventContext', () => {
  it('parses pull_request event', () => {
    const event = parseEventContext();
    expect(event).toEqual({
      owner: 'test-owner',
      repo: 'test-repo',
      prNumber: 42,
      baseBranch: 'main',
      isFork: false,
    });
  });

  it('returns null when not a pull_request event', () => {
    ctx.payload = {};
    expect(parseEventContext()).toBeNull();
  });

  it('defaults isFork to true when fork field is missing', () => {
    ctx.payload = {
      pull_request: { number: 1, base: { ref: 'main' }, head: { repo: {} } },
    };
    expect(parseEventContext()?.isFork).toBe(true);
  });

  it('throws on malformed payload', () => {
    ctx.payload = { pull_request: { number: 'bad', base: {} } };
    expect(() => parseEventContext()).toThrow('Unexpected pull_request payload');
  });
});

describe('parseCommentContext', () => {
  function setCommentPayload(overrides: { body?: string; association?: string; hasPR?: boolean }) {
    ctx.eventName = 'issue_comment';
    ctx.payload = {
      comment: {
        body: overrides.body ?? '@kiro review this',
        author_association: overrides.association ?? 'OWNER',
      },
      issue: {
        number: 10,
        ...(overrides.hasPR !== false ? { pull_request: { url: '...' } } : {}),
      },
    };
  }

  it('returns context for valid OWNER comment on PR', () => {
    setCommentPayload({});
    expect(parseCommentContext('@kiro')).toEqual({
      owner: 'test-owner',
      repo: 'test-repo',
      prNumber: 10,
    });
  });

  it.each(['MEMBER', 'COLLABORATOR'])('returns context for %s', (assoc) => {
    setCommentPayload({ association: assoc });
    expect(parseCommentContext('@kiro')).not.toBeNull();
  });

  it('returns null for non-issue_comment event', () => {
    ctx.eventName = 'pull_request';
    expect(parseCommentContext('@kiro')).toBeNull();
  });

  it('returns null when comment is on an issue (not PR)', () => {
    setCommentPayload({ hasPR: false });
    expect(parseCommentContext('@kiro')).toBeNull();
  });

  it('returns null when trigger phrase is not in body', () => {
    setCommentPayload({ body: 'just a normal comment' });
    expect(parseCommentContext('@kiro')).toBeNull();
  });

  it.each([
    'NONE',
    'FIRST_TIMER',
    'FIRST_TIME_CONTRIBUTOR',
    'CONTRIBUTOR',
  ])('rejects untrusted author_association: %s', (assoc) => {
    setCommentPayload({ association: assoc });
    expect(parseCommentContext('@kiro')).toBeNull();
  });

  it('returns null when payload is missing comment or issue', () => {
    ctx.eventName = 'issue_comment';
    ctx.payload = {};
    expect(parseCommentContext('@kiro')).toBeNull();
  });
});
