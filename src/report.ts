import * as core from '@actions/core';
import { type Conclusion, concludeRun, type RunConclusion } from './kiro/conclusion.js';
import type { KiroRunResult } from './kiro/runner.js';

type ActionConclusion = Conclusion | 'skipped' | 'publish_error' | 'setup_error';

/** Reports the action conclusion and fails unsuccessful, non-skipped runs. */
export function reportConclusion(conclusion: ActionConclusion, message: string): void {
  core.setOutput('conclusion', conclusion);
  if (conclusion === 'success' || conclusion === 'skipped') core.info(message);
  else core.setFailed(message);
}

/** Logs a Kiro run summary and returns its conclusion. */
export function summarizeRun(result: KiroRunResult): RunConclusion {
  if (result.sessionId) core.info(`[kiro] Session: ${JSON.stringify(result.sessionId)}`);
  core.info(
    `Kiro summary: tool calls=${result.toolCalls.length}, failed tool calls=${result.failedToolCalls}, credits=${result.credits}`,
  );
  return concludeRun(result);
}
