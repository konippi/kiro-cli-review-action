import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PullRequestTarget } from './context.js';
import { writeJsonFile } from './fs.js';
import type { ActionInputs } from './inputs.js';
import { writeAgentConfig } from './kiro/agent.js';
import { GENERATED_AGENT_NAME } from './kiro/agent-loader.js';
import { buildKiroEnv } from './kiro/env.js';
import { type KiroRunResult, runKiro } from './kiro/runner.js';
import { writeKiroSettings } from './kiro/settings.js';
import { buildPrompt } from './prompt.js';
import { type ReviewInput, reviewWorkspacePaths } from './review/input.js';
import { fetchReviewInput } from './review/pull-request.js';
import type { ReviewMode } from './review-mode.js';
import { installKiroCli } from './setup/kiro-cli.js';
import { clearKiroPid, saveKiroPid } from './state.js';

/** Pull request under review and the directory its recorder shares with the action. */
export interface ReviewSession {
  readonly target: PullRequestTarget;
  readonly directory: string;
  readonly input: ReviewInput;
}

/** Everything a review run needs on disk: binaries, generated agent, and directory layout. */
export interface Runtime {
  readonly kiroBinary: string;
  readonly workspace: string;
  readonly kiroHome: string;
  readonly actionPath: string;
  readonly review: ReviewSession | null;
}

async function prepareReview(
  target: PullRequestTarget,
  token: string,
  directory: string,
): Promise<ReviewSession> {
  const input = await fetchReviewInput(target, token);
  rmSync(directory, { recursive: true, force: true });
  writeJsonFile(reviewWorkspacePaths(directory).input, input);
  return { target, directory, input };
}

/** Resolves the runner layout, installs Kiro, prepares the review, and writes the agent. */
export async function prepareRuntime(
  inputs: ActionInputs,
  actionPath: string,
  target: PullRequestTarget | null,
): Promise<Runtime> {
  const workspace = process.cwd();
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp) throw new Error('RUNNER_TEMP is not defined');

  const kiroHome = join(runnerTemp, 'kiro-review', 'kiro-home');
  const reviewDirectory = join(runnerTemp, 'kiro-review', 'review');

  const [kiroBinary, review] = await Promise.all([
    installKiroCli(inputs.kiroCliVersion),
    target === null ? null : prepareReview(target, inputs.githubToken, reviewDirectory),
  ]);

  writeAgentConfig({
    workspace,
    actionPath,
    kiroHome,
    agent: inputs.agent,
    model: inputs.model,
    reviewServer:
      review === null
        ? null
        : {
            command: process.execPath,
            args: [join(actionPath, 'dist', 'mcp', 'index.cjs'), '--directory', review.directory],
          },
  });
  writeKiroSettings(kiroHome);

  return { kiroBinary, workspace, kiroHome, actionPath, review };
}

/** Runs a review with the prepared runtime and always clears saved process state. */
export async function runReview(
  runtime: Runtime,
  inputs: ActionInputs,
  mode: ReviewMode,
): Promise<KiroRunResult> {
  try {
    return await runKiro({
      kiroBinary: runtime.kiroBinary,
      agentName: GENERATED_AGENT_NAME,
      prompt: buildPrompt(mode, runtime.actionPath),
      cwd: runtime.workspace,
      env: buildKiroEnv(process.env, {
        kiroApiKey: inputs.kiroApiKey,
        kiroHome: runtime.kiroHome,
        kiroBinDir: dirname(runtime.kiroBinary),
      }),
      timeoutMs: inputs.timeoutMinutes * 60_000,
      debug: inputs.debug,
      onSpawn: saveKiroPid,
    });
  } finally {
    clearKiroPid();
  }
}
