import { rmSync } from 'node:fs';
import * as core from '@actions/core';
import { toErrorMessage } from './errors.js';
import {
  createTermination,
  disposeTermination,
  SIGTERM_GRACE_MS,
  terminateGroup,
  waitForEscalation,
} from './kiro/runner.js';
import { getKiroPid } from './state.js';

async function terminateProcess(pid: number): Promise<void> {
  const termination = createTermination(pid, SIGTERM_GRACE_MS);
  if (!terminateGroup(termination)) {
    disposeTermination(termination);
    return;
  }

  await new Promise<void>((resolve) => waitForEscalation(termination, resolve));
  disposeTermination(termination);
}

function removeBestEffort(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
}

async function cleanup(): Promise<void> {
  const pid = getKiroPid();
  if (pid) {
    core.info(`Terminating Kiro process group (PID: ${pid})`);
    await terminateProcess(pid);
  }

  removeBestEffort('.kiro-pr');

  core.info('Cleanup complete');
}

/** Runs post-action cleanup and reports unexpected cleanup errors through warnings. */
export async function run(): Promise<void> {
  try {
    await cleanup();
  } catch (error: unknown) {
    core.warning(`Post cleanup error: ${toErrorMessage(error)}`);
  }
}
