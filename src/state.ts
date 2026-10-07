import * as core from '@actions/core';

const KIRO_PID_STATE = 'kiro_pid';

/** Records the Kiro process-group leader so the post step can terminate it if main is interrupted. */
export function saveKiroPid(pid: number): void {
  core.saveState(KIRO_PID_STATE, String(pid));
}

/** Clears the recorded Kiro PID once the run has settled. */
export function clearKiroPid(): void {
  core.saveState(KIRO_PID_STATE, '');
}

/** Returns the recorded Kiro PID, or undefined when none is pending. */
export function getKiroPid(): number | undefined {
  const state = core.getState(KIRO_PID_STATE);
  if (!/^[1-9]\d*$/.test(state)) return undefined;

  const pid = Number(state);
  if (!Number.isSafeInteger(pid) || pid <= 1) return undefined;

  return pid;
}
