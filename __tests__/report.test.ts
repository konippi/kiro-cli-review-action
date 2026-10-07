import * as core from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportConclusion, reportRun } from '../src/report.js';
import { createKiroRunResult } from './helpers/run-result.js';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('action result reporting', () => {
  it.each(['skipped', 'success'] as const)('reports %s without failing the job', (conclusion) => {
    reportConclusion(conclusion, 'completed');

    expect(core.setOutput).toHaveBeenCalledOnce();
    expect(core.setOutput).toHaveBeenCalledWith('conclusion', conclusion);
    expect(core.setFailed).not.toHaveBeenCalled();
    if (conclusion === 'skipped') expect(core.info).toHaveBeenCalledWith('completed');
    else expect(core.info).not.toHaveBeenCalled();
  });

  it('reports a failed run with its conclusion and message', () => {
    reportConclusion('run_error', 'Kiro failed');

    expect(core.setOutput).toHaveBeenCalledOnce();
    expect(core.setOutput).toHaveBeenCalledWith('conclusion', 'run_error');
    expect(core.setFailed).toHaveBeenCalledOnce();
    expect(core.setFailed).toHaveBeenCalledWith('Kiro failed');
  });

  it('JSON-encodes a session ID, logs the summary, and reports the result', () => {
    reportRun(
      createKiroRunResult({
        sessionId: 'safe\n::add-mask::x',
        toolCalls: ['read'],
        credits: 1,
        terminal: { kind: 'finished', status: 'success', stopReason: 'end_turn' },
      }),
    );

    expect(core.info).toHaveBeenNthCalledWith(1, '[kiro] Session: "safe\\n::add-mask::x"');
    expect(core.info).toHaveBeenNthCalledWith(
      2,
      'Kiro summary: tool calls=1, failed tool calls=0, credits=1',
    );
    expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining('\n::add-mask::x'));
    expect(core.setOutput).toHaveBeenCalledWith('conclusion', 'success');
  });

  it('does not log an absent session ID', () => {
    reportRun(createKiroRunResult());

    expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining('[kiro] Session:'));
  });
});
