import * as core from '@actions/core';

/** Action inputs. */
export interface ActionInputs {
  readonly kiroApiKey: string;
  readonly githubToken: string;
  readonly agent: string;
  readonly model: string;
  readonly prompt: string;
  readonly triggerPhrase: string;
  readonly maxDiffSize: number;
  readonly debug: boolean;
  readonly githubMcpVersion: string;
}

/** Reads action inputs, validating numeric values. */
export function parseInputs(): ActionInputs {
  const rawMaxDiffSize = core.getInput('max_diff_size') || '10000';
  const maxDiffSize = Number(rawMaxDiffSize);
  if (!Number.isInteger(maxDiffSize) || maxDiffSize <= 0) {
    throw new Error(`Input max_diff_size must be a positive integer; received: ${rawMaxDiffSize}`);
  }

  return {
    kiroApiKey: core.getInput('kiro_api_key', { required: true }),
    githubToken: core.getInput('github_token') || process.env.GITHUB_TOKEN || '',
    agent: core.getInput('agent'),
    model: core.getInput('model'),
    prompt: core.getInput('prompt'),
    triggerPhrase: core.getInput('trigger_phrase') || '@kiro',
    maxDiffSize,
    debug: core.getInput('debug') === 'true',
    githubMcpVersion: core.getInput('github_mcp_version'),
  };
}
