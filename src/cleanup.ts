import { rmSync } from 'node:fs';
import * as core from '@actions/core';
import { toErrorMessage } from './errors.js';

const SIGTERM_GRACE_MS = 5_000;

function killProcess(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return; // Already dead
  }
  setTimeout(() => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already dead
    }
  }, SIGTERM_GRACE_MS);
}

async function cleanup(): Promise<void> {
  // Kill ACP process
  const acpPid = core.getState('acp_pid');
  if (acpPid) {
    const pid = Number.parseInt(acpPid, 10);
    if (!Number.isNaN(pid) && pid > 0) {
      core.info(`Terminating ACP process (PID: ${pid})`);
      killProcess(pid);
    }
  }

  // Clean up backup directory
  try {
    rmSync('.kiro-pr', { recursive: true, force: true });
  } catch {
    // Best effort
  }

  core.info('Cleanup complete');
}

/** Runs post-action cleanup and reports unexpected cleanup errors as warnings. */
export async function run(): Promise<void> {
  try {
    await cleanup();
  } catch (error: unknown) {
    core.warning(`Post cleanup error: ${toErrorMessage(error)}`);
  }
}
