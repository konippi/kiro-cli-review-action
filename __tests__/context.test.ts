import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const githubMocks = vi.hoisted(() => {
  const getCollaboratorPermissionLevel = vi.fn();
  const pullsGet = vi.fn();
  const context: {
    eventName: string;
    repo: { owner: string; repo: string };
    payload: Record<string, unknown>;
  } = {
    eventName: 'pull_request',
    repo: { owner: 'test-owner', repo: 'test-repo' },
    payload: {},
  };

  return {
    context,
    getCollaboratorPermissionLevel,
    pullsGet,
    getOctokit: vi.fn(() => ({
      rest: {
        repos: { getCollaboratorPermissionLevel },
        pulls: { get: pullsGet },
      },
    })),
  };
});

const { context: ctx, getCollaboratorPermissionLevel, pullsGet } = githubMocks;

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@actions/github', () => ({
  context: githubMocks.context,
  getOctokit: githubMocks.getOctokit,
}));

import * as core from '@actions/core';
import {
  authorizeCommentTrigger,
  fetchCommentPullRequest,
  parseCommentContext,
  parseEventContext,
  parseInputs,
} from '../src/context.js';

const getInput = vi.mocked(core.getInput);
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = 'ghs_test';
  getInput.mockReturnValue('');
  setPullRequestPayload();
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
    });
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
      };
      return values[name] ?? '';
    });
    expect(parseInputs()).toMatchObject({
      githubToken: 'my-token',
      maxDiffSize: 5000,
      debug: true,
      triggerPhrase: '/review',
      model: 'model-id',
    });
  });
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
    expect(parseEventContext()).toEqual({
      owner: 'test-owner',
      repo: 'test-repo',
      prNumber: 42,
      baseBranch: 'main',
      headSha: sha,
      isFork,
    });
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

describe('comment triggers', () => {
  function setCommentPayload(
    options: {
      body?: string;
      hasPR?: boolean;
      action?: string;
      userType?: string;
      login?: string;
      omitLogin?: boolean;
    } = {},
  ): void {
    ctx.eventName = 'issue_comment';
    ctx.payload = {
      action: options.action ?? 'created',
      comment: {
        body: options.body ?? '@kiro review this',
        author_association: 'NONE',
        user: {
          type: options.userType ?? 'User',
          ...(options.omitLogin ? {} : { login: options.login ?? 'trusted-user' }),
        },
      },
      issue: {
        number: 10,
        ...(options.hasPR === false ? {} : { pull_request: { url: '...' } }),
      },
    };
  }

  it('returns context for a valid comment regardless of author association', () => {
    setCommentPayload();
    expect(parseCommentContext('@kiro')).toEqual({
      owner: 'test-owner',
      repo: 'test-repo',
      prNumber: 10,
      commenterLogin: 'trusted-user',
      userRequest: 'review this',
    });
  });

  it('returns null user request when trigger has no trailing text', () => {
    setCommentPayload({ body: '@kiro' });
    expect(parseCommentContext('@kiro')?.userRequest).toBeNull();
  });

  it('throws when the commenter login is missing', () => {
    setCommentPayload({ omitLogin: true });

    expect(() => parseCommentContext('@kiro')).toThrow(
      'Unexpected issue_comment payload: comment.user.login is missing',
    );
  });

  it('rejects non-comment events', () => {
    ctx.eventName = 'pull_request';
    expect(parseCommentContext('@kiro')).toBeNull();
  });

  it('rejects issue comments that are not on pull requests', () => {
    setCommentPayload({ hasPR: false });
    expect(parseCommentContext('@kiro')).toBeNull();
  });

  it('rejects non-created comment actions', () => {
    setCommentPayload({ action: 'edited' });
    expect(parseCommentContext('@kiro')).toBeNull();
  });

  it('rejects bot comments', () => {
    setCommentPayload({ userType: 'Bot' });
    expect(parseCommentContext('@kiro')).toBeNull();
  });

  it('requires the trigger phrase to be delimited', () => {
    setCommentPayload({ body: 'contact someone@kiro.dev' });
    expect(parseCommentContext('@kiro')).toBeNull();
  });

  it('rejects missing comment payloads', () => {
    ctx.eventName = 'issue_comment';
    ctx.payload = {};
    expect(parseCommentContext('@kiro')).toBeNull();
  });

  it.each(['admin', 'write'])(
    'authorizes %s permission using a token-created client',
    async (permission) => {
      getCollaboratorPermissionLevel.mockResolvedValueOnce({ data: { permission } });

      await expect(
        authorizeCommentTrigger('test-owner', 'test-repo', 'trusted-user', 'token'),
      ).resolves.toBeUndefined();

      expect(githubMocks.getOctokit).toHaveBeenCalledWith('token');
      expect(getCollaboratorPermissionLevel).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        username: 'trusted-user',
      });
      expect(core.info).toHaveBeenCalledWith(`Commenter trusted-user has ${permission} access`);
    },
  );

  it.each(['read', 'none'])(
    'rejects %s permission with the detected permission',
    async (permission) => {
      getCollaboratorPermissionLevel.mockResolvedValueOnce({ data: { permission } });

      await expect(
        authorizeCommentTrigger('test-owner', 'test-repo', 'trusted-user', 'token'),
      ).rejects.toThrow(
        `Commenter trusted-user must have write access to test-owner/test-repo; detected permission: ${permission}`,
      );
    },
  );

  it('reports a 404 as a commenter who is not a collaborator', async () => {
    getCollaboratorPermissionLevel.mockRejectedValueOnce({ status: 404 });

    await expect(
      authorizeCommentTrigger('test-owner', 'test-repo', 'trusted-user', 'token'),
    ).rejects.toThrow(
      'Commenter trusted-user is not a collaborator on test-owner/test-repo; write access is required',
    );
  });

  it('wraps generic lookup failures with the original cause', async () => {
    const cause = new Error('API unavailable');
    getCollaboratorPermissionLevel.mockRejectedValueOnce(cause);

    await expect(
      authorizeCommentTrigger('test-owner', 'test-repo', 'trusted-user', 'token'),
    ).rejects.toEqual(
      new Error('Failed to verify write access for commenter trusted-user', { cause }),
    );
  });

  it('fetches authoritative checkout metadata and detects forks by repository identity', async () => {
    pullsGet.mockResolvedValueOnce({
      data: {
        base: { ref: 'release/v1', repo: { full_name: 'test-owner/test-repo' } },
        head: { sha, repo: { full_name: 'contributor/fork' } },
      },
    });

    await expect(fetchCommentPullRequest('test-owner', 'test-repo', 10, 'token')).resolves.toEqual({
      owner: 'test-owner',
      repo: 'test-repo',
      prNumber: 10,
      baseBranch: 'release/v1',
      headSha: sha,
      isFork: true,
    });
    expect(githubMocks.getOctokit).toHaveBeenCalledWith('token');
    expect(pullsGet).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 10,
    });
  });

  it('treats missing repository identity as a fork and rejects malformed metadata', async () => {
    pullsGet.mockResolvedValueOnce({
      data: { base: { ref: 'main', repo: null }, head: { sha, repo: null } },
    });
    await expect(fetchCommentPullRequest('o', 'r', 10, 'token')).resolves.toMatchObject({
      isFork: true,
    });

    pullsGet.mockResolvedValueOnce({ data: { base: {}, head: { sha } } });
    await expect(fetchCommentPullRequest('o', 'r', 10, 'token')).rejects.toThrow(
      'Unexpected pull request response',
    );
  });
});
