import type { KiroRunResult } from '../../src/kiro/runner.js';

/** Creates a valid Kiro run result with optional test-specific overrides. */
export function createKiroRunResult(overrides: Partial<KiroRunResult> = {}): KiroRunResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    sessionId: null,
    toolCalls: [],
    failedToolCalls: 0,
    credits: 0,
    terminal: null,
    stderrTail: '',
    ...overrides,
  };
}
