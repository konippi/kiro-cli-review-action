import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as core from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAgent } from '../../src/kiro/agent-loader.js';
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
  const directory = mkdtempSync(join(tmpdir(), 'kiro-agent-loader-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('loadAgent', () => {
  it.each(['A_b-c'])('accepts agent name %s', (agent) => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const actionPath = join(root, 'action');
    writeBundledAgent(actionPath);
    writeJson(join(workspace, '.kiro', 'agents', `${agent}.json`), {});

    expect(loadAgent({ workspace, actionPath, agent, model: '' }).sourcePath).toBe(
      join(workspace, '.kiro', 'agents', `${agent}.json`),
    );
  });

  it.each(['reviewer.v2', 'team/reviewer', '../agent', 'bad name', 'kiro-review-action'])(
    'rejects agent name %s',
    (agent) => {
      expect(() =>
        loadAgent({ workspace: '/workspace', actionPath: '/action', agent, model: '' }),
      ).toThrow('Invalid agent:');
    },
  );

  it.each([
    ['file://../prompt.md', join('.kiro', 'prompt.md')],
    ['file://prompt.md', join('.kiro', 'agents', 'prompt.md')],
    ['file:///absolute/prompt.md', undefined],
    ['Review carefully', undefined],
  ])('resolves a custom source prompt %s when loading', (prompt, relativeExpected) => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const actionPath = join(root, 'action');
    writeBundledAgent(actionPath);
    writeJson(join(workspace, '.kiro', 'agents', 'code-reviewer.json'), { prompt });

    const loaded = loadAgent({ workspace, actionPath, agent: '', model: '' });
    const expected =
      relativeExpected === undefined ? prompt : `file://${join(workspace, relativeExpected)}`;

    expect(loaded.source.prompt).toBe(expected);
  });

  it.each([
    {
      name: 'uses the bundled fallback',
      agent: '',
      file: undefined,
      custom: {},
      inputModel: 'chosen',
      expectedModel: 'chosen',
      expectedDescription: 'bundled',
      expectedPrompt: 'bundled',
      expectedResources: ['file://CONTRIBUTING.md'],
    },
    {
      name: 'inherits bundled fields for a workspace agent',
      agent: '',
      file: 'code-reviewer.json',
      custom: {
        description: 'workspace',
        model: 'source-model',
        mcpServers: { workspace: { command: '/workspace' } },
      },
      inputModel: '',
      expectedModel: '',
      expectedDescription: 'workspace',
      expectedPrompt: 'bundled',
      expectedResources: ['file://CONTRIBUTING.md'],
    },
    {
      name: 'preserves explicit empty replacements',
      agent: '',
      file: 'code-reviewer.json',
      custom: { prompt: '', resources: [], mcpServers: {} },
      inputModel: '',
      expectedModel: '',
      expectedDescription: 'bundled',
      expectedPrompt: '',
      expectedResources: [],
    },
  ])('$name', (testCase) => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const actionPath = join(root, 'action');
    writeBundledAgent(actionPath);
    if (testCase.file !== undefined) {
      writeJson(join(workspace, '.kiro', 'agents', testCase.file), testCase.custom);
    }

    const loaded = loadAgent({
      workspace,
      actionPath,
      agent: testCase.agent,
      model: testCase.inputModel,
    });

    const bundledPath = join(actionPath, 'agents', 'code-reviewer.json');
    const expectedPath =
      testCase.file === undefined ? bundledPath : join(workspace, '.kiro', 'agents', testCase.file);
    expect(loaded).toMatchObject({
      custom: testCase.custom,
      source: { description: testCase.expectedDescription },
      sourcePath: expectedPath,
      model: testCase.expectedModel,
    });
    expect(loaded.source.prompt).toBe(
      testCase.expectedPrompt === 'bundled'
        ? `file://${join(actionPath, 'agents', 'code-reviewer.md')}`
        : testCase.expectedPrompt,
    );
    expect(loaded.source.resources).toEqual(testCase.expectedResources);
  });

  it('requires custom agents, ignores model for them, and warns', () => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const actionPath = join(root, 'action');
    const options = { workspace, actionPath, agent: 'custom', model: 'ignored' };
    writeBundledAgent(actionPath);

    expect(() => loadAgent(options)).toThrow('Agent configuration not found at');
    writeJson(join(workspace, '.kiro', 'agents', 'custom.json'), { model: 'source-model' });

    expect(loadAgent(options)).toMatchObject({
      source: { model: 'source-model' },
      model: '',
    });
    expect(core.warning).toHaveBeenCalledWith(
      'model input is ignored when agent input is specified',
    );

    vi.mocked(core.warning).mockClear();
    loadAgent({ ...options, model: '' });

    expect(core.warning).not.toHaveBeenCalled();
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
    const actionPath = join(root, 'action');
    writeBundledAgent(actionPath);
    writeJson(join(workspace, '.kiro', 'agents', 'code-reviewer.json'), { [key]: value });

    expect(() => loadAgent({ workspace, actionPath, agent: '', model: '' })).toThrow(
      `has ${key} that is not`,
    );
  });

  it.each([
    ['{broken', 'Invalid JSON in agent configuration at'],
    ['[]', 'must be a JSON object'],
  ])('fails closed for malformed source %s', (content, message) => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const actionPath = join(root, 'action');
    writeBundledAgent(actionPath);
    const source = join(workspace, '.kiro', 'agents', 'code-reviewer.json');
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, content);

    expect(() => loadAgent({ workspace, actionPath, agent: '', model: '' })).toThrow(message);
  });

  it('reports an unreadable source path without exposing contents', () => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const actionPath = join(root, 'action');
    writeBundledAgent(actionPath);
    const source = join(workspace, '.kiro', 'agents', 'code-reviewer.json');
    mkdirSync(source, { recursive: true });
    chmodSync(source, 0o700);

    expect(() => loadAgent({ workspace, actionPath, agent: '', model: '' })).toThrow(
      `Unable to read agent configuration at ${source}`,
    );
  });
});
