import { rmSync } from 'node:fs';
import * as core from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/cleanup.js';
import { getKiroPid } from '../src/state.js';

vi.mock('node:fs', () => ({ rmSync: vi.fn() }));
vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));
vi.mock('../src/state.js', () => ({
  getKiroPid: vi.fn(),
}));

const readKiroPid = vi.mocked(getKiroPid);

async function runCleanup(): Promise<void> {
  await run();
}

beforeEach(() => {
  vi.clearAllMocks();
  readKiroPid.mockReturnValue(undefined);
});

describe('post cleanup', () => {
  it('kills the process group with SIGTERM then SIGKILL after the grace period', async () => {
    vi.useFakeTimers();
    readKiroPid.mockReturnValue(1234);
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);

    const cleanup = runCleanup();
    await vi.advanceTimersByTimeAsync(15_000);
    await cleanup;

    expect(kill).toHaveBeenNthCalledWith(1, -1234, 'SIGTERM');
    expect(kill).toHaveBeenNthCalledWith(2, -1234, 'SIGKILL');
    kill.mockRestore();
    vi.useRealTimers();
  });

  it('falls back to signaling the leader when group signaling fails', async () => {
    vi.useFakeTimers();
    readKiroPid.mockReturnValue(1234);
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid < 0) throw new Error('no group');
      return true;
    });

    const cleanup = runCleanup();
    await vi.advanceTimersByTimeAsync(15_000);
    await cleanup;

    expect(kill).toHaveBeenCalledWith(1234, 'SIGTERM');
    expect(kill).toHaveBeenCalledWith(1234, 'SIGKILL');
    kill.mockRestore();
    vi.useRealTimers();
  });

  it('does not wait or send SIGKILL when both SIGTERM targets are already gone', async () => {
    vi.useFakeTimers();
    readKiroPid.mockReturnValue(1234);
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('process gone'), { code: 'ESRCH' });
    });

    await runCleanup();

    expect(kill).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenNthCalledWith(1, -1234, 'SIGTERM');
    expect(kill).toHaveBeenNthCalledWith(2, 1234, 'SIGTERM');
    expect(kill).not.toHaveBeenCalledWith(expect.any(Number), 'SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
    expect(core.info).toHaveBeenCalledWith('Cleanup complete');
    kill.mockRestore();
    vi.useRealTimers();
  });

  it('removes the review workspace', async () => {
    await runCleanup();

    expect(rmSync).toHaveBeenCalledWith('.kiro-pr', { recursive: true, force: true });
  });

  it('ignores file removal failures', async () => {
    vi.mocked(rmSync).mockImplementation(() => {
      throw new Error('busy');
    });

    await expect(runCleanup()).resolves.toBeUndefined();

    expect(core.info).toHaveBeenCalledWith('Cleanup complete');
  });

  it('warns when cleanup throws an unexpected value', async () => {
    readKiroPid.mockImplementation(() => {
      throw 'state failed';
    });

    await runCleanup();

    expect(core.warning).toHaveBeenCalledWith('Post cleanup error: state failed');
  });
});
