import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  rmSync: vi.fn(),
}));

vi.mock('@actions/core', () => ({
  getState: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

import * as core from '@actions/core';

const getState = vi.mocked(core.getState);

async function runPost(): Promise<void> {
  vi.resetModules();
  vi.doMock('@actions/core', () => ({
    getState,
    info: vi.mocked(core.info),
    warning: vi.mocked(core.warning),
  }));
  vi.doMock('node:fs', () => ({
    rmSync: vi.fn(),
  }));
  const { default: promise } = await import('../src/post.js');
  await promise;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('post step', () => {
  it('skips kill when no PID in state', async () => {
    getState.mockReturnValue('');
    await runPost();
    expect(core.info).toHaveBeenCalledWith('Cleanup complete');
  });

  it('attempts to kill process when PID is in state', async () => {
    getState.mockReturnValue('99999');
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    await runPost();
    expect(killSpy).toHaveBeenCalledWith(99999, 'SIGTERM');
    killSpy.mockRestore();
  });

  it('handles already-dead process gracefully', async () => {
    getState.mockReturnValue('99999');
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });
    await runPost();
    expect(core.info).toHaveBeenCalledWith('Cleanup complete');
    killSpy.mockRestore();
  });

  it('escalates to SIGKILL after SIGTERM', async () => {
    vi.useFakeTimers();
    getState.mockReturnValue('99999');
    const calls: string[] = [];
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      calls.push(String(signal));
      return true;
    });

    await runPost();
    expect(calls).toContain('SIGTERM');

    vi.advanceTimersByTime(6000);
    expect(calls).toContain('SIGKILL');

    killSpy.mockRestore();
    vi.useRealTimers();
  });
});
