import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@actions/core';
import { AcpClient } from './acp-client.js';
import { parseEventContext, parseInputs } from './context.js';
import { restoreConfigFromBase } from './security.js';
import { installGithubMcpServer, installKiroCli } from './setup.js';
import type { EventContext } from './types.js';

async function run(): Promise<void> {
  const inputs = parseInputs();
  core.setSecret(inputs.kiroApiKey);
  if (inputs.githubToken) core.setSecret(inputs.githubToken);

  const event = parseEventContext();

  // Determine mode
  if (!inputs.prompt && !event) {
    throw new Error('Either "prompt" input or a pull_request event is required');
  }

  if (event) {
    core.info(`Reviewing PR #${event.prNumber} in ${event.owner}/${event.repo}`);
    if (event.isFork) {
      core.warning('Fork PR detected — KIRO_API_KEY is unavailable. Skipping review.');
      core.setOutput('review_result', 'skip');
      core.setOutput('exit_code', '0');
      return;
    }
    restoreConfigFromBase(event.baseBranch);
  }

  // Install binaries
  const installDir = join(process.env.RUNNER_TEMP || '/tmp', 'kiro-review');
  const [kiroBinary, mcpBinary] = await Promise.all([
    installKiroCli(),
    installGithubMcpServer(inputs.githubMcpVersion, installDir),
  ]);

  // ACP session
  const acp = new AcpClient(kiroBinary, inputs.debug, inputs.kiroApiKey);
  core.saveState('acp_pid', '');

  try {
    await acp.start();
    if (acp.process?.pid) {
      core.saveState('acp_pid', String(acp.process.pid));
    }

    await acp.initialize();
    const actionPath = process.env.GITHUB_ACTION_PATH || '.';

    // Copy bundled agent if needed
    const agentName = inputs.agent || 'code-reviewer';
    if (!inputs.agent) {
      const agentDir = join('.kiro', 'agents');
      const dest = join(agentDir, 'code-reviewer.json');
      if (!existsSync(dest)) {
        mkdirSync(agentDir, { recursive: true });
        copyFileSync(join(actionPath, 'agents', 'code-reviewer.json'), dest);
      }
    }

    const sessionId = await acp.createSession(agentName, mcpBinary, inputs.githubToken);
    core.info(`ACP session created: ${sessionId}`);

    // Build prompt based on mode
    const prompt = inputs.prompt || buildReviewPrompt(event, actionPath, inputs.maxDiffSize);
    await acp.prompt(sessionId, prompt);

    const timeoutMs = inputs.timeoutMinutes * 60_000;
    const result = await acp.waitForTurnEnd(timeoutMs, sessionId);

    core.info(`Complete. Tool calls: ${result.toolCalls.length}`);
    core.setOutput('review_result', result.success ? 'pass' : 'fail');
    core.setOutput('exit_code', '0');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
    core.setOutput('review_result', 'fail');
    core.setOutput('exit_code', '1');
  } finally {
    acp.kill();
  }
}

function buildReviewPrompt(
  event: EventContext | null,
  actionPath: string,
  maxDiffSize: number,
): string {
  if (!event) throw new Error('PR context is required for review mode');

  let systemPrompt = '';
  try {
    systemPrompt = readFileSync(join(actionPath, 'prompts', 'review.md'), 'utf-8');
  } catch {
    systemPrompt = 'You are an expert code reviewer. Focus on bugs, security, and maintainability.';
  }

  return [
    systemPrompt,
    '',
    `Review pull request #${event.prNumber} in ${event.owner}/${event.repo}.`,
    `Use pull_request_read to get the diff (max ${maxDiffSize} chars).`,
    'Analyze the changes, then submit a review with inline comments using pull_request_review_write and add_comment_to_pending_review.',
  ].join('\n');
}

export default run().catch((error: unknown) => {
  core.setFailed(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
});
