import { describe, expect, it } from 'vitest';
import { concludeRun, type RunConclusion } from '../../src/kiro/conclusion.js';
import type { KiroRunResult } from '../../src/kiro/runner.js';
import { createKiroRunResult } from '../helpers/run-result.js';

interface ConclusionCase {
  readonly name: string;
  readonly overrides: Partial<KiroRunResult>;
  readonly expected: RunConclusion;
}

const cases: readonly ConclusionCase[] = [
  {
    name: 'reports a timeout before missing-agent exit 4',
    overrides: { timedOut: true, exitCode: 4 },
    expected: { conclusion: 'timed_out', message: 'Kiro review timed out' },
  },
  {
    name: 'reports MCP startup exit 3 with run-error detail',
    overrides: {
      exitCode: 3,
      terminal: { kind: 'error', stage: 'init', message: 'GitHub MCP unavailable' },
    },
    expected: {
      conclusion: 'mcp_startup_failure',
      message: 'An MCP server failed to start: GitHub MCP unavailable',
    },
  },
  {
    name: 'reports MCP startup exit 3 with stderr-only detail',
    overrides: { exitCode: 3, stderrTail: '  MCP stderr detail\n' },
    expected: {
      conclusion: 'mcp_startup_failure',
      message: 'An MCP server failed to start: MCP stderr detail',
    },
  },
  {
    name: 'reports missing-agent exit 4 with run-error detail',
    overrides: {
      exitCode: 4,
      terminal: { kind: 'error', stage: 'init', message: 'requested agent is missing' },
    },
    expected: {
      conclusion: 'agent_not_loaded',
      message: 'Kiro could not load the review agent: requested agent is missing',
    },
  },
  {
    name: 'reports missing-agent exit 4 with stderr detail',
    overrides: { exitCode: 4, stderrTail: '  stderr detail\n' },
    expected: {
      conclusion: 'agent_not_loaded',
      message: 'Kiro could not load the review agent: stderr detail',
    },
  },
  {
    name: 'reports missing-agent exit 4 without detail',
    overrides: { exitCode: 4 },
    expected: {
      conclusion: 'agent_not_loaded',
      message: 'Kiro could not load the review agent',
    },
  },
  {
    name: 'reports a terminal run error',
    overrides: { terminal: { kind: 'error', stage: 'prompt', message: 'denied' } },
    expected: {
      conclusion: 'run_error',
      message: 'Kiro run error during prompt: denied',
    },
  },
  {
    name: 'reports strict end-turn success',
    overrides: {
      terminal: { kind: 'finished', status: 'success', stopReason: 'end_turn' },
    },
    expected: {
      conclusion: 'success',
      message: 'Kiro review completed successfully',
    },
  },
  {
    name: 'reports max-token completion as incomplete',
    overrides: {
      terminal: { kind: 'finished', status: 'success', stopReason: 'max_tokens' },
    },
    expected: {
      conclusion: 'incomplete',
      message: 'Kiro review was incomplete (status success, stop reason max_tokens)',
    },
  },
  {
    name: 'reports nonzero end-turn completion as incomplete',
    overrides: {
      exitCode: 1,
      terminal: { kind: 'finished', status: 'success', stopReason: 'end_turn' },
    },
    expected: {
      conclusion: 'incomplete',
      message: 'Kiro review was incomplete (status success, stop reason end_turn)',
    },
  },
  {
    name: 'reports nonzero exit with stderr detail as a run error',
    overrides: { exitCode: 1, stderrTail: '  process stderr\n' },
    expected: {
      conclusion: 'run_error',
      message: 'Kiro exited with code 1: process stderr',
    },
  },
  {
    name: 'reports nonzero exit without stderr as a run error',
    overrides: { exitCode: 9 },
    expected: {
      conclusion: 'run_error',
      message: 'Kiro exited with code 9',
    },
  },
  {
    name: 'reports signal termination with stderr as a run error',
    overrides: { exitCode: null, signal: 'SIGTERM', stderrTail: ' last stderr ' },
    expected: {
      conclusion: 'run_error',
      message: 'Kiro was terminated by SIGTERM: last stderr',
    },
  },
  {
    name: 'reports exit zero without a terminal event as incomplete',
    overrides: {},
    expected: {
      conclusion: 'incomplete',
      message: 'Kiro exited without a terminal stream event',
    },
  },
];

describe('concludeRun', () => {
  it.each(cases)('$name', ({ overrides, expected }) => {
    expect(concludeRun(createKiroRunResult(overrides))).toEqual(expected);
  });
});
