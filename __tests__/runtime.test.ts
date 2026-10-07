import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPullRequestTarget } from './helpers/context.js';
import { createActionInputs } from './helpers/inputs.js';

const mocks = vi.hoisted(() => ({
  installKiroCli: vi.fn(),
  installGithubMcpServer: vi.fn(),
  writeAgentConfig: vi.fn(),
  buildKiroEnv: vi.fn(),
  buildPrompt: vi.fn(),
  runKiro: vi.fn(),
  saveKiroPid: vi.fn(),
  clearKiroPid: vi.fn(),
}));

vi.mock('../src/setup/kiro-cli.js', () => ({
  installKiroCli: mocks.installKiroCli,
}));
vi.mock('../src/setup/github-mcp.js', () => ({
  installGithubMcpServer: mocks.installGithubMcpServer,
}));
vi.mock('../src/kiro/agent.js', () => ({
  GENERATED_AGENT_NAME: 'kiro-review-action',
  writeAgentConfig: mocks.writeAgentConfig,
}));
vi.mock('../src/kiro/env.js', () => ({ buildKiroEnv: mocks.buildKiroEnv }));
vi.mock('../src/kiro/runner.js', () => ({ runKiro: mocks.runKiro }));
vi.mock('../src/prompt.js', () => ({ buildPrompt: mocks.buildPrompt }));
vi.mock('../src/state.js', () => ({
  saveKiroPid: mocks.saveKiroPid,
  clearKiroPid: mocks.clearKiroPid,
}));

import { prepareRuntime, runReview } from '../src/runtime.js';
import { createKiroRunResult } from './helpers/run-result.js';

const inputs = createActionInputs({
  agent: 'reviewer',
  model: 'model-id',
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RUNNER_TEMP = '/runner/temp';
  process.env.GITHUB_ACTION_PATH = '/action';
  mocks.installKiroCli.mockResolvedValue('/bin/kiro');
  mocks.installGithubMcpServer.mockResolvedValue('/bin/github-mcp-server');
});

describe('prepareRuntime', () => {
  it('rejects a missing RUNNER_TEMP before starting either installer', async () => {
    delete process.env.RUNNER_TEMP;

    await expect(prepareRuntime(inputs)).rejects.toThrow('RUNNER_TEMP is not defined');

    expect(mocks.installKiroCli).not.toHaveBeenCalled();
    expect(mocks.installGithubMcpServer).not.toHaveBeenCalled();
  });

  it('starts both tool-cache installers before either resolves', async () => {
    const kiro = Promise.withResolvers<string>();
    const mcp = Promise.withResolvers<string>();
    mocks.installKiroCli.mockReturnValue(kiro.promise);
    mocks.installGithubMcpServer.mockReturnValue(mcp.promise);

    const preparing = prepareRuntime(inputs);

    expect(mocks.installKiroCli).toHaveBeenCalledWith(inputs.kiroCliVersion);
    expect(mocks.installGithubMcpServer).toHaveBeenCalledWith(inputs.githubMcpVersion);

    kiro.resolve('/bin/kiro');
    mcp.resolve('/bin/github-mcp-server');
    await preparing;
  });

  it('writes the agent with the resolved MCP binary and runner paths', async () => {
    await prepareRuntime(inputs);

    expect(mocks.writeAgentConfig).toHaveBeenCalledWith({
      workspace: process.cwd(),
      actionPath: '/action',
      kiroHome: join('/runner/temp', 'kiro-review', 'kiro-home'),
      agent: inputs.agent,
      model: inputs.model,
      mcpServerBinary: '/bin/github-mcp-server',
    });
  });

  it("uses '.' when GITHUB_ACTION_PATH is absent", async () => {
    delete process.env.GITHUB_ACTION_PATH;

    await prepareRuntime(inputs);

    expect(mocks.writeAgentConfig).toHaveBeenCalledWith(
      expect.objectContaining({ actionPath: '.' }),
    );
  });

  it('returns the binaries and public runner layout', async () => {
    await expect(prepareRuntime(inputs)).resolves.toEqual({
      kiroBinary: '/bin/kiro',
      workspace: process.cwd(),
      kiroHome: join('/runner/temp', 'kiro-review', 'kiro-home'),
      actionPath: '/action',
    });
  });

  it('propagates installer failures without writing the agent', async () => {
    const failure = new Error('install failed');
    mocks.installKiroCli.mockRejectedValue(failure);

    await expect(prepareRuntime(inputs)).rejects.toBe(failure);

    expect(mocks.writeAgentConfig).not.toHaveBeenCalled();
  });
});

describe('runReview', () => {
  const reviewMode = { kind: 'pull_request', target: createPullRequestTarget() } as const;
  const reviewRuntime = {
    kiroBinary: '/bin/kiro',
    workspace: '/workspace',
    kiroHome: '/kiro-home',
    actionPath: '/action',
  };

  beforeEach(() => {
    mocks.buildPrompt.mockReturnValue('built prompt');
    mocks.buildKiroEnv.mockReturnValue({ KIRO_API_KEY: 'key' });
    mocks.runKiro.mockResolvedValue(createKiroRunResult());
  });

  it('builds the prompt and environment and runs Kiro with runtime options', async () => {
    await runReview(reviewRuntime, inputs, reviewMode);

    expect(mocks.buildPrompt).toHaveBeenCalledWith(
      reviewMode,
      reviewRuntime.actionPath,
      inputs.maxDiffSize,
    );
    expect(mocks.buildKiroEnv).toHaveBeenCalledWith(process.env, {
      kiroApiKey: inputs.kiroApiKey,
      githubToken: inputs.githubToken,
      kiroHome: reviewRuntime.kiroHome,
      kiroBinDir: dirname(reviewRuntime.kiroBinary),
    });
    expect(mocks.runKiro).toHaveBeenCalledWith({
      kiroBinary: reviewRuntime.kiroBinary,
      agentName: 'kiro-review-action',
      prompt: 'built prompt',
      cwd: reviewRuntime.workspace,
      env: { KIRO_API_KEY: 'key' },
      timeoutMs: 600_000,
      debug: inputs.debug,
      onSpawn: mocks.saveKiroPid,
    });
    expect(mocks.clearKiroPid).toHaveBeenCalledOnce();
  });

  it('clears saved PID state when Kiro rejects', async () => {
    const failure = new Error('spawn ENOENT /missing/kiro');
    mocks.runKiro.mockRejectedValue(failure);

    await expect(runReview(reviewRuntime, inputs, reviewMode)).rejects.toBe(failure);

    expect(mocks.clearKiroPid).toHaveBeenCalledOnce();
  });
});
