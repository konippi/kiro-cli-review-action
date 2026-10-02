import * as core from '@actions/core';

/** Validated action inputs. */
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

/** Parses and validates action inputs. */
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
