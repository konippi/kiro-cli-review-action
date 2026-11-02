import { describe, expect, it, vi } from 'vitest';
import { createPullRequestTarget } from '../helpers/context.js';

const githubMocks = vi.hoisted(() => {
  const listFiles = vi.fn();
  const get = vi.fn();
  const paginate = vi.fn();

  return {
    listFiles,
    get,
    paginate,
    getOctokit: vi.fn(() => ({ paginate, rest: { pulls: { listFiles, get } } })),
  };
});

vi.mock('@actions/github', () => ({ getOctokit: githubMocks.getOctokit }));

import { fetchReviewInput } from '../../src/review/pull-request.js';

const target = createPullRequestTarget();

function pullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    title: 'Add a feature',
    body: 'Details',
    user: { login: 'octocat' },
    base: { ref: 'main' },
    head: { ref: 'feature', sha: target.headSha },
    changed_files: 2,
    ...overrides,
  };
}

describe('fetchReviewInput', () => {
  it('maps the pull request and every listed file into the review input', async () => {
    githubMocks.paginate.mockResolvedValueOnce([
      {
        sha: 'blob',
        filename: 'src/a.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        changes: 1,
        patch: '@@ -1 +1 @@\n+a',
      },
      {
        filename: 'b.png',
        previous_filename: 'a.png',
        status: 'renamed',
        additions: 0,
        deletions: 0,
      },
    ]);
    githubMocks.get.mockResolvedValueOnce({ data: pullRequest({ body: null }) });

    await expect(fetchReviewInput(target, 'token')).resolves.toEqual({
      pullRequest: {
        number: 42,
        title: 'Add a feature',
        body: '',
        author: 'octocat',
        baseRef: 'main',
        headRef: 'feature',
        changedFiles: 2,
      },
      files: [
        {
          filename: 'src/a.ts',
          status: 'modified',
          additions: 1,
          deletions: 0,
          patch: '@@ -1 +1 @@\n+a',
        },
        {
          filename: 'b.png',
          previous_filename: 'a.png',
          status: 'renamed',
          additions: 0,
          deletions: 0,
        },
      ],
    });
    expect(githubMocks.getOctokit).toHaveBeenCalledWith('token');
    expect(githubMocks.paginate).toHaveBeenCalledWith(githubMocks.listFiles, {
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 42,
      per_page: 100,
    });
  });

  it('fails when the head moved after the target was resolved', async () => {
    githubMocks.paginate.mockResolvedValueOnce([]);
    githubMocks.get.mockResolvedValueOnce({
      data: pullRequest({ head: { ref: 'feature', sha: 'f'.repeat(40) } }),
    });

    await expect(fetchReviewInput(target, 'token')).rejects.toThrow(
      `Pull request #42 moved from ${target.headSha} to ${'f'.repeat(40)} during the review`,
    );
  });
});
