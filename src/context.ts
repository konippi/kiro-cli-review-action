import * as core from '@actions/core';
import * as github from '@actions/github';
import { GITHUB_MCP_VERSION } from './constants.js';
import { extractUserRequest, sanitizeComment } from './sanitize.js';
import type { ActionInputs, CommentContext, EventContext } from './types.js';

const ALLOWED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

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
    githubMcpVersion: core.getInput('github_mcp_version') || GITHUB_MCP_VERSION,
  };
}

/** Returns null when not in a pull_request event. */
export function parseEventContext(): EventContext | null {
  const { context } = github;
  const pr = context.payload.pull_request;
  if (!pr) return null;

  const baseBranch = pr.base?.ref;
  const prNumber = pr.number;
  const isFork = pr.head?.repo?.fork;

  if (typeof baseBranch !== 'string' || typeof prNumber !== 'number') {
    throw new Error('Unexpected pull_request payload: missing base.ref or number');
  }

  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    prNumber,
    baseBranch,
    isFork: typeof isFork === 'boolean' ? isFork : true,
  };
}

/**
 * Parses issue_comment event for comment-triggered review.
 * Returns null if not a valid trigger (wrong event, not a PR, unauthorized user, or no trigger phrase).
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

  // Security: only allow trusted users
  const association =
    typeof comment.author_association === 'string' ? comment.author_association : '';
  if (!ALLOWED_ASSOCIATIONS.has(association)) {
    core.info(`Skipping: author_association=${association} is not allowed`);
    return null;
  }

  const raw = extractUserRequest(body, triggerPhrase);
  const userRequest = raw ? sanitizeComment(raw) || null : null;

  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    prNumber: issue.number as number,
    userRequest,
  };
}
