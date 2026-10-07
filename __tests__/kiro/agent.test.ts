import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as core from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAgentConfig,
  GENERATED_AGENT_NAME,
  validateAgentName,
  writeAgentConfig,
} from '../../src/kiro/agent.js';

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

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

describe('validateAgentName', () => {
  it.each(['agent', 'A_b-c'])('accepts %s', (name) => {
    expect(validateAgentName(name)).toBe(name);
  });

  it.each(['reviewer.v2', 'team/reviewer', '../agent', 'bad name', GENERATED_AGENT_NAME])(
    'rejects %s',
    (name) => {
      expect(() => validateAgentName(name)).toThrow('Invalid agent:');
    },
  );
});

describe('buildAgentConfig', () => {
  it('deep copies returned nested source fields', () => {
    const source = {
      resources: ['file://CONTRIBUTING.md'],
      mcpServers: { workspace: { command: 'node', args: ['server.js'] } },
      toolsSettings: { read: { maxFileSize: 1000 } },
    };
    const built = buildAgentConfig(source, {
      mcpServerBinary: '/safe/mcp',
      model: '',
      sourceDirectory: '/source',
    });

    expect(built.resources).not.toBe(source.resources);
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
      { mcpServerBinary: '/safe/mcp', model: '', sourceDirectory: '/source' },
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

  it('accepts the bundled default tool policy without dropped-entry logs', () => {
    const built = buildAgentConfig(
      {
        tools: ['read', 'grep', 'glob', '@github'],
        allowedTools: ['@github'],
      },
      { mcpServerBinary: '/mcp', model: '', sourceDirectory: '/source' },
    );

    expect(built.tools).toEqual(['read', 'grep', 'glob', '@github']);
    expect(built.allowedTools).toEqual(['@github']);
    expect(core.info).not.toHaveBeenCalled();
    expect(core.warning).not.toHaveBeenCalled();
  });

  it.each([
    ['file://../prompt.md', 'file:///source/prompt.md'],
    ['file://prompt.md', 'file:///source/agents/prompt.md'],
    ['file:///absolute/prompt.md', 'file:///absolute/prompt.md'],
    ['Review carefully', 'Review carefully'],
  ])('resolves source prompt %s', (prompt, expected) => {
    const built = buildAgentConfig(
      { prompt },
      { mcpServerBinary: '/mcp', model: '', sourceDirectory: '/source/agents' },
    );

    expect(built.prompt).toBe(expected);
  });

  it('does not mutate the source github MCP server', () => {
    const source = { mcpServers: { github: { command: 'unsafe' } } };

    buildAgentConfig(source, {
      mcpServerBinary: '/safe/mcp',
      model: '',
      sourceDirectory: '/source',
    });

    expect(source.mcpServers.github.command).toBe('unsafe');
  });

  it('expands wildcard exposure only to declared custom MCP servers', () => {
    const built = buildAgentConfig(
      {
        mcpServers: { jira: { command: '/jira' } },
        tools: ['*'],
        allowedTools: ['@builtin', 'code', 'read'],
      },
      { mcpServerBinary: '/mcp', model: '', sourceDirectory: '/source' },
    );

    expect(built.mcpServers).toMatchObject({ jira: { command: '/jira' } });
    expect(built.tools).toEqual(['read', 'grep', 'glob', '@github', '@jira']);
    expect(built.allowedTools).toEqual(['@github']);
    expect(core.info).toHaveBeenCalledTimes(1);
    expect(core.info).toHaveBeenCalledWith(
      'Review agent auto-approves custom MCP servers only; dropped allowedTools: @builtin, code, read',
    );
  });

  it('preserves selectors and auto-approvals for declared custom MCP servers', () => {
    const built = buildAgentConfig(
      {
        mcpServers: { jira: { command: '/jira' } },
        tools: ['@jira', 'fs_write', '@jira/read_*', '@github/read_*'],
        allowedTools: ['@jira/search', '*'],
      },
      { mcpServerBinary: '/mcp', model: '', sourceDirectory: '/source' },
    );

    expect(built.tools).toEqual(['read', 'grep', 'glob', '@github', '@jira']);
    expect(built.allowedTools).toEqual(['@github', '@jira/search']);
    expect(core.info).toHaveBeenCalledWith(
      'Review agent exposes read, grep, glob and MCP servers only; dropped tools: fs_write, @jira/read_*, @github/read_*',
    );
    expect(core.warning).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(
      'Review agent auto-approves custom MCP servers only; dropped allowedTools: *',
    );
  });

  it.each([
    {
      name: 'server-wide exposure',
      tools: ['@jira'],
      allowedTools: ['@jira/read_*', '@jira/*_get', '@*/status', '@jira-*', '@jira-*/x', 'fs_*'],
      expected: ['@github', '@jira/read_*', '@jira/*_get'],
      dropped: '@*/status, @jira-*, @jira-*/x, fs_*',
    },
    {
      name: 'granular-only exposure',
      tools: ['@jira/search'],
      allowedTools: ['@jira/read_*'],
      expected: ['@github'],
      dropped: '@jira/read_*',
    },
  ])('handles allowedTools wildcards with $name', ({ tools, allowedTools, expected, dropped }) => {
    const built = buildAgentConfig(
      { mcpServers: { jira: { command: '/jira' } }, tools, allowedTools },
      { mcpServerBinary: '/mcp', model: '', sourceDirectory: '/source' },
    );

    expect(built.allowedTools).toEqual(expected);
    expect(core.info).toHaveBeenCalledWith(
      `Review agent auto-approves custom MCP servers only; dropped allowedTools: ${dropped}`,
    );
  });

  it('auto-approves only granular selectors that are exposed exactly', () => {
    const built = buildAgentConfig(
      {
        mcpServers: { jira: { command: '/jira' } },
        tools: ['@jira/search'],
        allowedTools: ['@jira/search', '@jira', '@jira/other'],
      },
      { mcpServerBinary: '/mcp', model: '', sourceDirectory: '/source' },
    );

    expect(built.tools).toEqual(['read', 'grep', 'glob', '@github', '@jira/search']);
    expect(built.allowedTools).toEqual(['@github', '@jira/search']);
  });

  it('drops non-string exposure and auto-approval entries', () => {
    const built = buildAgentConfig(
      { tools: [42], allowedTools: [{ unsafe: true }] },
      { mcpServerBinary: '/mcp', model: '', sourceDirectory: '/source' },
    );

    expect(built.tools).toEqual(['read', 'grep', 'glob', '@github']);
    expect(built.allowedTools).toEqual(['@github']);
    expect(core.info).toHaveBeenCalledWith(
      'Review agent exposes read, grep, glob and MCP servers only; dropped tools: 42',
    );
    expect(core.info).toHaveBeenCalledWith(
      'Review agent auto-approves custom MCP servers only; dropped allowedTools: {"unsafe":true}',
    );
  });

  it('formats undefined dropped tool entries without throwing', () => {
    const built = buildAgentConfig(
      { tools: [undefined] },
      { mcpServerBinary: '/mcp', model: '', sourceDirectory: '/source' },
    );

    expect(built.tools).toEqual(['read', 'grep', 'glob', '@github']);
    expect(core.info).toHaveBeenCalledWith(
      'Review agent exposes read, grep, glob and MCP servers only; dropped tools: undefined',
    );
  });

  it('deduplicates selectors for declared custom MCP servers', () => {
    const built = buildAgentConfig(
      { mcpServers: { jira: { command: '/jira' } }, tools: ['*', '@jira'] },
      { mcpServerBinary: '/mcp', model: '', sourceDirectory: '/source' },
    );

    expect(built.tools).toEqual(['read', 'grep', 'glob', '@github', '@jira']);
    expect(core.info).not.toHaveBeenCalled();
  });

  it('warns about selectors for undeclared MCP servers without double-reporting', () => {
    const built = buildAgentConfig(
      { tools: ['@unknown'] },
      { mcpServerBinary: '/mcp', model: '', sourceDirectory: '/source' },
    );

    expect(built.tools).toEqual(['read', 'grep', 'glob', '@github']);
    expect(core.info).not.toHaveBeenCalled();
    expect(core.warning).toHaveBeenCalledWith(
      'Review agent dropped selectors for undeclared MCP servers: @unknown',
    );
  });

  it('normalizes read aliases and restricts all exposed read tools to the workspace', () => {
    const built = buildAgentConfig(
      {
        toolsSettings: {
          read: { maxFileSize: 1000 },
          fs_read: { deniedPaths: ['secrets/**'] },
          fsRead: { allowReadOnly: true },
          grep: { timeout: 5 },
          other: { retained: true },
        },
      },
      { mcpServerBinary: '/mcp', model: '', sourceDirectory: '/source' },
    );

    expect(built.toolsSettings).toEqual({
      read: {
        maxFileSize: 1000,
        deniedPaths: ['secrets/**'],
        allowReadOnly: true,
        allowedPaths: ['./**'],
      },
      grep: { timeout: 5, allowedPaths: ['./**'] },
      glob: { allowedPaths: ['./**'] },
      other: { retained: true },
    });
  });

  it('uses fixed defaults when source tools and allowedTools are absent', () => {
    const built = buildAgentConfig(
      {},
      { mcpServerBinary: '/mcp', model: '', sourceDirectory: '/source' },
    );

    expect(built.tools).toEqual(['read', 'grep', 'glob', '@github']);
    expect(built.allowedTools).toEqual(['@github']);
    expect(built.toolsSettings).toEqual({
      read: { allowedPaths: ['./**'] },
      grep: { allowedPaths: ['./**'] },
      glob: { allowedPaths: ['./**'] },
    });
  });

  it('preserves source agent resources', () => {
    const resources = ['file://CONTRIBUTING.md', 'file:///etc/passwd', 'file://~/.kiro/x'];

    const built = buildAgentConfig(
      { resources },
      { mcpServerBinary: '/mcp', model: '', sourceDirectory: '/source' },
    );

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

  it('uses the bundled agent, writes under KIRO_HOME, and sets mode 0600', () => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const actionPath = join(root, 'action');
    const kiroHome = join(root, 'kiro-home');
    writeJson(join(actionPath, 'agents', 'code-reviewer.json'), { description: 'bundled' });
    const existingDestination = join(kiroHome, 'agents', `${GENERATED_AGENT_NAME}.json`);
    writeJson(existingDestination, { stale: true });
    chmodSync(existingDestination, 0o644);

    writeAgentConfig({
      workspace,
      actionPath,
      kiroHome,
      agent: '',
      model: 'chosen',
      mcpServerBinary: '/mcp',
    });
    const destination = join(kiroHome, 'agents', `${GENERATED_AGENT_NAME}.json`);

    expect(existsSync(join(workspace, '.kiro', 'agents', `${GENERATED_AGENT_NAME}.json`))).toBe(
      false,
    );
    expect(readFileSync(destination, 'utf8')).toMatch(/\n$/);
    expect(JSON.parse(readFileSync(destination, 'utf8'))).toMatchObject({
      description: 'bundled',
      model: 'chosen',
    });
    expect(statSync(destination).mode & 0o777).toBe(0o600);
  });

  it('prefers the workspace default agent', () => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const actionPath = join(root, 'action');
    const kiroHome = join(root, 'kiro-home');
    writeJson(join(actionPath, 'agents', 'code-reviewer.json'), { description: 'bundled' });
    writeJson(join(workspace, '.kiro', 'agents', 'code-reviewer.json'), {
      description: 'workspace',
    });

    writeAgentConfig({
      workspace,
      actionPath,
      kiroHome,
      agent: '',
      model: '',
      mcpServerBinary: '/mcp',
    });
    const destination = join(kiroHome, 'agents', `${GENERATED_AGENT_NAME}.json`);

    expect(JSON.parse(readFileSync(destination, 'utf8')).description).toBe('workspace');
  });

  it('requires custom agents, ignores model for them, and warns', () => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const options = {
      workspace,
      actionPath: join(root, 'action'),
      kiroHome: join(root, 'kiro-home'),
      agent: 'custom',
      model: 'ignored',
      mcpServerBinary: '/mcp',
    };

    expect(() => writeAgentConfig(options)).toThrow('Agent configuration not found at');
    writeJson(join(workspace, '.kiro', 'agents', 'custom.json'), { model: 'source-model' });
    writeAgentConfig(options);
    const destination = join(options.kiroHome, 'agents', `${GENERATED_AGENT_NAME}.json`);

    expect(JSON.parse(readFileSync(destination, 'utf8')).model).toBe('source-model');
    expect(core.warning).toHaveBeenCalledWith(
      'model input is ignored when agent input is specified',
    );
  });

  it('does not warn about an empty model input for a custom agent', () => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    writeJson(join(workspace, '.kiro', 'agents', 'custom.json'), {});

    writeAgentConfig({
      workspace,
      actionPath: join(root, 'action'),
      kiroHome: join(root, 'kiro-home'),
      agent: 'custom',
      model: '',
      mcpServerBinary: '/mcp',
    });

    expect(core.warning).not.toHaveBeenCalledWith(
      'model input is ignored when agent input is specified',
    );
  });

  it.each<[string, unknown]>([
    ['tools', 'x'],
    ['allowedTools', {}],
    ['resources', 'x'],
    ['mcpServers', []],
    ['toolsSettings', 'x'],
    ['prompt', 42],
    ['description', {}],
    ['model', []],
  ])('rejects invalid %s shape', (key, value) => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    writeJson(join(workspace, '.kiro', 'agents', 'code-reviewer.json'), { [key]: value });

    expect(() =>
      writeAgentConfig({
        workspace,
        actionPath: join(root, 'action'),
        kiroHome: join(root, 'kiro-home'),
        agent: '',
        model: '',
        mcpServerBinary: '/mcp',
      }),
    ).toThrow(`has ${key} that is not`);
  });

  it.each([
    ['{broken', 'Invalid JSON in agent configuration at'],
    ['[]', 'must be a JSON object'],
  ])('fails closed for malformed source %s', (content, message) => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const source = join(workspace, '.kiro', 'agents', 'code-reviewer.json');
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, content);

    expect(() =>
      writeAgentConfig({
        workspace,
        actionPath: join(root, 'action'),
        kiroHome: join(root, 'kiro-home'),
        agent: '',
        model: '',
        mcpServerBinary: '/mcp',
      }),
    ).toThrow(message);
  });

  it('reports an unreadable source path without exposing contents', () => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const source = join(workspace, '.kiro', 'agents', 'code-reviewer.json');
    mkdirSync(source, { recursive: true });
    chmodSync(source, 0o700);

    expect(() =>
      writeAgentConfig({
        workspace,
        actionPath: join(root, 'action'),
        kiroHome: join(root, 'kiro-home'),
        agent: '',
        model: '',
        mcpServerBinary: '/mcp',
      }),
    ).toThrow(`Unable to read agent configuration at ${source}`);
  });
});
