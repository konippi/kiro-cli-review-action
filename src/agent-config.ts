import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@actions/core';
import { isPlainObject } from './guards.js';

const AGENT_NAME = 'code-reviewer';

// Read and validate an agent configuration; errors name the path but never echo its contents.
function readAgentConfig(path: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error: unknown) {
    throw new Error(`Unable to read agent configuration at ${path}`, { cause: error });
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error: unknown) {
    throw new Error(`Invalid JSON in agent configuration at ${path}`, { cause: error });
  }

  if (!isPlainObject(value)) {
    throw new Error(`Agent configuration at ${path} must be a JSON object`);
  }

  return value;
}

/** Prepares the agent configuration under .kiro/agents and returns the agent name to run. */
export function prepareAgentConfig(options: {
  agent: string;
  model: string;
  actionPath: string;
}): string {
  if (options.agent !== '') {
    if (options.model !== '') {
      core.warning('model input is ignored when agent input is specified');
    }

    return options.agent;
  }

  const agentDir = join('.kiro', 'agents');
  const destination = join(agentDir, `${AGENT_NAME}.json`);

  if (!existsSync(destination)) {
    mkdirSync(agentDir, { recursive: true });
    copyFileSync(join(options.actionPath, 'agents', `${AGENT_NAME}.json`), destination);
  }

  const config = readAgentConfig(destination);

  if (options.model !== '') {
    config.model = options.model;
    writeFileSync(destination, JSON.stringify(config, null, 2));
  }

  return AGENT_NAME;
}
