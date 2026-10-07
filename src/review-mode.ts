import * as core from '@actions/core';
import type { CommentContext, PullRequestTarget } from './context.js';
import { acknowledgeComment, authorizeCommentTrigger, fetchCommentPullRequest } from './github.js';
import type { ActionInputs } from './inputs.js';

/** Review mode resolved from inputs and event context. */
export type ReviewMode =
  | { readonly kind: 'prompt'; readonly prompt: string }
  | { readonly kind: 'pull_request'; readonly target: PullRequestTarget }
  | {
      readonly kind: 'comment';
      readonly target: PullRequestTarget;
      readonly userRequest: string | null;
    };

/** Selects the pull request target associated with a review mode. */
export function reviewTarget(
  mode: ReviewMode,
  event: PullRequestTarget | null,
): PullRequestTarget | null {
  return mode.kind === 'prompt' ? event : mode.target;
}

/** Resolves the review mode, authorizing and acknowledging comment triggers via the GitHub API. */
export async function resolveReviewMode(
  inputs: ActionInputs,
  event: PullRequestTarget | null,
  comment: CommentContext | null,
): Promise<ReviewMode | null> {
  if (event !== null && inputs.githubToken === '') {
    throw new Error('github_token is required for pull request reviews');
  }

  if (inputs.prompt !== '') return { kind: 'prompt', prompt: inputs.prompt };

  if (comment !== null && inputs.githubToken === '') {
    throw new Error('github_token is required for pull request reviews');
  }

  if (event) {
    core.info(`Reviewing PR #${event.prNumber} in ${event.owner}/${event.repo}`);
    return { kind: 'pull_request', target: event };
  }

  if (comment) {
    core.info(
      `Comment-triggered review for PR #${comment.prNumber} in ${comment.owner}/${comment.repo}`,
    );

    await authorizeCommentTrigger(
      comment.owner,
      comment.repo,
      comment.commenterLogin,
      inputs.githubToken,
    );
    await acknowledgeComment(comment.owner, comment.repo, comment.commentId, inputs.githubToken);
    const target = await fetchCommentPullRequest(
      comment.owner,
      comment.repo,
      comment.prNumber,
      inputs.githubToken,
    );

    if (target.isFork) {
      core.warning(
        "A fork PR's code will be checked out for this trusted comment-triggered review.",
      );
    }

    return { kind: 'comment', target, userRequest: comment.userRequest };
  }

  return null;
}
