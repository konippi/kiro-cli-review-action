import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as core from '@actions/core';
import { buildSync } from 'esbuild';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { concludeRun } from '../../src/kiro/conclusion.js';
import { runKiro } from '../../src/kiro/runner.js';

vi.mock('@actions/core', () => ({ info: vi.fn() }));

const fixture = join(process.cwd(), '__tests__', 'fixtures', 'fake-kiro-cli.ts');
const standaloneFixture = join(process.cwd(), '__tests__', 'fixtures', 'run-kiro-standalone.ts');
const NORMAL_PROCESS_TIMEOUT_MS = 10_000;
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'kiro-runner-'));
const wrapper = join(temporaryDirectory, 'kiro-cli');
const standalone = join(temporaryDirectory, 'run-kiro-standalone.cjs');

beforeAll(() => {
  writeFileSync(wrapper, `#!/bin/sh\nexec node ${JSON.stringify(fixture)} "$@"\n`);
  chmodSync(wrapper, 0o755);
  buildSync({
    entryPoints: [standaloneFixture],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    outfile: standalone,
    logLevel: 'silent',
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function run(
  scenario: string,
  timeoutMs = NORMAL_PROCESS_TIMEOUT_MS,
  extraEnvironment: NodeJS.ProcessEnv = {},
  debug = false,
  graceMs = 100,
) {
  return runKiro({
    kiroBinary: wrapper,
    agentName: 'kiro-review-action',
    prompt: 'review prompt',
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? '',
      FAKE_KIRO_CLI_SCENARIO: scenario,
      ...extraEnvironment,
    },
    timeoutMs,
    graceMs,
    debug,
  });
}

async function expectProcessDead(pid: number): Promise<void> {
  await expect
    .poll(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    })
    .toBe(true);
}

describe('runKiro', () => {
  it('passes fixed headless args, sends the prompt, and accumulates success events', async () => {
    const result = await run('success');

    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      sessionId: 's-success',
      toolCalls: ['test'],
      failedToolCalls: 1,
      credits: 1.25,
      terminal: {
        kind: 'finished',
        status: 'success',
        stopReason: 'end_turn',
      },
    });
  });

  it('preserves error and MCP exit codes', async () => {
    const error = await run('error');
    const mcp = await run('mcp');

    expect(error.exitCode).toBe(1);
    expect(error.terminal).toEqual({ kind: 'error', stage: 'init', message: 'failed' });
    expect(mcp.exitCode).toBe(3);
  });

  it('returns no terminal event for a clean early exit', async () => {
    const result = await run('no-terminal');

    expect(result.exitCode).toBe(0);
    expect(result.terminal).toBeNull();
  });

  it('ignores malformed lines without throwing', async () => {
    const result = await run('malformed');

    expect(result.terminal).toBeNull();
  });

  it('preserves missing-agent exit 4 and its terminal error', async () => {
    const result = await run('missing-agent');
    const missingAgentMessage = [
      'failed',
      "to set agent 'kiro-review-action': invalid config",
    ].join(' ');

    expect(result.exitCode).toBe(4);
    expect(result.terminal).toEqual({
      kind: 'error',
      stage: 'init',
      message: missingAgentMessage,
    });
    expect(result.timedOut).toBe(false);
  });

  it('ignores structurally invalid protocol fields while retaining valid accounting', async () => {
    const error = await run('protocol-edges', NORMAL_PROCESS_TIMEOUT_MS, {
      FAKE_KIRO_CLI_PROTOCOL_TERMINAL: 'error',
    });
    const incomplete = await run('protocol-edges');

    expect(error).toMatchObject({
      sessionId: null,
      credits: 4,
      toolCalls: [],
      terminal: { kind: 'error', stage: 'protocol', message: 'edge failure' },
    });
    expect(incomplete).toMatchObject({
      terminal: null,
    });
  });

  it('accepts a completed terminal when final text is omitted', async () => {
    const result = await run('protocol-edges', NORMAL_PROCESS_TIMEOUT_MS, {
      FAKE_KIRO_CLI_PROTOCOL_TERMINAL: 'finished-without-text',
    });

    expect(result.terminal).toEqual({
      kind: 'finished',
      status: 'success',
      stopReason: 'end_turn',
    });
  });

  it('does not time out while reaping a descendant after a successful leader exit', async () => {
    const pidFile = join(temporaryDirectory, 'deadline-crossing-descendant.pid');
    let pid: number | undefined;

    try {
      const result = await run(
        'lingering-descendant',
        500,
        { GRANDCHILD_PID_FILE: pidFile },
        false,
        1_000,
      );
      pid = Number.parseInt(readFileSync(pidFile, 'utf8'), 10);

      expect(result).toMatchObject({ exitCode: 0, signal: null, timedOut: false });
      expect(concludeRun(result).conclusion).toBe('success');
      await expectProcessDead(pid);
    } finally {
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // The runner already terminated the descendant.
        }
      }
    }
  });

  it('times out and kills the process group including a grandchild', async () => {
    const pidFile = join(temporaryDirectory, 'grandchild.pid');
    const result = await run('hang', 500, { GRANDCHILD_PID_FILE: pidFile });
    const pid = Number.parseInt(readFileSync(pidFile, 'utf8'), 10);

    expect(result.timedOut).toBe(true);
    await expectProcessDead(pid);
  });

  it('waits for escalation and kills a ready SIGTERM-resistant grandchild', async () => {
    const pidFile = join(temporaryDirectory, 'resistant.pid');
    const started = Date.now();
    const result = await run('resistant-grandchild', 1_000, { GRANDCHILD_PID_FILE: pidFile });
    const pid = Number.parseInt(readFileSync(pidFile, 'utf8'), 10);

    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_050);
    await expectProcessDead(pid);
  });

  it('keeps a standalone process alive until forced escalation resolves', () => {
    const pidFile = join(temporaryDirectory, 'standalone-resistant.pid');
    let pid: number | undefined;

    try {
      const result = spawnSync(process.execPath, [standalone], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 5_000,
        env: {
          PATH: process.env.PATH ?? '',
          FAKE_KIRO_CLI_BINARY: wrapper,
          GRANDCHILD_PID_FILE: pidFile,
        },
      });

      expect({ status: result.status, error: result.error, stderr: result.stderr }).toEqual({
        status: 0,
        error: undefined,
        stderr: '',
      });
      pid = Number.parseInt(readFileSync(pidFile, 'utf8'), 10);

      expect(JSON.parse(result.stdout)).toMatchObject({ timedOut: true });
      expect(() => process.kill(pid ?? 0, 0)).toThrow();
    } finally {
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // The forced escalation already terminated the descendant.
        }
      }
    }
  });

  it.each([
    ['8191 bytes', 'x'.repeat(8_190), `${'x'.repeat(8_190)}\n`],
    ['8192 bytes', 'x'.repeat(8_191), `${'x'.repeat(8_191)}\n`],
    ['8193 bytes', 'x'.repeat(8_192), `${'x'.repeat(8_191)}\n`],
    ['a multibyte character across the cut', `€${'x'.repeat(8_190)}`, `${'x'.repeat(8_190)}\n`],
  ])('keeps the exact stderr tail boundary for %s', async (_name, stderr, expected) => {
    const result = await run('controlled-stderr', NORMAL_PROCESS_TIMEOUT_MS, {
      FAKE_KIRO_CLI_STDERR: stderr,
    });

    expect(result.stderrTail).toBe(expected);
  });

  it('logs CR and LF stderr boundaries as separately prefixed debug lines', async () => {
    await run('crlf-stderr', NORMAL_PROCESS_TIMEOUT_MS, {}, true);

    expect(vi.mocked(core.info).mock.calls).toEqual([['[kiro] a'], ['[kiro] b'], ['[kiro] c']]);
  });

  it('prefixes every physical line of untrusted debug and warning output', async () => {
    await run('untrusted-output', NORMAL_PROCESS_TIMEOUT_MS, {}, true);

    const messages = vi.mocked(core.info).mock.calls.map(([message]) => String(message));
    expect(messages).toContain('[kiro] ::add-mask::final-secret');
    expect(messages).toContain('[kiro] ::add-mask::stderr-secret');
    expect(messages).toContain('[kiro] Tool call: "test\\n::add-mask::tool-secret"');
    expect(messages.every((message) => message.startsWith('[kiro] '))).toBe(true);
    expect(messages.filter((message) => /[\r\n]::/u.test(message))).toEqual([]);
  });

  it('waits for the process group to disappear after forced escalation', async () => {
    vi.useFakeTimers();
    const stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
    const child = Object.assign(new EventEmitter(), {
      pid: 4321,
      stdin,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    let groupAlive = true;
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid > 0) throw new Error('closed leader must not be signaled');
      if (signal === 0) {
        if (groupAlive) return true;

        throw new Error('process group exited');
      }
      if (signal === 'SIGKILL') throw new Error('process group disappeared during escalation');

      return true;
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();

      return { ...actual, spawn: vi.fn(() => child) };
    });

    try {
      vi.resetModules();
      const { runKiro: runMockedKiro } = await import('../../src/kiro/runner.js');
      const invocation = runMockedKiro({
        kiroBinary: '/fake/kiro',
        agentName: 'kiro-review-action',
        prompt: 'prompt',
        cwd: process.cwd(),
        env: {},
        timeoutMs: 1_000,
        graceMs: 100,
        debug: false,
      });
      const resolved = vi.fn();
      invocation.then(resolved);

      child.emit('close', 0, null);
      await vi.advanceTimersByTimeAsync(100);

      expect(resolved).not.toHaveBeenCalled();
      expect(kill.mock.calls.some(([pid]) => pid === 4321)).toBe(false);

      groupAlive = false;
      await vi.advanceTimersByTimeAsync(100);

      await expect(invocation).resolves.toMatchObject({ exitCode: 0, signal: null });
      expect(resolved).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      kill.mockRestore();
      vi.doUnmock('node:child_process');
      vi.resetModules();
      vi.useRealTimers();
    }
  });

  it('terminates the child before rejecting when onSpawn throws', async () => {
    let pid: number | undefined;
    const invocation = runKiro({
      kiroBinary: wrapper,
      agentName: 'kiro-review-action',
      prompt: 'review prompt',
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH ?? '',
        FAKE_KIRO_CLI_SCENARIO: 'success',
      },
      timeoutMs: NORMAL_PROCESS_TIMEOUT_MS,
      graceMs: 100,
      debug: false,
      onSpawn: (spawnedPid) => {
        pid = spawnedPid;
        throw new Error('state write failed');
      },
    });

    await expect(invocation).rejects.toThrow('state write failed');
    expect(pid).toBeDefined();
    await expectProcessDead(pid ?? 0);
  });

  it('rejects once and clears timers for a post-spawn child error while swallowing stdin errors', async () => {
    vi.useFakeTimers();
    const stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
    const child = Object.assign(new EventEmitter(), {
      pid: 4321,
      stdin,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();

      return { ...actual, spawn: vi.fn(() => child) };
    });
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);

    try {
      vi.resetModules();
      const { runKiro: runMockedKiro } = await import('../../src/kiro/runner.js');
      const onSpawn = vi.fn();
      const rejected = vi.fn();
      const invocation = runMockedKiro({
        kiroBinary: '/fake/kiro',
        agentName: 'kiro-review-action',
        prompt: 'prompt',
        cwd: process.cwd(),
        env: {},
        timeoutMs: 1_000,
        debug: false,
        onSpawn,
      });
      invocation.catch(rejected);
      const failure = new Error('child failed after spawn');

      stdin.emit('error', new Error('stdin closed'));
      child.emit('error', failure);
      child.emit('close', 1, null);

      await expect(invocation).rejects.toBe(failure);
      expect(onSpawn).toHaveBeenCalledWith(4321);
      expect(rejected).toHaveBeenCalledOnce();
      expect(rejected).toHaveBeenCalledWith(failure);
      expect(kill).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      kill.mockRestore();
      vi.doUnmock('node:child_process');
      vi.resetModules();
      vi.useRealTimers();
    }
  });

  it('rejects with the original spawn error', async () => {
    const missingBinary = join(temporaryDirectory, 'missing');
    const invocation = runKiro({
      kiroBinary: missingBinary,
      agentName: 'kiro-review-action',
      prompt: 'prompt',
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs: 1_000,
      debug: false,
    });

    await expect(invocation).rejects.toThrow(/ENOENT/u);
    await expect(invocation).rejects.toThrow(missingBinary);
  });
});
