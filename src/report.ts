import * as core from '@actions/core';
import { type Conclusion, concludeRun } from './kiro/conclusion.js';
import type { KiroRunResult } from './kiro/runner.js';

type ActionConclusion = Conclusion | 'skipped' | 'setup_error';

/** Reports the action conclusion and fails unsuccessful, non-skipped runs. */
export function reportConclusion(conclusion: ActionConclusion, message: string): void {
  core.setOutput('conclusion', conclusion);
  if (conclusion === 'skipped') core.info(message);
  if (conclusion !== 'success' && conclusion !== 'skipped') core.setFailed(message);
}

/** Logs a Kiro run summary and reports its conclusion. */
export function reportRun(result: KiroRunResult): void {
  if (result.sessionId) core.info(`[kiro] Session: ${JSON.stringify(result.sessionId)}`);
  core.info(
    `Kiro summary: tool calls=${result.toolCalls.length}, failed tool calls=${result.failedToolCalls}, credits=${result.credits}`,
  );
  const { conclusion, message } = concludeRun(result);
  reportConclusion(conclusion, message);
}
