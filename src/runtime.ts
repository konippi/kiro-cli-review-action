import { dirname, join } from 'node:path';
import type { ActionInputs } from './inputs.js';
import { writeAgentConfig } from './kiro/agent.js';
import { GENERATED_AGENT_NAME } from './kiro/agent-loader.js';
import { buildKiroEnv } from './kiro/env.js';
import { type KiroRunResult, runKiro } from './kiro/runner.js';
import { writeKiroSettings } from './kiro/settings.js';
import { buildPrompt } from './prompt.js';
import type { ReviewMode } from './review-mode.js';
import { installGithubMcpServer } from './setup/github-mcp.js';
import { installKiroCli } from './setup/kiro-cli.js';
import { clearKiroPid, saveKiroPid } from './state.js';

/** Everything a review run needs on disk: binaries, generated agent, and directory layout. */
export interface Runtime {
  readonly kiroBinary: string;
  readonly workspace: string;
  readonly kiroHome: string;
  readonly actionPath: string;
}

/** Resolves the runner layout, installs Kiro and the MCP server, and writes the review agent. */
export async function prepareRuntime(inputs: ActionInputs): Promise<Runtime> {
  const workspace = process.cwd();
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp) throw new Error('RUNNER_TEMP is not defined');

  const kiroHome = join(runnerTemp, 'kiro-review', 'kiro-home');
  const actionPath = process.env.GITHUB_ACTION_PATH || '.';

  const [kiroBinary, mcpBinary] = await Promise.all([
    installKiroCli(inputs.kiroCliVersion),
    installGithubMcpServer(inputs.githubMcpVersion),
  ]);

  writeAgentConfig({
    workspace,
    actionPath,
    kiroHome,
    agent: inputs.agent,
    model: inputs.model,
    mcpServerBinary: mcpBinary,
  });
  writeKiroSettings(kiroHome);

  return { kiroBinary, workspace, kiroHome, actionPath };
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
      prompt: buildPrompt(mode, runtime.actionPath, inputs.maxDiffSize),
      cwd: runtime.workspace,
      env: buildKiroEnv(process.env, {
        kiroApiKey: inputs.kiroApiKey,
        githubToken: inputs.githubToken,
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
