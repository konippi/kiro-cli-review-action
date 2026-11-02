import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPullRequestTarget } from './helpers/context.js';
import { createActionInputs } from './helpers/inputs.js';
import { createTemporaryDirectory } from './helpers/temporary-directory.js';

const mocks = vi.hoisted(() => ({
  installKiroCli: vi.fn(),
  fetchReviewInput: vi.fn(),
  writeAgentConfig: vi.fn(),
  writeKiroSettings: vi.fn(),
  buildKiroEnv: vi.fn(),
  buildPrompt: vi.fn(),
  runKiro: vi.fn(),
  saveKiroPid: vi.fn(),
  clearKiroPid: vi.fn(),
}));

vi.mock('../src/setup/kiro-cli.js', () => ({
  installKiroCli: mocks.installKiroCli,
}));
vi.mock('../src/review/pull-request.js', () => ({
  fetchReviewInput: mocks.fetchReviewInput,
}));
vi.mock('../src/kiro/agent-loader.js', () => ({
  GENERATED_AGENT_NAME: 'kiro-review-action',
}));
vi.mock('../src/kiro/agent.js', () => ({
  writeAgentConfig: mocks.writeAgentConfig,
}));
vi.mock('../src/kiro/settings.js', () => ({ writeKiroSettings: mocks.writeKiroSettings }));
vi.mock('../src/kiro/env.js', () => ({ buildKiroEnv: mocks.buildKiroEnv }));
vi.mock('../src/kiro/runner.js', () => ({ runKiro: mocks.runKiro }));
vi.mock('../src/prompt.js', () => ({ buildPrompt: mocks.buildPrompt }));
vi.mock('../src/state.js', () => ({
  saveKiroPid: mocks.saveKiroPid,
  clearKiroPid: mocks.clearKiroPid,
}));

import { prepareRuntime, runReview } from '../src/runtime.js';
import { createKiroRunResult } from './helpers/run-result.js';

const actionPath = '/action';
const target = createPullRequestTarget();
const inputs = createActionInputs({
  agent: 'reviewer',
  model: 'model-id',
});
const reviewInput = { pullRequest: { number: 42 }, files: [] };

let runnerTemp: string;

beforeEach(() => {
  runnerTemp = createTemporaryDirectory();
  vi.stubEnv('RUNNER_TEMP', runnerTemp);
  mocks.installKiroCli.mockResolvedValue('/bin/kiro');
  mocks.fetchReviewInput.mockResolvedValue(reviewInput);
});

describe('prepareRuntime', () => {
  it('rejects a missing RUNNER_TEMP before installing Kiro or fetching the pull request', async () => {
    vi.stubEnv('RUNNER_TEMP', '');

    await expect(prepareRuntime(inputs, actionPath, target)).rejects.toThrow(
      'RUNNER_TEMP is not defined',
    );

    expect(mocks.installKiroCli).not.toHaveBeenCalled();
    expect(mocks.fetchReviewInput).not.toHaveBeenCalled();
  });

  it('writes the agent and settings without a review server in prompt mode', async () => {
    const runtime = await prepareRuntime(inputs, actionPath, null);

    const kiroHome = join(runnerTemp, 'kiro-review', 'kiro-home');
    expect(mocks.fetchReviewInput).not.toHaveBeenCalled();
    expect(mocks.writeAgentConfig).toHaveBeenCalledWith({
      workspace: process.cwd(),
      actionPath,
      kiroHome,
      agent: inputs.agent,
      model: inputs.model,
      reviewServer: null,
    });
    expect(mocks.writeKiroSettings).toHaveBeenCalledWith(kiroHome);
    expect(runtime).toEqual({
      kiroBinary: '/bin/kiro',
      workspace: process.cwd(),
      kiroHome,
      actionPath,
      review: null,
    });
  });

  it('fetches the pull request while installing Kiro and starts the recorder on a fresh directory', async () => {
    const directory = join(runnerTemp, 'kiro-review', 'review');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'proposal.json'), '{}');
    const kiro = Promise.withResolvers<string>();
    mocks.installKiroCli.mockReturnValue(kiro.promise);

    const preparing = prepareRuntime(inputs, actionPath, target);

    expect(mocks.installKiroCli).toHaveBeenCalledWith(inputs.kiroCliVersion);
    expect(mocks.fetchReviewInput).toHaveBeenCalledWith(target, inputs.githubToken);
    kiro.resolve('/bin/kiro');
    const runtime = await preparing;

    expect(runtime.review).toEqual({ target, directory, input: reviewInput });
    expect(readdirSync(directory)).toEqual(['pull-request.json']);
    expect(JSON.parse(readFileSync(join(directory, 'pull-request.json'), 'utf8'))).toEqual(
      reviewInput,
    );
    expect(mocks.writeAgentConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewServer: {
          command: process.execPath,
          args: [join(actionPath, 'dist', 'mcp', 'index.cjs'), '--directory', directory],
        },
      }),
    );
  });

  it('propagates installer failures without writing runtime configuration', async () => {
    const failure = new Error('install failed');
    mocks.installKiroCli.mockRejectedValue(failure);

    await expect(prepareRuntime(inputs, actionPath, target)).rejects.toBe(failure);

    expect(mocks.writeAgentConfig).not.toHaveBeenCalled();
    expect(mocks.writeKiroSettings).not.toHaveBeenCalled();
  });
});

describe('runReview', () => {
  const reviewMode = { kind: 'pull_request', target } as const;
  const reviewRuntime = {
    kiroBinary: '/bin/kiro',
    workspace: '/workspace',
    kiroHome: '/kiro-home',
    actionPath,
    review: null,
  };

  beforeEach(() => {
    mocks.buildPrompt.mockReturnValue('built prompt');
    mocks.buildKiroEnv.mockReturnValue({ KIRO_API_KEY: 'key' });
    mocks.runKiro.mockResolvedValue(createKiroRunResult());
  });

  it('builds the prompt and environment and runs Kiro with runtime options', async () => {
    await runReview(reviewRuntime, inputs, reviewMode);

    expect(mocks.buildPrompt).toHaveBeenCalledWith(reviewMode, reviewRuntime.actionPath);
    expect(mocks.buildKiroEnv).toHaveBeenCalledWith(process.env, {
      kiroApiKey: inputs.kiroApiKey,
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
