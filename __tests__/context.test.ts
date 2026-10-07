import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPullRequestTarget } from './helpers/context.js';

const githubMocks = vi.hoisted(() => {
  const context: {
    eventName: string;
    repo: { owner: string; repo: string };
    payload: Record<string, unknown>;
  } = {
    eventName: 'pull_request',
    repo: { owner: 'test-owner', repo: 'test-repo' },
    payload: {},
  };

  return { context };
});

const { context: ctx } = githubMocks;

vi.mock('@actions/github', () => ({
  context: githubMocks.context,
}));

import { parseCommentContext, parseEventContext } from '../src/context.js';

const sha = '0123456789abcdef0123456789abcdef01234567';

function setPullRequestPayload(
  options: { baseRepo?: Record<string, unknown>; headRepo?: Record<string, unknown> } = {},
): void {
  ctx.eventName = 'pull_request';
  ctx.payload = {
    pull_request: {
      number: 42,
      base: { ref: 'main', repo: options.baseRepo ?? { full_name: 'test-owner/test-repo' } },
      head: { sha, repo: options.headRepo ?? { full_name: 'test-owner/test-repo' } },
    },
  };
}

function setCommentPayload(
  options: {
    body?: unknown;
    hasPR?: boolean;
    action?: string;
    userType?: string;
    login?: string;
    omitLogin?: boolean;
    omitId?: boolean;
    omitNumber?: boolean;
  } = {},
): void {
  ctx.eventName = 'issue_comment';
  ctx.payload = {
    action: options.action ?? 'created',
    comment: {
      ...(options.omitId ? {} : { id: 1234 }),
      body: options.body === undefined ? '@kiro review this' : options.body,
      author_association: 'NONE',
      user: {
        type: options.userType ?? 'User',
        ...(options.omitLogin ? {} : { login: options.login ?? 'trusted-user' }),
      },
    },
    issue: {
      ...(options.omitNumber ? {} : { number: 10 }),
      ...(options.hasPR === false ? {} : { pull_request: { url: '...' } }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setPullRequestPayload();
});

describe('parseEventContext', () => {
  it.each([
    {
      name: 'same-repository PR',
      baseRepo: { full_name: 'test-owner/test-repo' },
      headRepo: { full_name: 'test-owner/test-repo' },
      isFork: false,
    },
    {
      name: 'different repository identity',
      baseRepo: { full_name: 'test-owner/test-repo' },
      headRepo: { full_name: 'contributor/fork', fork: false },
      isFork: true,
    },
    { name: 'missing repository identity', baseRepo: {}, headRepo: {}, isFork: true },
  ])('parses checkout metadata for $name', ({ baseRepo, headRepo, isFork }) => {
    setPullRequestPayload({ baseRepo, headRepo });

    expect(parseEventContext()).toEqual(createPullRequestTarget({ isFork }));
  });

  it('returns null outside pull request payloads', () => {
    ctx.payload = {};

    expect(parseEventContext()).toBeNull();
  });

  it('throws when required checkout metadata is missing', () => {
    ctx.payload = { pull_request: { number: 42, base: { ref: 'main' }, head: {} } };

    expect(() => parseEventContext()).toThrow('Unexpected pull_request payload');
  });
});

describe('parseCommentContext', () => {
  it('returns the comment context with an optional user request', () => {
    setCommentPayload();

    expect(parseCommentContext('@kiro')).toEqual({
      owner: 'test-owner',
      repo: 'test-repo',
      prNumber: 10,
      commentId: 1234,
      commenterLogin: 'trusted-user',
      userRequest: 'review this',
    });

    setCommentPayload({ body: '@kiro' });

    expect(parseCommentContext('@kiro')?.userRequest).toBeNull();
  });

  it('rejects a non-string comment body', () => {
    setCommentPayload({ body: { text: '@kiro review this' } });

    expect(parseCommentContext('@kiro')).toBeNull();
  });

  it('returns a null request when the triggered remainder sanitizes to empty', () => {
    setCommentPayload({ body: '@kiro <!-- hidden request -->' });

    expect(parseCommentContext('@kiro')?.userRequest).toBeNull();
  });

  it.each([
    {
      name: 'comment id',
      options: { omitId: true },
      message: 'Unexpected issue_comment payload: comment.id is missing',
    },
    {
      name: 'commenter login',
      options: { omitLogin: true },
      message: 'Unexpected issue_comment payload: comment.user.login is missing',
    },
    {
      name: 'issue number',
      options: { omitNumber: true },
      message: 'Unexpected issue_comment payload: issue.number is missing',
    },
  ])('throws when the $name is missing', ({ options, message }) => {
    setCommentPayload(options);

    expect(() => parseCommentContext('@kiro')).toThrow(message);
  });

  it('rejects non-comment events', () => {
    ctx.eventName = 'pull_request';

    expect(parseCommentContext('@kiro')).toBeNull();
  });

  it.each([
    {
      name: 'rejects issue comments that are not on pull requests',
      options: { hasPR: false },
    },
    { name: 'rejects non-created comment actions', options: { action: 'edited' } },
    { name: 'rejects bot comments', options: { userType: 'Bot' } },
    {
      name: 'requires the trigger phrase to be delimited',
      options: { body: 'contact someone@kiro.dev' },
    },
  ])('$name', ({ options }) => {
    setCommentPayload(options);

    expect(parseCommentContext('@kiro')).toBeNull();
  });

  it('rejects missing comment payloads', () => {
    ctx.eventName = 'issue_comment';
    ctx.payload = {};

    expect(parseCommentContext('@kiro')).toBeNull();
  });
});
