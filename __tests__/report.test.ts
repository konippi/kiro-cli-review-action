import * as core from '@actions/core';
import { describe, expect, it, vi } from 'vitest';
import { reportConclusion, summarizeRun } from '../src/report.js';
import { createKiroRunResult } from './helpers/run-result.js';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

describe('action result reporting', () => {
  it.each(['skipped', 'success'] as const)('reports %s without failing the job', (conclusion) => {
    reportConclusion(conclusion, 'completed');

    expect(core.setOutput).toHaveBeenCalledOnce();
    expect(core.setOutput).toHaveBeenCalledWith('conclusion', conclusion);
    expect(core.info).toHaveBeenCalledWith('completed');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('reports a failed run with its conclusion and message', () => {
    reportConclusion('run_error', 'Kiro failed');

    expect(core.setOutput).toHaveBeenCalledOnce();
    expect(core.setOutput).toHaveBeenCalledWith('conclusion', 'run_error');
    expect(core.setFailed).toHaveBeenCalledOnce();
    expect(core.setFailed).toHaveBeenCalledWith('Kiro failed');
  });

  it('JSON-encodes a session ID, logs the summary, and concludes the run', () => {
    const run = summarizeRun(
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
    expect(run.conclusion).toBe('success');
  });

  it('does not log an absent session ID', () => {
    summarizeRun(createKiroRunResult());

    expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining('[kiro] Session:'));
  });
});
