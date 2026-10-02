import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import type { PullRequestTarget } from './context.js';
import { detectFork } from './context.js';

const WRITE_PERMISSIONS = new Set(['admin', 'write']);

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
    const octokit = getOctokit(token);
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
): Promise<PullRequestTarget> {
  const octokit = getOctokit(token);
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
