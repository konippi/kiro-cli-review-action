import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPullRequestTarget } from './helpers/context.js';
import { createActionInputs } from './helpers/inputs.js';
import { createKiroRunResult } from './helpers/run-result.js';

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
    reportRun: vi.fn(),
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
  reportRun: mocks.reportRun,
  reportConclusion: mocks.reportConclusion,
}));

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
const runtime = {
  kiroBinary: '/kiro',
  workspace: process.cwd(),
  kiroHome: '/tmp/kiro-review/kiro-home',
  actionPath: '.',
};
const successfulRun = createKiroRunResult();

async function runMain(): Promise<void> {
  const { run } = await import('../src/main.js');
  await run();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.calls.length = 0;
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
  mocks.prepareRuntime.mockImplementation(async () => {
    mocks.calls.push('prepare-runtime');
    return runtime;
  });
  mocks.runReview.mockImplementation(async () => {
    mocks.calls.push('run-review');
    return successfulRun;
  });
  mocks.reportRun.mockImplementation(() => {
    mocks.calls.push('report-run');
  });
  mocks.reportConclusion.mockImplementation(() => {
    mocks.calls.push('report-conclusion');
  });
});

describe('headless review orchestration', () => {
  it('resolves, prepares, runs, and reports in order', async () => {
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
      'report-run',
    ]);
    expect(mocks.parseCommentContext).toHaveBeenCalledWith(inputs.triggerPhrase);
    expect(mocks.resolveReviewMode).toHaveBeenCalledWith(inputs, target, comment);
    expect(mocks.reviewTarget).toHaveBeenCalledWith(mode, target);
    expect(mocks.prepareWorkspace).toHaveBeenCalledWith(target, inputs.githubToken);
    expect(mocks.prepareRuntime).toHaveBeenCalledWith(inputs);
    expect(mocks.runReview).toHaveBeenCalledWith(runtime, inputs, mode);
    expect(mocks.reportRun).toHaveBeenCalledWith(successfulRun);
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
    expect(mocks.prepareRuntime).toHaveBeenCalledWith(inputs);
  });

  it('maps unexpected errors to setup_error', async () => {
    mocks.prepareWorkspace.mockRejectedValue(new Error('checkout failed'));

    await runMain();

    expect(mocks.prepareRuntime).not.toHaveBeenCalled();
    expect(mocks.reportConclusion).toHaveBeenCalledWith('setup_error', 'checkout failed');
  });
});
