import { existsSync } from 'node:fs';
import { parseCommentContext, parseEventContext } from './context.js';
import { toErrorMessage } from './errors.js';
import { parseInputs } from './inputs.js';
import { reportConclusion, summarizeRun } from './report.js';
import { prepareWorkspace } from './restore-config.js';
import { reviewWorkspacePaths } from './review/input.js';
import { readReviewProposal } from './review/proposal.js';
import { publishReview } from './review/publish.js';
import { resolveReviewMode, reviewTarget } from './review-mode.js';
import { prepareRuntime, type ReviewSession, runReview } from './runtime.js';

async function publish(review: ReviewSession, token: string): Promise<void> {
  const { proposal } = reviewWorkspacePaths(review.directory);
  if (!existsSync(proposal)) {
    reportConclusion('incomplete', 'Kiro finished without submitting a review');
    return;
  }

  try {
    const published = await publishReview(
      review.target,
      token,
      review.input,
      readReviewProposal(proposal),
    );
    reportConclusion(
      'success',
      `Posted review ${published.reviewId} with ${published.inlineFindings} inline and ${published.bodyFindings} body findings`,
    );
  } catch (error: unknown) {
    reportConclusion('publish_error', `Posting the review failed: ${toErrorMessage(error)}`);
  }
}

async function review(actionPath: string): Promise<void> {
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

  const runtime = await prepareRuntime(
    inputs,
    actionPath,
    mode.kind === 'prompt' ? null : mode.target,
  );
  const run = summarizeRun(await runReview(runtime, inputs, mode));
  if (runtime.review === null || run.conclusion !== 'success') {
    reportConclusion(run.conclusion, run.message);
    return;
  }

  await publish(runtime.review, inputs.githubToken);
}

/** Runs the review action and reports unexpected failures. */
export async function run(actionPath: string): Promise<void> {
  try {
    await review(actionPath);
  } catch (error: unknown) {
    reportConclusion('setup_error', toErrorMessage(error));
  }
}
