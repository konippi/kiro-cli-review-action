import { getOctokit } from '@actions/github';
import type { PullRequestTarget } from '../context.js';
import type { ReviewInput } from './input.js';

/** Fetches the pull request and its changed files, failing when the head has moved past the target. */
export async function fetchReviewInput(
  target: PullRequestTarget,
  token: string,
): Promise<ReviewInput> {
  const octokit = getOctokit(token);
  const request = { owner: target.owner, repo: target.repo, pull_number: target.prNumber };

  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    ...request,
    per_page: 100,
  });
  const { data: pr } = await octokit.rest.pulls.get(request);
  if (pr.head.sha !== target.headSha) {
    throw new Error(
      `Pull request #${target.prNumber} moved from ${target.headSha} to ${pr.head.sha} during the review`,
    );
  }

  return {
    pullRequest: {
      number: pr.number,
      title: pr.title,
      body: pr.body ?? '',
      author: pr.user.login,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      changedFiles: pr.changed_files,
    },
    files: files.map((file) => ({
      filename: file.filename,
      previous_filename: file.previous_filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
    })),
  };
}
