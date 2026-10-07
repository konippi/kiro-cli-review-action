import { spawn } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import * as core from '@actions/core';
import { isPlainObject } from '../guards.js';

/** Grace between SIGTERM and SIGKILL; covers Kiro's own MCP/telemetry teardown budget (~10 s). */
export const SIGTERM_GRACE_MS = 15_000;

const STDERR_TAIL_LIMIT = 8 * 1024;

interface FinishedTerminal {
  readonly kind: 'finished';
  readonly status: string;
  readonly stopReason: string;
}

interface ErrorTerminal {
  readonly kind: 'error';
  readonly stage: string;
  readonly message: string;
}

type KiroTerminal = FinishedTerminal | ErrorTerminal;

interface RunKiroOptions {
  readonly kiroBinary: string;
  readonly agentName: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly debug: boolean;
  readonly graceMs?: number;
  readonly onSpawn?: (pid: number) => void;
}

/** Process and stream outcome for one headless Kiro invocation. */
export interface KiroRunResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly sessionId: string | null;
  readonly toolCalls: readonly string[];
  readonly failedToolCalls: number;
  readonly credits: number;
  readonly terminal: KiroTerminal | null;
  readonly stderrTail: string;
}

interface RunAccumulator {
  sessionId: string | null;
  toolCalls: string[];
  failedToolCalls: number;
  credits: number;
  terminal: KiroTerminal | null;
}

function emptyAccumulator(): RunAccumulator {
  return {
    sessionId: null,
    toolCalls: [],
    failedToolCalls: 0,
    credits: 0,
    terminal: null,
  };
}

function appendTail(current: string, line: string): string {
  const bytes = Buffer.from(`${current}${line}\n`, 'utf8');
  let start = Math.max(0, bytes.length - STDERR_TAIL_LIMIT);

  while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start += 1;

  return bytes.subarray(start).toString('utf8');
}

function logKiroLine(line: string): void {
  core.info(`[kiro] ${line}`);
}

function logKiroText(text: string): void {
  for (const line of text.split(/\r\n|[\r\n]/)) logKiroLine(line);
}

function recordSession(accumulator: RunAccumulator, data: Record<string, unknown>): void {
  if (typeof data.sessionId === 'string') accumulator.sessionId = data.sessionId;
}

function recordMetadata(accumulator: RunAccumulator, data: Record<string, unknown>): void {
  if (!Array.isArray(data.meteringUsage)) return;

  for (const usage of data.meteringUsage) {
    if (isPlainObject(usage) && usage.unit === 'credit' && typeof usage.value === 'number') {
      accumulator.credits += usage.value;
    }
  }
}

function recordUpdate(accumulator: RunAccumulator, data: Record<string, unknown>): void {
  if (!isPlainObject(data.update)) return;

  const update = data.update;
  if (
    update.sessionUpdate === 'tool_call' &&
    typeof update.title === 'string' &&
    update.title !== ''
  ) {
    accumulator.toolCalls.push(update.title);
    core.info(`[kiro] Tool call: ${JSON.stringify(update.title)}`);
  }

  if (update.sessionUpdate === 'tool_call_update' && update.status === 'failed') {
    accumulator.failedToolCalls += 1;
  }
}

function recordStdoutLine(accumulator: RunAccumulator, line: string, debug: boolean): void {
  if (debug) logKiroText(line);

  let envelope: unknown;

  try {
    envelope = JSON.parse(line);
  } catch {
    return;
  }

  if (!isPlainObject(envelope) || typeof envelope.type !== 'string') return;
  if (!isPlainObject(envelope.data)) return;

  const data = envelope.data;
  recordSession(accumulator, data);

  switch (envelope.type) {
    case 'metadata':
      recordMetadata(accumulator, data);
      break;
    case 'sessionUpdate':
      recordUpdate(accumulator, data);
      break;
    case 'runFinished':
      if (typeof data.status === 'string' && typeof data.stopReason === 'string') {
        const finalText = typeof data.finalText === 'string' ? data.finalText : '';
        accumulator.terminal = {
          kind: 'finished',
          status: data.status,
          stopReason: data.stopReason,
        };
        if (debug && finalText !== '') logKiroText(finalText);
      }
      break;
    case 'runError':
      if (typeof data.stage === 'string' && typeof data.message === 'string') {
        accumulator.terminal = { kind: 'error', stage: data.stage, message: data.message };
      }
      break;
    default:
      break;
  }
}

function signalProcessGroup(
  pid: number | undefined,
  signal: NodeJS.Signals,
  leaderClosed: boolean,
): boolean {
  if (!pid) return false;

  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    if (leaderClosed) return false;

    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

function isProcessGroupAlive(pid: number | undefined): boolean {
  if (!pid) return false;

  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface ProcessGroupTermination {
  readonly pid: number | undefined;
  readonly graceMs: number;
  leaderClosed: boolean;
  terminating: boolean;
  escalated: boolean;
  escalationTimer: NodeJS.Timeout | undefined;
  pollTimer: NodeJS.Timeout | undefined;
  onEscalation: (() => void) | undefined;
  onGroupExit: (() => void) | undefined;
}

/** Creates state for terminating and reaping a detached process group. */
export function createTermination(
  pid: number | undefined,
  graceMs: number,
): ProcessGroupTermination {
  return {
    pid,
    graceMs,
    leaderClosed: false,
    terminating: false,
    escalated: false,
    escalationTimer: undefined,
    pollTimer: undefined,
    onEscalation: undefined,
    onGroupExit: undefined,
  };
}

/** Starts process-group termination and schedules forced escalation. */
export function terminateGroup(termination: ProcessGroupTermination): boolean {
  if (termination.terminating) return true;

  termination.terminating = true;
  const delivered = signalProcessGroup(termination.pid, 'SIGTERM', termination.leaderClosed);
  termination.escalationTimer = setTimeout(() => escalate(termination), termination.graceMs);
  return delivered;
}

function markLeaderClosed(termination: ProcessGroupTermination): void {
  termination.leaderClosed = true;
}

function isGroupAlive(termination: ProcessGroupTermination): boolean {
  return isProcessGroupAlive(termination.pid);
}

/** Registers a callback for forced process-group escalation. */
export function waitForEscalation(
  termination: ProcessGroupTermination,
  onEscalation: () => void,
): void {
  termination.onEscalation = onEscalation;
}

function waitForGroupExit(termination: ProcessGroupTermination, onGroupExit: () => void): void {
  termination.onGroupExit = onGroupExit;
  if (termination.escalated) pollForGroupExit(termination);
}

/** Clears termination timers and callbacks. */
export function disposeTermination(termination: ProcessGroupTermination): void {
  if (termination.escalationTimer) clearTimeout(termination.escalationTimer);
  if (termination.pollTimer) clearTimeout(termination.pollTimer);
  termination.escalationTimer = undefined;
  termination.pollTimer = undefined;
  termination.onEscalation = undefined;
  termination.onGroupExit = undefined;
}

function escalate(termination: ProcessGroupTermination): void {
  termination.escalationTimer = undefined;
  termination.escalated = true;
  signalProcessGroup(termination.pid, 'SIGKILL', termination.leaderClosed);
  termination.onEscalation?.();
  termination.onEscalation = undefined;
  if (termination.onGroupExit) pollForGroupExit(termination);
}

function pollForGroupExit(termination: ProcessGroupTermination): void {
  if (!termination.onGroupExit) return;
  if (isGroupAlive(termination)) {
    termination.pollTimer = setTimeout(() => {
      termination.pollTimer = undefined;
      pollForGroupExit(termination);
    }, 10);
    return;
  }

  const onGroupExit = termination.onGroupExit;
  termination.onGroupExit = undefined;
  onGroupExit();
}

interface CloseResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

type RunSettlement =
  | { readonly kind: 'resolve'; readonly result: KiroRunResult }
  | { readonly kind: 'reject'; readonly error: unknown };

interface RunState {
  readonly accumulator: RunAccumulator;
  readonly termination: ProcessGroupTermination;
  readonly stdoutLines: Interface | null;
  readonly stderrLines: Interface | null;
  readonly resolve: (result: KiroRunResult) => void;
  readonly reject: (error: unknown) => void;
  stderrTail: string;
  timedOut: boolean;
  settled: boolean;
  timeout: NodeJS.Timeout | undefined;
  closeResult: CloseResult | undefined;
  spawnFailure: { readonly error: unknown } | undefined;
}

function settleRun(state: RunState, settlement: RunSettlement): void {
  if (state.settled) return;

  state.settled = true;
  if (state.timeout) clearTimeout(state.timeout);
  state.timeout = undefined;
  disposeTermination(state.termination);
  state.stdoutLines?.close();
  state.stderrLines?.close();
  if (settlement.kind === 'resolve') state.resolve(settlement.result);
  else state.reject(settlement.error);
}

function finishRun(state: RunState): void {
  if (!state.closeResult) return;
  if (state.spawnFailure) {
    settleRun(state, { kind: 'reject', error: state.spawnFailure.error });
    return;
  }

  settleRun(state, {
    kind: 'resolve',
    result: {
      ...state.closeResult,
      timedOut: state.timedOut,
      ...state.accumulator,
      stderrTail: state.stderrTail,
    },
  });
}

function closeRun(state: RunState, exitCode: number | null, signal: NodeJS.Signals | null): void {
  if (state.settled) return;

  state.closeResult = { exitCode, signal };
  markLeaderClosed(state.termination);
  if (!isGroupAlive(state.termination)) {
    finishRun(state);
    return;
  }

  if (!state.termination.terminating) {
    if (state.timeout) clearTimeout(state.timeout);
    state.timeout = undefined;
    terminateGroup(state.termination);
  }
  waitForGroupExit(state.termination, () => finishRun(state));
}

function spawnKiro(options: RunKiroOptions) {
  return spawn(
    options.kiroBinary,
    [
      'chat',
      '--no-interactive',
      '--agent-engine',
      'v2',
      '--agent',
      options.agentName,
      '--output-format',
      'stream-json',
      '--require-mcp-startup',
    ],
    {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
}

/** Runs Kiro headlessly and resolves with process and stream state after child completion. */
export function runKiro(options: RunKiroOptions): Promise<KiroRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawnKiro(options);
    const stdoutLines = child.stdout ? createInterface({ input: child.stdout }) : null;
    const stderrLines = child.stderr ? createInterface({ input: child.stderr }) : null;
    const termination = createTermination(child.pid, options.graceMs ?? SIGTERM_GRACE_MS);
    const state: RunState = {
      accumulator: emptyAccumulator(),
      termination,
      stdoutLines,
      stderrLines,
      resolve,
      reject,
      stderrTail: '',
      timedOut: false,
      settled: false,
      timeout: undefined,
      closeResult: undefined,
      spawnFailure: undefined,
    };
    state.timeout = setTimeout(() => {
      state.timedOut = true;
      terminateGroup(termination);
    }, options.timeoutMs);
    state.timeout.unref();

    stdoutLines?.on('line', (line) => recordStdoutLine(state.accumulator, line, options.debug));
    stderrLines?.on('line', (line) => {
      state.stderrTail = appendTail(state.stderrTail, line);
      if (options.debug || line.startsWith('[warn]')) logKiroText(line);
    });
    child.once('error', (error) => {
      const failure = state.spawnFailure;
      settleRun(state, { kind: 'reject', error: failure ? failure.error : error });
    });
    child.stdin?.on('error', () => {
      // The process may exit before consuming all prompt input.
    });
    child.once('close', (exitCode, signal) => closeRun(state, exitCode, signal));

    try {
      if (child.pid) options.onSpawn?.(child.pid);
    } catch (error: unknown) {
      state.spawnFailure = { error };
      child.stdin?.end();
      terminateGroup(termination);
      return;
    }

    child.stdin?.end(options.prompt);
  });
}
