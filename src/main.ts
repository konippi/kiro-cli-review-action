import { parseCommentContext, parseEventContext } from './context.js';
import { toErrorMessage } from './errors.js';
import { parseInputs } from './inputs.js';
import { reportConclusion, reportRun } from './report.js';
import { prepareWorkspace } from './restore-config.js';
import { resolveReviewMode, reviewTarget } from './review-mode.js';
import { prepareRuntime, runReview } from './runtime.js';

async function review(): Promise<void> {
  const event = parseEventContext();
  if (event?.isFork) {
    reportConclusion('skipped', 'Fork PR detected — KIRO_API_KEY is unavailable. Skipping review.');
    return;
  }

  const inputs = parseInputs();
  const mode = await resolveReviewMode(inputs, event, parseCommentContext(inputs.triggerPhrase));
  if (!mode) {
    reportConclusion('skipped', 'No matching trigger — skipping.');
    return;
  }

  const target = reviewTarget(mode, event);
  if (target !== null) await prepareWorkspace(target, inputs.githubToken);

  const runtime = await prepareRuntime(inputs);
  reportRun(await runReview(runtime, inputs, mode));
}

/** Runs the review action and reports unexpected failures. */
export async function run(): Promise<void> {
  try {
    await review();
  } catch (error: unknown) {
    reportConclusion('setup_error', toErrorMessage(error));
  }
}
