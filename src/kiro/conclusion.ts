import type { KiroRunResult } from './runner.js';

const MCP_STARTUP_FAILURE_EXIT = 3;
const NAMED_AGENT_NOT_FOUND_EXIT = 4;

/** Public conclusion for a completed Kiro process. */
export type Conclusion =
  | 'success'
  | 'timed_out'
  | 'mcp_startup_failure'
  | 'agent_not_loaded'
  | 'run_error'
  | 'incomplete';

/** Conclusion and user-facing message for a Kiro run. */
export interface RunConclusion {
  readonly conclusion: Conclusion;
  readonly message: string;
}

function withDetail(message: string, detail: string): string {
  return detail ? `${message}: ${detail}` : message;
}

function failureDetail(result: KiroRunResult): string {
  return result.terminal?.kind === 'error' ? result.terminal.message : result.stderrTail.trim();
}

/** Concludes a Kiro run, reporting the most specific failure first. */
export function concludeRun(result: KiroRunResult): RunConclusion {
  if (result.timedOut) return { conclusion: 'timed_out', message: 'Kiro review timed out' };

  if (result.exitCode === MCP_STARTUP_FAILURE_EXIT) {
    return {
      conclusion: 'mcp_startup_failure',
      message: withDetail('An MCP server failed to start', failureDetail(result)),
    };
  }

  if (result.exitCode === NAMED_AGENT_NOT_FOUND_EXIT) {
    return {
      conclusion: 'agent_not_loaded',
      message: withDetail('Kiro could not load the review agent', failureDetail(result)),
    };
  }

  if (result.terminal?.kind === 'error') {
    return {
      conclusion: 'run_error',
      message: `Kiro run error during ${result.terminal.stage}: ${result.terminal.message}`,
    };
  }

  if (
    result.exitCode === 0 &&
    result.terminal?.kind === 'finished' &&
    result.terminal.status === 'success' &&
    result.terminal.stopReason === 'end_turn'
  ) {
    return { conclusion: 'success', message: 'Kiro review completed successfully' };
  }

  if (result.terminal?.kind === 'finished') {
    return {
      conclusion: 'incomplete',
      message: `Kiro review was incomplete (status ${result.terminal.status}, stop reason ${result.terminal.stopReason})`,
    };
  }

  if (result.exitCode !== null && result.exitCode !== 0) {
    return {
      conclusion: 'run_error',
      message: withDetail(`Kiro exited with code ${result.exitCode}`, result.stderrTail.trim()),
    };
  }

  if (result.signal) {
    return {
      conclusion: 'run_error',
      message: withDetail(`Kiro was terminated by ${result.signal}`, result.stderrTail.trim()),
    };
  }

  return { conclusion: 'incomplete', message: 'Kiro exited without a terminal stream event' };
}
