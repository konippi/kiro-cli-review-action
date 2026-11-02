import * as core from '@actions/core';
import { throttling } from '@octokit/plugin-throttling';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { ReviewInput } from '../../src/review/input.js';
import type { ReviewFinding } from '../../src/review/proposal.js';
import { createPullRequestTarget } from '../helpers/context.js';

interface Throttle {
  onRateLimit(): boolean;
  onSecondaryRateLimit(
    retryAfter: number,
    options: object,
    octokit: object,
    retryCount: number,
  ): boolean;
}

const githubMocks = vi.hoisted(() => {
  const createReview = vi.fn();
  const listReviews = vi.fn();
  const paginate = vi.fn();

  return {
    createReview,
    listReviews,
    paginate,
    getOctokit: vi.fn((_token: string, _options: { throttle: Throttle }, _plugin: unknown) => ({
      paginate,
      rest: { pulls: { createReview, listReviews } },
    })),
  };
});

const { createReview, paginate } = githubMocks;

vi.mock('@actions/core', () => ({ warning: vi.fn() }));
vi.mock('@actions/github', () => ({ getOctokit: githubMocks.getOctokit }));

import { publishReview } from '../../src/review/publish.js';

const target = createPullRequestTarget();

const input: ReviewInput = {
  pullRequest: {
    number: 42,
    title: 'Title',
    body: '',
    author: 'octocat',
    baseRef: 'main',
    headRef: 'feature',
    changedFiles: 3,
  },
  files: [
    {
      filename: 'a.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
      patch: '@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d',
    },
    {
      filename: 'b.ts',
      status: 'renamed',
      previous_filename: 'old.ts',
      additions: 1,
      deletions: 1,
      patch: '@@ -1 +1 @@\n-x\n+y',
    },
    { filename: 'c.png', status: 'added', additions: 0, deletions: 0 },
  ],
};

const inlineFinding: ReviewFinding = {
  id: 'f1',
  path: 'a.ts',
  side: 'RIGHT',
  line: 3,
  startLine: 2,
  body: 'Range issue',
};

function failure(status: number, message = 'failed') {
  return Object.assign(new Error(message), { status });
}

function postedBodies(): string[] {
  return createReview.mock.calls.map(([request]) => request.body);
}

describe('publishReview', () => {
  it('posts anchored findings inline on the target head with a marker in the body', async () => {
    createReview.mockResolvedValueOnce({ data: { id: 7 } });

    await expect(
      publishReview(target, 'token', input, {
        summary: 'Summary',
        findings: [
          inlineFinding,
          { id: 'f2', path: 'a.ts', side: 'LEFT', line: 2, body: 'Removed' },
        ],
      }),
    ).resolves.toEqual({ reviewId: 7, inlineFindings: 2, bodyFindings: 0 });

    expect(createReview).toHaveBeenCalledExactlyOnceWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 42,
      event: 'COMMENT',
      commit_id: target.headSha,
      body: expect.stringMatching(/^Summary\n\n<!-- kiro-review:[\da-f-]{36} -->$/),
      comments: [
        {
          path: 'a.ts',
          side: 'RIGHT',
          line: 3,
          start_line: 2,
          start_side: 'RIGHT',
          body: 'Range issue',
        },
        { path: 'a.ts', side: 'LEFT', line: 2, body: 'Removed' },
      ],
    });
  });

  it('retries a secondary rate limit once and fails on a primary rate limit', async () => {
    createReview.mockResolvedValueOnce({ data: { id: 7 } });

    await publishReview(target, 'token', input, { summary: 'Summary', findings: [] });

    expect(githubMocks.getOctokit).toHaveBeenCalledWith('token', expect.anything(), throttling);
    const throttle = githubMocks.getOctokit.mock.lastCall?.[1].throttle;
    expect(throttle?.onRateLimit()).toBe(false);
    expect(throttle?.onSecondaryRateLimit(60, {}, {}, 0)).toBe(true);
    expect(throttle?.onSecondaryRateLimit(60, {}, {}, 1)).toBe(false);
  });

  it('moves findings GitHub cannot anchor into a body-only review', async () => {
    createReview.mockResolvedValueOnce({ data: { id: 7 } });

    await expect(
      publishReview(target, 'token', input, {
        summary: 'Summary',
        findings: [
          { id: 'f1', path: 'missing.ts', side: 'RIGHT', line: 1, body: 'Unlisted' },
          { id: 'f2', path: 'c.png', side: 'RIGHT', line: 1, body: 'No patch' },
          { id: 'f3', path: 'b.ts', side: 'LEFT', line: 1, body: 'Renamed' },
        ],
      }),
    ).resolves.toEqual({ reviewId: 7, inlineFindings: 0, bodyFindings: 3 });

    const [request] = createReview.mock.calls[0] ?? [];
    expect(request).not.toHaveProperty('commit_id');
    expect(request).not.toHaveProperty('comments');
    expect(request.body).toMatch(
      /^Summary\n\n### Findings not posted inline\n\n\*\*`missing\.ts` R1\*\*\n\nUnlisted\n\n\*\*`c\.png` R1\*\*\n\nNo patch\n\n\*\*`b\.ts` L1\*\*\n\nRenamed\n\n<!-- kiro-review:/,
    );
  });

  it('reposts every finding in the body when GitHub rejects the inline comments', async () => {
    createReview.mockRejectedValueOnce(failure(422, 'Line could not be resolved'));
    createReview.mockResolvedValueOnce({ data: { id: 8 } });

    await expect(
      publishReview(target, 'token', input, { summary: 'Summary', findings: [inlineFinding] }),
    ).resolves.toEqual({ reviewId: 8, inlineFindings: 0, bodyFindings: 1 });

    expect(createReview.mock.calls[1]?.[0]).not.toHaveProperty('comments');
    expect(postedBodies()[1]).toContain('**`a.ts` R2-R3**\n\nRange issue');
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Line could not be resolved'),
    );
  });

  it.each([
    { name: 'a 422 on a body-only review', error: failure(422), findings: [] },
    {
      name: 'a permission error',
      error: failure(403, 'Resource not accessible by integration'),
      findings: [inlineFinding],
    },
  ])('throws $name without retrying', async ({ error, findings }) => {
    createReview.mockRejectedValueOnce(error);

    await expect(
      publishReview(target, 'token', input, { summary: 'Summary', findings }),
    ).rejects.toBe(error);
    expect(createReview).toHaveBeenCalledOnce();
  });

  describe('after a transient failure', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      onTestFinished(() => {
        vi.useRealTimers();
      });
    });

    it('waits for a server error and posts again', async () => {
      createReview.mockRejectedValueOnce(failure(502));
      createReview.mockResolvedValueOnce({ data: { id: 9 } });
      paginate.mockResolvedValueOnce([{ id: 1, body: null }]);

      const published = publishReview(target, 'token', input, { summary: 'Summary', findings: [] });
      await vi.advanceTimersByTimeAsync(9_999);
      expect(createReview).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);

      await expect(published).resolves.toMatchObject({ reviewId: 9 });
      expect(postedBodies()[1]).toBe(postedBodies()[0]);
    });

    it('returns the review the failed request created', async () => {
      createReview.mockRejectedValueOnce(failure(504));
      paginate.mockImplementationOnce(async () => [
        { id: 10, body: createReview.mock.calls[0]?.[0].body },
      ]);

      const published = publishReview(target, 'token', input, { summary: 'Summary', findings: [] });
      await vi.runAllTimersAsync();

      await expect(published).resolves.toMatchObject({ reviewId: 10 });
      expect(paginate).toHaveBeenCalledWith(githubMocks.listReviews, {
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 42,
        per_page: 100,
      });
      expect(createReview).toHaveBeenCalledOnce();
    });
  });

  it('truncates an oversized body and keeps the marker', async () => {
    createReview.mockResolvedValueOnce({ data: { id: 7 } });

    await publishReview(target, 'token', input, { summary: 's'.repeat(70_000), findings: [] });

    const [body = ''] = postedBodies();
    expect(body).toHaveLength(65_536);
    expect(body).toMatch(/s…\n\n<!-- kiro-review:[\da-f-]{36} -->$/);
  });
});
