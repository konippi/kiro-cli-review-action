import * as core from '@actions/core';
import * as semver from 'semver';
import { assertSupportedGithubMcpVersion, DEFAULT_GITHUB_MCP_VERSION } from './setup/github-mcp.js';
import { assertSupportedKiroCliVersion, DEFAULT_KIRO_CLI_VERSION } from './setup/kiro-cli.js';

/** Default maximum diff size in characters. */
export const DEFAULT_MAX_DIFF_SIZE = '10000';

/** Default review timeout in minutes. */
export const DEFAULT_TIMEOUT_MINUTES = '10';

/** Default phrase for comment-triggered reviews. */
export const DEFAULT_TRIGGER_PHRASE = '@kiro';

/** Action inputs. */
export interface ActionInputs {
  readonly kiroApiKey: string;
  readonly githubToken: string;
  readonly agent: string;
  readonly model: string;
  readonly prompt: string;
  readonly triggerPhrase: string;
  readonly maxDiffSize: number;
  readonly timeoutMinutes: number;
  readonly debug: boolean;
  readonly githubMcpVersion: string;
  readonly kiroCliVersion: string;
}

function parseIntegerInput(name: string, fallback: string, min: number, max: number): number {
  const raw = core.getInput(name) || fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < min || value > max) {
    throw new Error(`Input ${name} must be an integer from ${min} to ${max}; received: ${raw}`);
  }

  return value;
}

function parseVersionInput(
  name: string,
  fallback: string,
  assertSupported: (version: string) => void,
): string {
  const version = core.getInput(name) || fallback;
  if (semver.valid(version) !== version || semver.prerelease(version) !== null) {
    throw new Error(`Input ${name} must be an exact version in X.Y.Z format; received: ${version}`);
  }

  assertSupported(version);

  return version;
}

/** Reads action inputs, validating numeric, boolean, and version values. */
export function parseInputs(): ActionInputs {
  const kiroApiKey = core.getInput('kiro_api_key', { required: true });
  core.setSecret(kiroApiKey);
  const githubToken = core.getInput('github_token');
  if (githubToken) core.setSecret(githubToken);

  const maxDiffSize = parseIntegerInput(
    'max_diff_size',
    DEFAULT_MAX_DIFF_SIZE,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const timeoutMinutes = parseIntegerInput('timeout_minutes', DEFAULT_TIMEOUT_MINUTES, 1, 360);

  const githubMcpVersion = parseVersionInput(
    'github_mcp_version',
    DEFAULT_GITHUB_MCP_VERSION,
    assertSupportedGithubMcpVersion,
  );
  const kiroCliVersion = parseVersionInput(
    'kiro_cli_version',
    DEFAULT_KIRO_CLI_VERSION,
    assertSupportedKiroCliVersion,
  );

  return {
    kiroApiKey,
    githubToken,
    agent: core.getInput('agent'),
    model: core.getInput('model'),
    prompt: core.getInput('prompt'),
    triggerPhrase: core.getInput('trigger_phrase') || DEFAULT_TRIGGER_PHRASE,
    maxDiffSize,
    timeoutMinutes,
    debug: core.getBooleanInput('debug'),
    githubMcpVersion,
    kiroCliVersion,
  };
}
