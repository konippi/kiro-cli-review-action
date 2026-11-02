import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPullRequestTarget } from './helpers/context.js';
import { createActionInputs } from './helpers/inputs.js';
import { createKiroRunResult } from './helpers/run-result.js';
import { createTemporaryDirectory } from './helpers/temporary-directory.js';

const mocks = vi.hoisted(() => {
  const calls: string[] = [];

  return {
    calls,
    parseEventContext: vi.fn(),
    parseCommentContext: vi.fn(),
    parseInputs: vi.fn(),
    resolveReviewMode: vi.fn(),
    reviewTarget: vi.fn(),
    prepareWorkspace: vi.fn(),
    prepareRuntime: vi.fn(),
    runReview: vi.fn(),
    summarizeRun: vi.fn(),
    readReviewProposal: vi.fn(),
    publishReview: vi.fn(),
    reportConclusion: vi.fn(),
  };
});

vi.mock('../src/context.js', () => ({
  parseEventContext: mocks.parseEventContext,
  parseCommentContext: mocks.parseCommentContext,
}));
vi.mock('../src/inputs.js', () => ({ parseInputs: mocks.parseInputs }));
vi.mock('../src/review-mode.js', () => ({
  resolveReviewMode: mocks.resolveReviewMode,
  reviewTarget: mocks.reviewTarget,
}));
vi.mock('../src/restore-config.js', () => ({ prepareWorkspace: mocks.prepareWorkspace }));
vi.mock('../src/runtime.js', () => ({
  prepareRuntime: mocks.prepareRuntime,
  runReview: mocks.runReview,
}));
vi.mock('../src/report.js', () => ({
  summarizeRun: mocks.summarizeRun,
  reportConclusion: mocks.reportConclusion,
}));
vi.mock('../src/review/proposal.js', () => ({ readReviewProposal: mocks.readReviewProposal }));
vi.mock('../src/review/publish.js', () => ({ publishReview: mocks.publishReview }));

const target = createPullRequestTarget();
const inputs = createActionInputs();
const mode = { kind: 'pull_request', target } as const;
const comment = {
  owner: 'test-owner',
  repo: 'test-repo',
  prNumber: 42,
  commentId: 7,
  commenterLogin: 'reviewer',
  userRequest: null,
};
const actionPath = '/action';
const reviewInput = { pullRequest: {}, files: [] };
const proposal = { summary: 'Summary', findings: [] };
const successfulRun = createKiroRunResult();

let directory: string;

async function runMain(): Promise<void> {
  const { run } = await import('../src/main.js');
  await run(actionPath);
}

beforeEach(() => {
  vi.resetModules();
  mocks.calls.length = 0;
  directory = createTemporaryDirectory();
  writeFileSync(join(directory, 'proposal.json'), '{}');

  mocks.parseEventContext.mockImplementation(() => {
    mocks.calls.push('parse-event');
    return target;
  });
  mocks.parseInputs.mockImplementation(() => {
    mocks.calls.push('parse-inputs');
    return inputs;
  });
  mocks.parseCommentContext.mockImplementation(() => {
    mocks.calls.push('parse-comment');
    return comment;
  });
  mocks.resolveReviewMode.mockImplementation(async () => {
    mocks.calls.push('resolve-mode');
    return mode;
  });
  mocks.reviewTarget.mockImplementation(() => {
    mocks.calls.push('review-target');
    return target;
  });
  mocks.prepareWorkspace.mockImplementation(async () => {
    mocks.calls.push('prepare-workspace');
  });
  mocks.prepareRuntime.mockImplementation(async (_inputs, _actionPath, reviewed) => {
    mocks.calls.push('prepare-runtime');
    return {
      kiroBinary: '/kiro',
      workspace: process.cwd(),
      kiroHome: '/tmp/kiro-review/kiro-home',
      actionPath,
      review: reviewed === null ? null : { target: reviewed, directory, input: reviewInput },
    };
  });
  mocks.runReview.mockImplementation(async () => {
    mocks.calls.push('run-review');
    return successfulRun;
  });
  mocks.summarizeRun.mockImplementation(() => {
    mocks.calls.push('summarize-run');
    return { conclusion: 'success', message: 'Kiro review completed successfully' };
  });
  mocks.readReviewProposal.mockReturnValue(proposal);
  mocks.publishReview.mockImplementation(async () => {
    mocks.calls.push('publish-review');
    return { reviewId: 7, inlineFindings: 1, bodyFindings: 2 };
  });
  mocks.reportConclusion.mockImplementation(() => {
    mocks.calls.push('report-conclusion');
  });
});

describe('headless review orchestration', () => {
  it('resolves, prepares, runs, publishes, and reports in order', async () => {
    await runMain();

    expect(mocks.calls).toEqual([
      'parse-event',
      'parse-inputs',
      'parse-comment',
      'resolve-mode',
      'review-target',
      'prepare-workspace',
      'prepare-runtime',
      'run-review',
      'summarize-run',
      'publish-review',
      'report-conclusion',
    ]);
    expect(mocks.parseCommentContext).toHaveBeenCalledWith(inputs.triggerPhrase);
    expect(mocks.resolveReviewMode).toHaveBeenCalledWith(inputs, target, comment);
    expect(mocks.reviewTarget).toHaveBeenCalledWith(mode, target);
    expect(mocks.prepareWorkspace).toHaveBeenCalledWith(target, inputs.githubToken);
    expect(mocks.prepareRuntime).toHaveBeenCalledWith(inputs, actionPath, target);
    expect(mocks.summarizeRun).toHaveBeenCalledWith(successfulRun);
    expect(mocks.readReviewProposal).toHaveBeenCalledWith(join(directory, 'proposal.json'));
    expect(mocks.publishReview).toHaveBeenCalledWith(
      target,
      inputs.githubToken,
      reviewInput,
      proposal,
    );
    expect(mocks.reportConclusion).toHaveBeenCalledWith(
      'success',
      'Posted review 7 with 1 inline and 2 body findings',
    );
  });

  it('reports a prompt run without preparing or publishing a review', async () => {
    const promptMode = { kind: 'prompt', prompt: 'Explain the parser.' };
    mocks.resolveReviewMode.mockResolvedValue(promptMode);

    await runMain();

    expect(mocks.prepareRuntime).toHaveBeenCalledWith(inputs, actionPath, null);
    expect(mocks.publishReview).not.toHaveBeenCalled();
    expect(mocks.reportConclusion).toHaveBeenCalledWith(
      'success',
      'Kiro review completed successfully',
    );
  });

  it('publishes nothing when Kiro does not succeed', async () => {
    mocks.summarizeRun.mockReturnValue({
      conclusion: 'timed_out',
      message: 'Kiro review timed out',
    });

    await runMain();

    expect(mocks.publishReview).not.toHaveBeenCalled();
    expect(mocks.reportConclusion).toHaveBeenCalledWith('timed_out', 'Kiro review timed out');
  });

  it('reports an incomplete review when Kiro never submitted one', async () => {
    directory = createTemporaryDirectory();

    await runMain();

    expect(mocks.publishReview).not.toHaveBeenCalled();
    expect(mocks.reportConclusion).toHaveBeenCalledWith(
      'incomplete',
      'Kiro finished without submitting a review',
    );
  });

  it('reports publish_error when posting the review fails', async () => {
    mocks.publishReview.mockRejectedValue(new Error('Resource not accessible by integration'));

    await runMain();

    expect(mocks.reportConclusion).toHaveBeenCalledWith(
      'publish_error',
      'Posting the review failed: Resource not accessible by integration',
    );
  });

  it('skips forks before parsing required inputs', async () => {
    mocks.parseEventContext.mockReturnValue({ ...target, isFork: true });

    await runMain();

    expect(mocks.parseInputs).not.toHaveBeenCalled();
    expect(mocks.reportConclusion).toHaveBeenCalledWith(
      'skipped',
      'Fork PR detected — KIRO_API_KEY is unavailable. Skipping review.',
    );
  });

  it('skips when no mode matches', async () => {
    mocks.parseEventContext.mockReturnValue(null);
    mocks.resolveReviewMode.mockResolvedValue(null);

    await runMain();

    expect(mocks.reviewTarget).not.toHaveBeenCalled();
    expect(mocks.prepareRuntime).not.toHaveBeenCalled();
    expect(mocks.reportConclusion).toHaveBeenCalledWith(
      'skipped',
      'No matching trigger — skipping.',
    );
  });

  it('prepares the workspace with the resolved review target', async () => {
    const resolvedTarget = createPullRequestTarget({ baseBranch: 'resolved-base' });
    mocks.reviewTarget.mockReturnValue(resolvedTarget);

    await runMain();

    expect(mocks.prepareWorkspace).toHaveBeenCalledWith(resolvedTarget, inputs.githubToken);
  });

  it('does not prepare the workspace when the review has no target', async () => {
    mocks.reviewTarget.mockReturnValue(null);

    await runMain();

    expect(mocks.prepareWorkspace).not.toHaveBeenCalled();
  });

  it('maps unexpected errors to setup_error', async () => {
    mocks.prepareWorkspace.mockRejectedValue(new Error('checkout failed'));

    await runMain();

    expect(mocks.prepareRuntime).not.toHaveBeenCalled();
    expect(mocks.reportConclusion).toHaveBeenCalledWith('setup_error', 'checkout failed');
  });
});
