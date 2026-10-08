import * as core from '@actions/core';
import { isPlainObject } from '../guards.js';
import type { SourceAgentConfig } from './agent-loader.js';

const REVIEW_TOOLS = ['read', 'grep', 'glob'] as const;
const READ_TOOL_ALIASES = ['read', 'fs_read', 'fsRead'] as const;

interface ToolSelector {
  readonly server: string;
  readonly tool?: string;
}

interface ToolPolicy {
  readonly tools: string[];
  readonly allowedTools: string[];
  readonly toolsSettings: Record<string, unknown>;
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

/** Returns custom MCP server names, excluding the action-managed GitHub server. */
export function customServerNames(
  servers: Readonly<Record<string, unknown>> | undefined,
): string[] {
  return Object.keys(servers ?? {}).filter((server) => server !== 'github');
}

/** Builds the constrained exposure, auto-approval, and path policy for review tools. */
export function buildToolPolicy(
  source: SourceAgentConfig,
  customServers: readonly string[],
): ToolPolicy {
  const tools = buildTools(source, customServers);
  const allowedTools = buildAllowedTools(source, tools);
  const toolsSettings = buildToolsSettings(source);

  return { tools, allowedTools, toolsSettings };
}
