import { rmSync } from 'node:fs';
import * as core from '@actions/core';
import { SIGTERM_GRACE_MS } from './constants.js';

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

async function run(): Promise<void> {
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

export default run().catch((error: unknown) => {
  core.warning(`Post cleanup error: ${error instanceof Error ? error.message : String(error)}`);
});
