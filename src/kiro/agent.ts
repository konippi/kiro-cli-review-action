import { join } from 'node:path';
import * as core from '@actions/core';
import { writeJsonFile } from '../fs.js';
import { GENERATED_AGENT_NAME, loadAgent, type SourceAgentConfig } from './agent-loader.js';
import { buildToolPolicy, customServerNames } from './tool-policy.js';

const GITHUB_REVIEW_TOOLS = [
  'pull_request_read',
  'pull_request_review_write',
  'add_comment_to_pending_review',
] as const;

interface AgentConfigOptions {
  readonly mcpServerBinary: string;
  readonly model: string;
  readonly ignoredFieldsSource?: SourceAgentConfig;
}

interface WriteAgentConfigOptions {
  readonly workspace: string;
  readonly actionPath: string;
  readonly kiroHome: string;
  readonly agent: string;
  readonly model: string;
  readonly mcpServerBinary: string;
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

function ignoredAgentFields(source: SourceAgentConfig): string[] {
  const copiedFields = new Set(['description', 'prompt', 'resources', 'model', 'mcpServers']);
  const actionOwnedFields = new Set(['name', 'tools', 'allowedTools', 'toolsSettings']);

  return Object.keys(source).filter((key) => {
    if (copiedFields.has(key) || actionOwnedFields.has(key)) return false;
    if (key === 'includeMcpJson') return source[key] !== false;
    return true;
  });
}

/** Produces an allowlisted review agent with the action's constrained tool policy. */
export function buildAgentConfig(
  source: SourceAgentConfig,
  options: AgentConfigOptions,
): AgentConfig {
  const copiedSource = structuredClone(source);
  const ignoredFields = ignoredAgentFields(options.ignoredFieldsSource ?? source);
  if (ignoredFields.length > 0) {
    core.info(`Review agent ignores agent fields: ${ignoredFields.join(', ')}`);
  }

  const currentServers = copiedSource.mcpServers ?? {};
  const customServers = customServerNames(currentServers);

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
  const policy = buildToolPolicy(copiedSource, customServers);
  const agent: AgentConfig = {
    name: GENERATED_AGENT_NAME,
    mcpServers,
    tools: policy.tools,
    allowedTools: policy.allowedTools,
    toolsSettings: policy.toolsSettings,
    includeMcpJson: false,
  };

  if (copiedSource.description !== undefined) agent.description = copiedSource.description;
  if (copiedSource.prompt !== undefined) agent.prompt = copiedSource.prompt;
  if (copiedSource.resources !== undefined) agent.resources = copiedSource.resources;
  if (options.model !== '') {
    agent.model = options.model;
  } else if (copiedSource.model !== undefined) {
    agent.model = copiedSource.model;
  }

  return agent;
}

/** Resolves a trusted agent, injects GitHub MCP, and writes the generated agent securely. */
export function writeAgentConfig(options: WriteAgentConfigOptions): void {
  const { source, custom, sourcePath, model } = loadAgent(options);
  const policy = Object.hasOwn(custom, 'prompt') ? 'custom' : 'default';
  const customServers = customServerNames(source.mcpServers);
  const config = buildAgentConfig(source, {
    mcpServerBinary: options.mcpServerBinary,
    model,
    ignoredFieldsSource: custom,
  });
  const destination = join(options.kiroHome, 'agents', `${GENERATED_AGENT_NAME}.json`);

  core.info(
    `Effective review agent: source=${sourcePath}; policy=${policy}; resources=${source.resources?.length ?? 0}; customMcpServers=${customServers.length}`,
  );
  writeJsonFile(destination, config);
}
