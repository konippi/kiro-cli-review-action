import { context } from '@actions/github';
import { extractUserRequest, sanitizeComment } from './sanitize.js';

/** Pull request to review, resolved from the event payload or the GitHub API. */
export interface PullRequestTarget {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly baseBranch: string;
  readonly headSha: string;
  readonly isFork: boolean;
}

/** Context parsed from a matching pull request comment trigger. */
export interface CommentContext {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly commenterLogin: string;
  readonly userRequest: string | null;
}

/** A PR is a fork when the head repository differs from the base repository or is unknown. */
export function detectFork(headRepo: string | undefined, baseRepo: string | undefined): boolean {
  return !headRepo || !baseRepo || headRepo !== baseRepo;
}

/** Returns null when not in a pull_request event. */
export function parseEventContext(): PullRequestTarget | null {
  const pr = context.payload.pull_request;
  if (!pr) return null;

  const baseBranch = pr.base?.ref;
  const headSha = pr.head?.sha;
  const prNumber = pr.number;

  if (
    typeof baseBranch !== 'string' ||
    typeof headSha !== 'string' ||
    typeof prNumber !== 'number'
  ) {
    throw new Error('Unexpected pull_request payload: missing base.ref, head.sha, or number');
  }

  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    prNumber,
    baseBranch,
    headSha,
    isFork: detectFork(pr.head?.repo?.full_name, pr.base?.repo?.full_name),
  };
}

/** Parses issue_comment events for comment-triggered review. */
export function parseCommentContext(triggerPhrase: string): CommentContext | null {
  if (context.eventName !== 'issue_comment') return null;

  const comment = context.payload.comment;
  const issue = context.payload.issue;
  if (!comment || !issue) return null;

  // Only react to new comments (not edits/deletes)
  if (context.payload.action !== 'created') return null;

  // Prevent bot loops
  if (comment.user?.type === 'Bot') return null;

  // Must be a PR comment (issues have no pull_request field)
  if (!issue.pull_request) return null;

  const body = typeof comment.body === 'string' ? comment.body : '';
  const pattern = new RegExp(
    `(^|\\s)${triggerPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s.,!?;:]|$)`,
  );
  if (!pattern.test(body)) return null;

  const prNumber = issue.number;
  if (typeof prNumber !== 'number') return null;

  const commenterLogin = comment.user?.login;
  if (typeof commenterLogin !== 'string' || commenterLogin === '') {
    throw new Error('Unexpected issue_comment payload: comment.user.login is missing');
  }

  const raw = extractUserRequest(body, triggerPhrase);
  const userRequest = raw ? sanitizeComment(raw) || null : null;

  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    prNumber,
    commenterLogin,
    userRequest,
  };
}
