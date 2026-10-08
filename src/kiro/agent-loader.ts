import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as core from '@actions/core';
import { isPlainObject } from '../guards.js';

const AGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Reserved name used for the generated review agent. */
export const GENERATED_AGENT_NAME = 'kiro-review-action';

interface LoadAgentOptions {
  readonly workspace: string;
  readonly actionPath: string;
  readonly agent: string;
  readonly model: string;
}

interface LoadedAgent {
  readonly source: SourceAgentConfig;
  readonly custom: SourceAgentConfig;
  readonly sourcePath: string;
  readonly model: string;
}

/** Source fields accepted from a Kiro agent configuration. */
export type SourceAgentConfig = {
  readonly description?: string;
  readonly prompt?: string;
  readonly model?: string;
  readonly tools?: readonly unknown[];
  readonly allowedTools?: readonly unknown[];
  readonly resources?: readonly unknown[];
  readonly mcpServers?: Readonly<Record<string, unknown>>;
  readonly toolsSettings?: Readonly<Record<string, unknown>>;
  readonly [property: string]: unknown;
};

function validateAgentName(name: string): string {
  if (name === GENERATED_AGENT_NAME || !AGENT_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid agent: ${name}; expected a non-reserved name using alphanumeric, _, and - characters`,
    );
  }

  return name;
}

function assertOptionalString(
  value: unknown,
  path: string,
  key: string,
): asserts value is string | undefined {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`Agent configuration at ${path} has ${key} that is not a string`);
  }
}

function assertOptionalArray(
  value: unknown,
  path: string,
  key: string,
): asserts value is readonly unknown[] | undefined {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error(`Agent configuration at ${path} has ${key} that is not an array`);
  }
}

function assertOptionalObject(
  value: unknown,
  path: string,
  key: string,
): asserts value is Readonly<Record<string, unknown>> | undefined {
  if (value !== undefined && !isPlainObject(value)) {
    throw new Error(`Agent configuration at ${path} has ${key} that is not an object`);
  }
}

function parseAgentConfig(value: unknown, path: string): SourceAgentConfig {
  if (!isPlainObject(value)) {
    throw new Error(`Agent configuration at ${path} must be a JSON object`);
  }

  assertOptionalArray(value.tools, path, 'tools');
  assertOptionalArray(value.allowedTools, path, 'allowedTools');
  assertOptionalArray(value.resources, path, 'resources');
  assertOptionalObject(value.mcpServers, path, 'mcpServers');
  assertOptionalObject(value.toolsSettings, path, 'toolsSettings');
  assertOptionalString(value.prompt, path, 'prompt');
  assertOptionalString(value.description, path, 'description');
  assertOptionalString(value.model, path, 'model');

  return value;
}

function readAgent(path: string): SourceAgentConfig {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error: unknown) {
    const problem = error instanceof SyntaxError ? 'Invalid JSON in' : 'Unable to read';
    throw new Error(`${problem} agent configuration at ${path}`, { cause: error });
  }

  return parseAgentConfig(parsed, path);
}

function resolvePrompt(prompt: string | undefined, sourceDirectory: string): string | undefined {
  if (prompt === undefined || !prompt.startsWith('file://')) return prompt;
  const path = prompt.slice('file://'.length);
  return path.startsWith('/') ? prompt : `file://${resolve(sourceDirectory, path)}`;
}

function mergeAgent(
  bundledPath: string,
  sourcePath: string,
): { source: SourceAgentConfig; custom: SourceAgentConfig } {
  const bundled = readAgent(bundledPath);
  const custom = sourcePath === bundledPath ? {} : readAgent(sourcePath);
  const merged = { ...bundled, ...custom };
  const promptPath = custom.prompt === undefined ? bundledPath : sourcePath;
  const prompt = resolvePrompt(merged.prompt, dirname(promptPath));
  const source = prompt === undefined ? merged : { ...merged, prompt };
  return { source, custom };
}

/** Selects, reads, validates, and merges the effective source agent. */
export function loadAgent(options: LoadAgentOptions): LoadedAgent {
  const agentsDirectory = resolve(options.workspace, '.kiro', 'agents');
  const workspaceDefault = join(agentsDirectory, 'code-reviewer.json');
  const bundledPath = resolve(options.actionPath, 'agents', 'code-reviewer.json');
  let sourcePath: string;
  let model: string;

  if (options.agent !== '') {
    const name = validateAgentName(options.agent);
    sourcePath = join(agentsDirectory, `${name}.json`);
    model = '';
    if (!existsSync(sourcePath)) throw new Error(`Agent configuration not found at ${sourcePath}`);
    if (options.model !== '') {
      core.warning('model input is ignored when agent input is specified');
    }
  } else {
    sourcePath = existsSync(workspaceDefault) ? workspaceDefault : bundledPath;
    model = options.model;
  }

  const { source, custom } = mergeAgent(bundledPath, sourcePath);
  return { source, custom, sourcePath, model };
}
