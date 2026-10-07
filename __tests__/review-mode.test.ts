import * as core from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const githubMocks = vi.hoisted(() => ({
  acknowledgeComment: vi.fn(),
  authorizeCommentTrigger: vi.fn(),
  fetchCommentPullRequest: vi.fn(),
}));

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('../src/github.js', () => ({
  acknowledgeComment: githubMocks.acknowledgeComment,
  authorizeCommentTrigger: githubMocks.authorizeCommentTrigger,
  fetchCommentPullRequest: githubMocks.fetchCommentPullRequest,
}));

import { resolveReviewMode, reviewTarget } from '../src/review-mode.js';
import { createPullRequestTarget } from './helpers/context.js';
import { createActionInputs } from './helpers/inputs.js';

const inputs = createActionInputs();
const target = createPullRequestTarget();
const comment = {
  owner: 'test-owner',
  repo: 'test-repo',
  prNumber: 10,
  commentId: 1234,
  commenterLogin: 'trusted-user',
  userRequest: 'focus on authentication',
};

beforeEach(() => {
  vi.clearAllMocks();
  githubMocks.fetchCommentPullRequest.mockResolvedValue({ ...target, prNumber: 10 });
});

describe('resolveReviewMode', () => {
  it('returns direct prompt mode without a GitHub token or API calls', async () => {
    await expect(
      resolveReviewMode(
        { ...inputs, githubToken: '', prompt: 'Review this snippet' },
        null,
        comment,
      ),
    ).resolves.toEqual({ kind: 'prompt', prompt: 'Review this snippet' });

    expect(githubMocks.authorizeCommentTrigger).not.toHaveBeenCalled();
    expect(githubMocks.fetchCommentPullRequest).not.toHaveBeenCalled();
  });

  it('rejects pull request prompt mode without a GitHub token or API calls', async () => {
    await expect(
      resolveReviewMode({ ...inputs, githubToken: '', prompt: 'Review this PR' }, target, null),
    ).rejects.toThrow('github_token is required for pull request reviews');

    expect(githubMocks.authorizeCommentTrigger).not.toHaveBeenCalled();
    expect(githubMocks.acknowledgeComment).not.toHaveBeenCalled();
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

  it('rejects pull request mode without a GitHub token', async () => {
    await expect(resolveReviewMode({ ...inputs, githubToken: '' }, target, null)).rejects.toThrow(
      'github_token is required for pull request reviews',
    );

    expect(core.info).not.toHaveBeenCalled();
  });

  it('rejects comment mode without a GitHub token', async () => {
    await expect(resolveReviewMode({ ...inputs, githubToken: '' }, null, comment)).rejects.toThrow(
      'github_token is required for pull request reviews',
    );

    expect(githubMocks.authorizeCommentTrigger).not.toHaveBeenCalled();
    expect(githubMocks.acknowledgeComment).not.toHaveBeenCalled();
  });

  it('rejects when comment authorization fails without fetching or acknowledging', async () => {
    githubMocks.authorizeCommentTrigger.mockRejectedValueOnce(new Error('denied'));

    await expect(resolveReviewMode(inputs, null, comment)).rejects.toThrow('denied');

    expect(githubMocks.fetchCommentPullRequest).not.toHaveBeenCalled();
    expect(githubMocks.acknowledgeComment).not.toHaveBeenCalled();
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
    githubMocks.acknowledgeComment.mockImplementationOnce(async () => {
      calls.push('acknowledge');
    });

    await expect(resolveReviewMode(inputs, null, comment)).resolves.toEqual({
      kind: 'comment',
      target: { ...target, prNumber: 10 },
      userRequest: 'focus on authentication',
    });
    expect(calls).toEqual(['authorize', 'acknowledge', 'fetch']);
    expect(githubMocks.acknowledgeComment).toHaveBeenCalledWith(
      'test-owner',
      'test-repo',
      1234,
      'github-token',
    );
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

describe('reviewTarget', () => {
  const promptMode = { kind: 'prompt', prompt: 'review directly' } as const;
  const pullRequestMode = { kind: 'pull_request', target } as const;
  const commentTarget = createPullRequestTarget({ prNumber: 11 });
  const commentMode = { kind: 'comment', target: commentTarget, userRequest: null } as const;

  it.each([
    ['prompt mode with an event', promptMode, target, target],
    ['prompt mode without an event', promptMode, null, null],
    ['pull request mode', pullRequestMode, null, target],
    ['comment mode', commentMode, target, commentTarget],
  ] as const)('returns the target for %s', (_name, reviewMode, event, expected) => {
    expect(reviewTarget(reviewMode, event)).toBe(expected);
  });
});
