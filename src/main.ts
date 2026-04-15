import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@actions/core';
import { AcpClient } from './acp-client.js';
import { parseCommentContext, parseEventContext, parseInputs } from './context.js';
import { restoreConfigFromBase } from './security.js';
import { installGithubMcpServer, installKiroCli } from './setup.js';

async function run(): Promise<void> {
  const inputs = parseInputs();
  core.setSecret(inputs.kiroApiKey);
  if (inputs.githubToken) core.setSecret(inputs.githubToken);

  // Determine mode: PR event, comment trigger, or direct prompt
  const event = parseEventContext();
  const comment = parseCommentContext(inputs.triggerPhrase);

  if (!inputs.prompt && !event && !comment) {
    core.info('No matching trigger — skipping.');
    core.setOutput('review_result', 'skip');
    core.setOutput('exit_code', '0');
    return;
  }

  // Derive PR info from event or comment context
  const prNumber = event?.prNumber ?? comment?.prNumber;
  const owner = event?.owner ?? comment?.owner ?? '';
  const repo = event?.repo ?? comment?.repo ?? '';

  if (event) {
    core.info(`Reviewing PR #${event.prNumber} in ${owner}/${repo}`);
    if (event.isFork) {
      core.warning('Fork PR detected — KIRO_API_KEY is unavailable. Skipping review.');
      core.setOutput('review_result', 'skip');
      core.setOutput('exit_code', '0');
      return;
    }
    restoreConfigFromBase(event.baseBranch);
  } else if (comment) {
    core.info(`Comment-triggered review for PR #${comment.prNumber} in ${owner}/${repo}`);
  }

  // Install binaries
  const installDir = join(process.env.RUNNER_TEMP || '/tmp', 'kiro-review');
  const [kiroBinary, mcpBinary] = await Promise.all([
    installKiroCli(),
    installGithubMcpServer(inputs.githubMcpVersion, installDir),
  ]);

  // Copy bundled agent if needed
  const actionPath = process.env.GITHUB_ACTION_PATH || '.';
  const agentName = inputs.agent || 'code-reviewer';
  if (!inputs.agent) {
    const agentDir = join('.kiro', 'agents');
    const dest = join(agentDir, 'code-reviewer.json');
    const needsWrite = !existsSync(dest) || inputs.model;
    if (needsWrite) {
      const source = existsSync(dest) ? dest : join(actionPath, 'agents', 'code-reviewer.json');
      mkdirSync(agentDir, { recursive: true });
      const config = JSON.parse(readFileSync(source, 'utf-8')) as Record<string, unknown>;
      if (inputs.model) config.model = inputs.model;
      writeFileSync(dest, JSON.stringify(config, null, 2));
    }
  } else if (inputs.model) {
    core.warning('model input is ignored when agent input is specified');
  }

  const acp = new AcpClient(kiroBinary, inputs.debug, inputs.kiroApiKey);

  try {
    await acp.start(agentName);
    if (acp.process?.pid) {
      core.saveState('acp_pid', String(acp.process.pid));
    }

    await acp.initialize();

    const sessionId = await acp.createSession(mcpBinary, inputs.githubToken);
    core.info(`ACP session created: ${sessionId}`);

    // Build prompt based on mode
    let promptText: string;
    if (inputs.prompt) {
      promptText = inputs.prompt;
    } else if (prNumber) {
      promptText = buildReviewPrompt({ owner, repo, prNumber }, actionPath, inputs.maxDiffSize);
    } else {
      throw new Error('No prompt or PR context available');
    }

    const result = await acp.prompt(sessionId, promptText);

    core.info(`Complete. Tool calls: ${result.toolCalls.length}`);
    core.setOutput('review_result', 'pass');
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
  pr: { owner: string; repo: string; prNumber: number },
  actionPath: string,
  maxDiffSize: number,
): string {
  let systemPrompt = '';
  try {
    systemPrompt = readFileSync(join(actionPath, 'prompts', 'review.md'), 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    systemPrompt = 'You are an expert code reviewer. Focus on bugs, security, and maintainability.';
  }

  return [
    systemPrompt,
    '',
    `Review pull request #${pr.prNumber} in ${pr.owner}/${pr.repo}.`,
    `Use pull_request_read to get the diff (max ${maxDiffSize} chars).`,
    'Analyze the changes, then submit a review with inline comments using pull_request_review_write and add_comment_to_pending_review.',
  ].join('\n');
}

export default run().catch((error: unknown) => {
  core.setFailed(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
});
