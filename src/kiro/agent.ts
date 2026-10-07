import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as core from '@actions/core';
import { isPlainObject } from '../guards.js';

/** Reserved name used for the generated review agent. */
export const GENERATED_AGENT_NAME = 'kiro-review-action';

const AGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const REVIEW_TOOLS = ['read', 'grep', 'glob'] as const;
const GITHUB_REVIEW_TOOLS = [
  'pull_request_read',
  'pull_request_review_write',
  'add_comment_to_pending_review',
] as const;
const READ_TOOL_ALIASES = ['read', 'fs_read', 'fsRead'] as const;

interface AgentConfigOptions {
  readonly mcpServerBinary: string;
  readonly model: string;
  readonly sourceDirectory: string;
}

interface WriteAgentConfigOptions {
  readonly workspace: string;
  readonly actionPath: string;
  readonly kiroHome: string;
  readonly agent: string;
  readonly model: string;
  readonly mcpServerBinary: string;
}

/** Validates and returns a single-segment non-reserved Kiro agent name. */
export function validateAgentName(name: string): string {
  if (name === GENERATED_AGENT_NAME || !AGENT_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid agent: ${name}; expected a non-reserved name using alphanumeric, _, and - characters`,
    );
  }

  return name;
}

interface SourceAgentConfig {
  description?: string;
  prompt?: string;
  model?: string;
  tools?: readonly unknown[];
  allowedTools?: readonly unknown[];
  resources?: readonly unknown[];
  mcpServers?: Record<string, unknown>;
  toolsSettings?: Record<string, unknown>;
  [property: string]: unknown;
}

interface AgentConfig {
  name: string;
  description?: string;
  prompt?: string;
  resources?: readonly unknown[];
  model?: string;
  tools: string[];
  allowedTools: string[];
  mcpServers: Record<string, unknown>;
  toolsSettings: Record<string, unknown>;
  includeMcpJson: false;
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
): asserts value is Record<string, unknown> | undefined {
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

interface ToolSelector {
  readonly server: string;
  readonly tool?: string;
}

function hasWildcard(value: string): boolean {
  return value.includes('*') || value.includes('?');
}

function parseSelector(selector: string): ToolSelector | undefined {
  if (selector === '@builtin') return undefined;

  const match = /^@([^/]+)(?:\/([^/]+))?$/.exec(selector);
  const server = match?.[1];
  if (server === undefined || hasWildcard(server)) return undefined;

  const tool = match?.[2];

  return tool === undefined ? { server } : { server, tool };
}

function isManagedGitHubSelector(
  selector: ToolSelector | undefined,
): selector is ToolSelector & { readonly server: 'github' } {
  return selector?.server === 'github';
}

function formatEntry(entry: unknown): string {
  if (typeof entry === 'string') return entry;

  const serialized = JSON.stringify(entry);

  return serialized ?? String(entry);
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function buildTools(agent: SourceAgentConfig, customServers: readonly string[]): string[] {
  const selectors: string[] = [];
  const dropped: unknown[] = [];
  const undeclared: string[] = [];
  const sourceTools = agent.tools ?? [];
  const fixedTools = new Set<string>([...REVIEW_TOOLS, ...READ_TOOL_ALIASES, '@builtin', '*']);

  if (sourceTools.includes('*')) {
    for (const server of customServers) appendUnique(selectors, `@${server}`);
  }

  for (const entry of sourceTools) {
    if (typeof entry !== 'string') {
      dropped.push(entry);
      continue;
    }

    const selector = parseSelector(entry);
    if (fixedTools.has(entry)) continue;
    if (isManagedGitHubSelector(selector)) {
      if (hasWildcard(selector.tool ?? '')) dropped.push(entry);
      continue;
    }
    if (selector === undefined) {
      dropped.push(entry);
      continue;
    }
    if (!customServers.includes(selector.server)) {
      appendUnique(undeclared, entry);
      continue;
    }
    if (hasWildcard(selector.tool ?? '')) {
      dropped.push(entry);
      continue;
    }

    appendUnique(selectors, entry);
  }

  if (dropped.length > 0) {
    core.info(
      `Review agent exposes read, grep, glob and MCP servers only; dropped tools: ${dropped.map(formatEntry).join(', ')}`,
    );
  }
  if (undeclared.length > 0) {
    core.warning(
      `Review agent dropped selectors for undeclared MCP servers: ${undeclared.join(', ')}`,
    );
  }

  return [...REVIEW_TOOLS, '@github', ...selectors];
}

function buildAllowedTools(
  agent: SourceAgentConfig,
  exposedSelectors: readonly string[],
): string[] {
  const selectors: string[] = [];
  const dropped: unknown[] = [];

  for (const entry of agent.allowedTools ?? []) {
    if (typeof entry !== 'string') {
      dropped.push(entry);
      continue;
    }

    const selector = parseSelector(entry);
    if (isManagedGitHubSelector(selector)) continue;
    if (
      selector !== undefined &&
      (exposedSelectors.includes(`@${selector.server}`) || exposedSelectors.includes(entry))
    ) {
      appendUnique(selectors, entry);
    } else {
      dropped.push(entry);
    }
  }

  if (dropped.length > 0) {
    core.info(
      `Review agent auto-approves custom MCP servers only; dropped allowedTools: ${dropped.map(formatEntry).join(', ')}`,
    );
  }

  return ['@github', ...selectors];
}

function buildToolsSettings(agent: SourceAgentConfig): Record<string, unknown> {
  const settings = { ...(agent.toolsSettings ?? {}) };
  let readSettings: Record<string, unknown> = {};

  for (const alias of READ_TOOL_ALIASES) {
    if (isPlainObject(settings[alias])) readSettings = { ...readSettings, ...settings[alias] };
    delete settings[alias];
  }

  settings.read = { ...readSettings, allowedPaths: ['./**'] };
  for (const tool of ['grep', 'glob'] as const) {
    const current = isPlainObject(settings[tool]) ? settings[tool] : {};
    settings[tool] = { ...current, allowedPaths: ['./**'] };
  }

  return settings;
}

function ignoredAgentFields(source: SourceAgentConfig): string[] {
  const copiedFields = new Set(['description', 'prompt', 'resources', 'model', 'mcpServers']);
  const actionOwnedFields = new Set(['name', 'tools', 'allowedTools', 'toolsSettings']);

  return Object.keys(source).filter((key) => {
    if (copiedFields.has(key) || actionOwnedFields.has(key)) return false;
    if (key === 'includeMcpJson') return source[key] !== false;
    return true;
  });
}

function resolvePrompt(prompt: string | undefined, sourceDirectory: string): string | undefined {
  if (prompt === undefined || !prompt.startsWith('file://')) return prompt;
  const path = prompt.slice('file://'.length);
  return path.startsWith('/') ? prompt : `file://${resolve(sourceDirectory, path)}`;
}

/** Produces an allowlisted review agent with the action's constrained tool policy. */
export function buildAgentConfig(
  source: SourceAgentConfig,
  options: AgentConfigOptions,
): AgentConfig {
  const copiedSource = structuredClone(source);
  const ignoredFields = ignoredAgentFields(source);
  if (ignoredFields.length > 0) {
    core.info(`Review agent ignores agent fields: ${ignoredFields.join(', ')}`);
  }

  const currentServers = copiedSource.mcpServers ?? {};
  const customServers = Object.keys(currentServers).filter((server) => server !== 'github');

  if (Object.hasOwn(currentServers, 'github')) {
    core.warning("Replacing the agent's github MCP server with the one managed by the action");
  }
  const mcpServers = {
    ...currentServers,
    github: {
      command: options.mcpServerBinary,
      args: ['stdio', '--tools', GITHUB_REVIEW_TOOLS.join(',')],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: `\${GITHUB_PERSONAL_ACCESS_TOKEN}` },
    },
  };
  const tools = buildTools(copiedSource, customServers);
  const allowedTools = buildAllowedTools(copiedSource, tools);
  const agent: AgentConfig = {
    name: GENERATED_AGENT_NAME,
    mcpServers,
    tools,
    allowedTools,
    toolsSettings: buildToolsSettings(copiedSource),
    includeMcpJson: false,
  };

  if (copiedSource.description !== undefined) agent.description = copiedSource.description;
  const prompt = resolvePrompt(copiedSource.prompt, options.sourceDirectory);
  if (prompt !== undefined) agent.prompt = prompt;
  if (copiedSource.resources !== undefined) agent.resources = copiedSource.resources;
  if (options.model !== '') {
    agent.model = options.model;
  } else if (copiedSource.model !== undefined) {
    agent.model = copiedSource.model;
  }

  return agent;
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

/** Resolves a trusted agent, injects GitHub MCP, and writes the generated agent securely. */
export function writeAgentConfig(options: WriteAgentConfigOptions): void {
  const agentsDirectory = join(options.workspace, '.kiro', 'agents');
  const workspaceDefault = join(agentsDirectory, 'code-reviewer.json');
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
    sourcePath = existsSync(workspaceDefault)
      ? workspaceDefault
      : join(options.actionPath, 'agents', 'code-reviewer.json');
    model = options.model;
  }

  const config = buildAgentConfig(readAgent(sourcePath), {
    mcpServerBinary: options.mcpServerBinary,
    model,
    sourceDirectory: dirname(sourcePath),
  });
  const destination = join(options.kiroHome, 'agents', `${GENERATED_AGENT_NAME}.json`);

  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(destination, 0o600);
}
