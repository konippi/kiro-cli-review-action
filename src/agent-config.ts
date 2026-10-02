import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@actions/core';
import { isPlainObject } from './guards.js';

function readConfig(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isPlainObject(value)) throw new Error('Agent configuration must be an object');

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
  const destination = join(agentDir, 'code-reviewer.json');
  const bundled = join(options.actionPath, 'agents', 'code-reviewer.json');

  if (options.model !== '') {
    const source = existsSync(destination) ? destination : bundled;
    let config: Record<string, unknown>;

    try {
      config = readConfig(source);
    } catch {
      config = readConfig(bundled);
    }

    mkdirSync(agentDir, { recursive: true });
    config.model = options.model;
    writeFileSync(destination, JSON.stringify(config, null, 2));
  } else if (!existsSync(destination)) {
    mkdirSync(agentDir, { recursive: true });
    copyFileSync(bundled, destination);
  }

  return 'code-reviewer';
}
