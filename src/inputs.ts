import * as core from '@actions/core';
import * as semver from 'semver';
import { DEFAULT_GITHUB_MCP_VERSION } from './setup/github-mcp.js';
import { DEFAULT_KIRO_CLI_VERSION } from './setup/kiro-cli.js';

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
  readonly kiroCliVersion: string;
}

function parseVersionInput(name: string, fallback: string): string {
  const version = core.getInput(name) || fallback;
  if (semver.valid(version) !== version || semver.prerelease(version) !== null) {
    throw new Error(`Input ${name} must be an exact version in X.Y.Z format; received: ${version}`);
  }

  return version;
}

/** Reads action inputs, validating numeric and version values. */
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
    githubMcpVersion: parseVersionInput('github_mcp_version', DEFAULT_GITHUB_MCP_VERSION),
    kiroCliVersion: parseVersionInput('kiro_cli_version', DEFAULT_KIRO_CLI_VERSION),
  };
}
