import * as core from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const githubMocks = vi.hoisted(() => ({
  authorizeCommentTrigger: vi.fn(),
  fetchCommentPullRequest: vi.fn(),
}));

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('../src/github.js', () => ({
  authorizeCommentTrigger: githubMocks.authorizeCommentTrigger,
  fetchCommentPullRequest: githubMocks.fetchCommentPullRequest,
}));

import { resolveReviewMode } from '../src/review-mode.js';

const sha = '0123456789abcdef0123456789abcdef01234567';
const inputs = {
  kiroApiKey: 'kiro-key',
  githubToken: 'github-token',
  agent: '',
  model: '',
  prompt: '',
  triggerPhrase: '@kiro',
  maxDiffSize: 10000,
  debug: false,
  githubMcpVersion: '0.32.0',
};
const target = {
  owner: 'test-owner',
  repo: 'test-repo',
  prNumber: 42,
  baseBranch: 'main',
  headSha: sha,
  isFork: false,
};
const comment = {
  owner: 'test-owner',
  repo: 'test-repo',
  prNumber: 10,
  commenterLogin: 'trusted-user',
  userRequest: 'focus on authentication',
};

beforeEach(() => {
  vi.clearAllMocks();
  githubMocks.fetchCommentPullRequest.mockResolvedValue({ ...target, prNumber: 10 });
});

describe('resolveReviewMode', () => {
  it('returns prompt mode without calling GitHub APIs', async () => {
    await expect(
      resolveReviewMode({ ...inputs, prompt: 'Review this snippet' }, target, comment),
    ).resolves.toEqual({ kind: 'prompt', prompt: 'Review this snippet' });

    expect(githubMocks.authorizeCommentTrigger).not.toHaveBeenCalled();
    expect(githubMocks.fetchCommentPullRequest).not.toHaveBeenCalled();
  });

  it('logs and returns pull request mode', async () => {
    await expect(resolveReviewMode(inputs, target, null)).resolves.toEqual({
      kind: 'pull_request',
      target,
    });

    expect(core.info).toHaveBeenCalledWith('Reviewing PR #42 in test-owner/test-repo');
    expect(githubMocks.authorizeCommentTrigger).not.toHaveBeenCalled();
  });

  it('rejects comment mode without a GitHub token', async () => {
    await expect(resolveReviewMode({ ...inputs, githubToken: '' }, null, comment)).rejects.toThrow(
      'github_token is required for comment-triggered reviews',
    );

    expect(githubMocks.authorizeCommentTrigger).not.toHaveBeenCalled();
  });

  it('authorizes before fetching and returns comment mode with the user request', async () => {
    const calls: string[] = [];
    githubMocks.authorizeCommentTrigger.mockImplementationOnce(async () => {
      calls.push('authorize');
    });
    githubMocks.fetchCommentPullRequest.mockImplementationOnce(async () => {
      calls.push('fetch');
      return { ...target, prNumber: 10 };
    });

    await expect(resolveReviewMode(inputs, null, comment)).resolves.toEqual({
      kind: 'comment',
      target: { ...target, prNumber: 10 },
      userRequest: 'focus on authentication',
    });
    expect(calls).toEqual(['authorize', 'fetch']);
  });

  it('warns when the fetched comment target is a fork', async () => {
    githubMocks.fetchCommentPullRequest.mockResolvedValueOnce({
      ...target,
      prNumber: 10,
      isFork: true,
    });

    await resolveReviewMode(inputs, null, comment);

    expect(core.warning).toHaveBeenCalledWith(
      "A fork PR's code will be checked out for this trusted comment-triggered review.",
    );
  });

  it('returns null when no mode matches', async () => {
    await expect(resolveReviewMode(inputs, null, null)).resolves.toBeNull();

    expect(githubMocks.authorizeCommentTrigger).not.toHaveBeenCalled();
  });
});
