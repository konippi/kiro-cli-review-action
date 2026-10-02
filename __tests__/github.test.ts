import * as core from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const githubMocks = vi.hoisted(() => {
  const getCollaboratorPermissionLevel = vi.fn();
  const pullsGet = vi.fn();
  const createForIssueComment = vi.fn();

  return {
    getCollaboratorPermissionLevel,
    pullsGet,
    createForIssueComment,
    getOctokit: vi.fn(() => ({
      rest: {
        repos: { getCollaboratorPermissionLevel },
        pulls: { get: pullsGet },
        reactions: { createForIssueComment },
      },
    })),
  };
});

const { createForIssueComment, getCollaboratorPermissionLevel, pullsGet } = githubMocks;

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@actions/github', () => ({
  getOctokit: githubMocks.getOctokit,
}));

import {
  acknowledgeComment,
  authorizeCommentTrigger,
  fetchCommentPullRequest,
} from '../src/github.js';

const sha = '0123456789abcdef0123456789abcdef01234567';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('acknowledgeComment', () => {
  it('adds an eyes reaction to the triggering comment', async () => {
    await expect(
      acknowledgeComment('test-owner', 'test-repo', 1234, 'token'),
    ).resolves.toBeUndefined();

    expect(githubMocks.getOctokit).toHaveBeenCalledWith('token');
    expect(createForIssueComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 1234,
      content: 'eyes',
    });
    expect(core.warning).not.toHaveBeenCalled();
  });

  it('warns instead of failing when the reaction request fails', async () => {
    createForIssueComment.mockRejectedValueOnce(new Error('rate limited'));

    await expect(
      acknowledgeComment('test-owner', 'test-repo', 1234, 'token'),
    ).resolves.toBeUndefined();

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('1234'));
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('test-owner/test-repo'));
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('rate limited'));
  });
});

describe('authorizeCommentTrigger', () => {
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
});

describe('fetchCommentPullRequest', () => {
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
