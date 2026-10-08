import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAgentConfig, writeAgentConfig } from '../../src/kiro/agent.js';
import { GENERATED_AGENT_NAME } from '../../src/kiro/agent-loader.js';
import { writeBundledAgent, writeJson } from '../helpers/agent.js';

vi.mock('@actions/core', () => ({ info: vi.fn(), warning: vi.fn() }));

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'kiro-agent-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('buildAgentConfig', () => {
  it('deep copies returned nested source fields', () => {
    const source = {
      resources: ['file://CONTRIBUTING.md'],
      mcpServers: { workspace: { command: 'node', args: ['server.js'] } },
      toolsSettings: { read: { maxFileSize: 1000 } },
      includeMcpJson: false,
    };
    const built = buildAgentConfig(source, {
      mcpServerBinary: '/safe/mcp',
      model: '',
    });
    const builtWithoutResources = buildAgentConfig(
      { mcpServers: { github: { command: 'unsafe' } } },
      { mcpServerBinary: '/safe/mcp', model: '' },
    );

    expect(built.resources).not.toBe(source.resources);
    expect(builtWithoutResources.resources).toBeUndefined();
    expect(built.mcpServers.workspace).not.toBe(source.mcpServers.workspace);
    expect(built.toolsSettings.read).not.toBe(source.toolsSettings.read);
  });

  it('emits only allowed fields and reports ignored source fields once', () => {
    const built = buildAgentConfig(
      {
        name: 'source',
        description: 'Source description',
        prompt: 'Review carefully',
        resources: ['file://CONTRIBUTING.md'],
        model: 'source-model',
        hooks: { agentSpawn: [{ command: 'node scripts/review-hook.js' }] },
        toolAliases: { jira: '@workspace' },
        useLegacyMcpJson: true,
        includeMcpJson: true,
        unknown: { retained: false },
        mcpServers: {
          workspace: { command: 'node', args: ['scripts/workspace-server.js'] },
          github: { command: 'unsafe' },
        },
        tools: ['@workspace'],
        allowedTools: ['@workspace/run'],
        toolsSettings: { read: { maxFileSize: 1000 } },
      },
      { mcpServerBinary: '/safe/mcp', model: '' },
    );

    expect(built).toEqual({
      name: GENERATED_AGENT_NAME,
      description: 'Source description',
      prompt: 'Review carefully',
      resources: ['file://CONTRIBUTING.md'],
      model: 'source-model',
      mcpServers: {
        workspace: { command: 'node', args: ['scripts/workspace-server.js'] },
        github: {
          command: '/safe/mcp',
          args: [
            'stdio',
            '--tools',
            'pull_request_read,pull_request_review_write,add_comment_to_pending_review',
          ],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: `\${GITHUB_PERSONAL_ACCESS_TOKEN}` },
        },
      },
      tools: ['read', 'grep', 'glob', '@github', '@workspace'],
      allowedTools: ['@github', '@workspace/run'],
      toolsSettings: {
        read: { maxFileSize: 1000, allowedPaths: ['./**'] },
        grep: { allowedPaths: ['./**'] },
        glob: { allowedPaths: ['./**'] },
      },
      includeMcpJson: false,
    });
    expect(core.info).toHaveBeenCalledTimes(1);
    expect(core.info).toHaveBeenCalledWith(
      'Review agent ignores agent fields: hooks, toolAliases, useLegacyMcpJson, includeMcpJson, unknown',
    );
    expect(core.warning).toHaveBeenCalledWith(
      "Replacing the agent's github MCP server with the one managed by the action",
    );
  });

  it('preserves source agent resources', () => {
    const resources = ['file://CONTRIBUTING.md', 'file:///etc/passwd', 'file://~/.kiro/x'];

    const built = buildAgentConfig({ resources }, { mcpServerBinary: '/mcp', model: '' });

    expect(built.resources).toEqual(resources);
  });
});

describe('writeAgentConfig', () => {
  it('exposes every tool named by the bundled review prompt', () => {
    const root = temporaryDirectory();
    const kiroHome = join(root, 'kiro-home');
    const actionPath = process.cwd();

    writeAgentConfig({
      workspace: join(root, 'workspace'),
      actionPath,
      kiroHome,
      agent: '',
      model: '',
      mcpServerBinary: '/mcp',
    });

    const generated = JSON.parse(
      readFileSync(join(kiroHome, 'agents', `${GENERATED_AGENT_NAME}.json`), 'utf8'),
    );
    expect(generated.prompt).toBe(`file://${join(actionPath, 'agents', 'code-reviewer.md')}`);

    const prompt = readFileSync(join(actionPath, 'prompts', 'review.md'), 'utf8');
    const namedTools = [
      ...prompt.replace(/with method `[^`]+`/gu, '').matchAll(/`[a-z][a-z0-9_]*`/gu),
    ].map((match) => match[0].slice(1, -1));
    const builtIns = generated.tools.filter((tool: string) => !tool.startsWith('@'));
    const githubArgs = generated.mcpServers.github.args;
    const toolsArgument = githubArgs[githubArgs.indexOf('--tools') + 1];
    const exposedTools = [...builtIns, ...toolsArgument.split(',')];

    expect(exposedTools).toEqual(expect.arrayContaining(namedTools));
  });

  it('uses the bundled agent and writes it under KIRO_HOME without writing settings', () => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const actionPath = join(root, 'action');
    const kiroHome = join(root, 'kiro-home');
    writeBundledAgent(actionPath);
    const destination = join(kiroHome, 'agents', `${GENERATED_AGENT_NAME}.json`);
    writeJson(destination, { stale: true });

    writeAgentConfig({
      workspace,
      actionPath,
      kiroHome,
      agent: '',
      model: 'chosen',
      mcpServerBinary: '/mcp',
    });

    expect(existsSync(join(workspace, '.kiro', 'agents', `${GENERATED_AGENT_NAME}.json`))).toBe(
      false,
    );
    expect(readFileSync(destination, 'utf8')).toMatch(/\n$/);
    expect(JSON.parse(readFileSync(destination, 'utf8'))).toMatchObject({
      description: 'bundled',
      prompt: `file://${join(actionPath, 'agents', 'code-reviewer.md')}`,
      resources: ['file://CONTRIBUTING.md'],
      model: 'chosen',
    });
    expect(existsSync(join(kiroHome, 'settings', 'cli.json'))).toBe(false);
    expect(core.info).toHaveBeenCalledWith(
      `Effective review agent: source=${join(actionPath, 'agents', 'code-reviewer.json')}; policy=default; resources=1; customMcpServers=0`,
    );
  });

  it('reports ignored fields once and only from the custom agent', () => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const actionPath = join(root, 'action');
    const kiroHome = join(root, 'kiro-home');
    writeBundledAgent(actionPath, { bundledOnly: true });
    writeJson(join(workspace, '.kiro', 'agents', 'code-reviewer.json'), {
      prompt: 'Review carefully',
      resources: [],
      hooks: {},
      unknown: true,
    });

    writeAgentConfig({
      workspace,
      actionPath,
      kiroHome,
      agent: '',
      model: '',
      mcpServerBinary: '/mcp',
    });

    expect(core.info).toHaveBeenCalledTimes(2);
    expect(core.info).toHaveBeenCalledWith('Review agent ignores agent fields: hooks, unknown');
    expect(core.info).toHaveBeenCalledWith(
      `Effective review agent: source=${join(workspace, '.kiro', 'agents', 'code-reviewer.json')}; policy=custom; resources=0; customMcpServers=0`,
    );
  });
});
