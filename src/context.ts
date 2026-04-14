import * as core from '@actions/core';
import * as github from '@actions/github';
import { GITHUB_MCP_VERSION } from './constants.js';
import type { ActionInputs, EventContext } from './types.js';

export function parseInputs(): ActionInputs {
  return {
    kiroApiKey: core.getInput('kiro_api_key', { required: true }),
    githubToken: core.getInput('github_token') || process.env.GITHUB_TOKEN || '',
    agent: core.getInput('agent'),
    prompt: core.getInput('prompt'),
    maxDiffSize: Number.parseInt(core.getInput('max_diff_size') || '10000', 10),
    debug: core.getInput('debug') === 'true',
    githubMcpVersion: core.getInput('github_mcp_version') || GITHUB_MCP_VERSION,
  };
}

/** Returns null when not in a pull_request event (e.g. workflow_dispatch with prompt). */
export function parseEventContext(): EventContext | null {
  const { context } = github;
  const pr = context.payload.pull_request;
  if (!pr) return null;

  return {
    eventName: context.eventName,
    owner: context.repo.owner,
    repo: context.repo.repo,
    prNumber: pr.number as number,
    baseBranch: pr.base.ref as string,
    isFork: (pr.head.repo?.fork as boolean) ?? false,
  };
}
