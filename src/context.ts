import * as core from '@actions/core';
import * as github from '@actions/github';
import { extractUserRequest, sanitizeComment } from './sanitize.js';
import type { ActionInputs, CommentContext, EventContext } from './types.js';

const WRITE_PERMISSIONS = new Set(['admin', 'write']);

function detectFork(headRepo: string | undefined, baseRepo: string | undefined): boolean {
  return !headRepo || !baseRepo || headRepo !== baseRepo;
}

export function parseInputs(): ActionInputs {
  return {
    kiroApiKey: core.getInput('kiro_api_key', { required: true }),
    githubToken: core.getInput('github_token') || process.env.GITHUB_TOKEN || '',
    agent: core.getInput('agent'),
    model: core.getInput('model'),
    prompt: core.getInput('prompt'),
    triggerPhrase: core.getInput('trigger_phrase') || '@kiro',
    maxDiffSize: Number.parseInt(core.getInput('max_diff_size') || '10000', 10),
    debug: core.getInput('debug') === 'true',
    githubMcpVersion: core.getInput('github_mcp_version'),
  };
}

/** Returns null when not in a pull_request event. */
export function parseEventContext(): EventContext | null {
  const { context } = github;
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

/**
 * Parses issue_comment event for comment-triggered review.
 * Authorization is performed via the GitHub API by authorizeCommentTrigger.
 */
export function parseCommentContext(triggerPhrase: string): CommentContext | null {
  const { context } = github;
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

  const raw = extractUserRequest(body, triggerPhrase);
  const userRequest = raw ? sanitizeComment(raw) || null : null;

  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    prNumber,
    commenterLogin: typeof comment.user?.login === 'string' ? comment.user.login : '',
    userRequest,
  };
}

function isNotFoundError(error: unknown): error is { status: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status === 404
  );
}

/** Verifies that the commenter has repository write access. */
export async function authorizeCommentTrigger(
  owner: string,
  repo: string,
  username: string,
  token: string,
): Promise<void> {
  let permission: string;

  try {
    const octokit = github.getOctokit(token);
    const response = await octokit.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username,
    });
    permission = response.data.permission;
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      throw new Error(
        `Commenter ${username} is not a collaborator on ${owner}/${repo}; write access is required`,
      );
    }

    throw new Error(`Failed to verify write access for commenter ${username}`, { cause: error });
  }

  // The permission field maps maintain to write and triage to read.
  if (WRITE_PERMISSIONS.has(permission)) {
    core.info(`Commenter ${username} has ${permission} access`);
    return;
  }

  throw new Error(
    `Commenter ${username} must have write access to ${owner}/${repo}; detected permission: ${permission}`,
  );
}

/** Fetches authoritative pull request metadata for an issue comment event. */
export async function fetchCommentPullRequest(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<EventContext> {
  const octokit = github.getOctokit(token);
  const response = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
  const pr = response.data;
  const baseBranch = pr.base?.ref;
  const headSha = pr.head?.sha;
  if (typeof baseBranch !== 'string' || typeof headSha !== 'string') {
    throw new Error('Unexpected pull request response: missing base.ref or head.sha');
  }

  return {
    owner,
    repo,
    prNumber,
    baseBranch,
    headSha,
    isFork: detectFork(pr.head?.repo?.full_name, pr.base?.repo?.full_name),
  };
}
