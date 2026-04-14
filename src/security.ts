import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import * as core from '@actions/core';
import { SENSITIVE_PATHS } from './constants.js';

/**
 * Restores sensitive config paths from the PR base branch to prevent
 * RCE via malicious config injection.
 *
 * @see CVE-2025-59536 / CVE-2026-21852 (Claude Code equivalent)
 */
export function restoreConfigFromBase(baseBranch: string): void {
  if (!/^[\w.\-/]+$/.test(baseBranch) || baseBranch.includes('..')) {
    throw new Error(`Invalid branch name: ${baseBranch}`);
  }

  core.info(`Restoring ${SENSITIVE_PATHS.join(', ')} from origin/${baseBranch}`);

  // 1. Backup PR versions for review agent inspection
  rmSync('.kiro-pr', { recursive: true, force: true });
  for (const p of SENSITIVE_PATHS) {
    if (existsSync(p)) {
      cpSync(p, `.kiro-pr/${p}`, { recursive: true });
    }
  }

  // 2. Delete PR versions BEFORE fetch (.gitmodules can cause fetch hang)
  for (const p of SENSITIVE_PATHS) {
    rmSync(p, { recursive: true, force: true });
  }

  // 3. Fetch and restore from base branch
  execFileSync('git', ['fetch', 'origin', baseBranch, '--depth=1', '--no-recurse-submodules'], {
    stdio: 'inherit',
  });
  for (const p of SENSITIVE_PATHS) {
    try {
      execFileSync('git', ['checkout', `origin/${baseBranch}`, '--', p], { stdio: 'pipe' });
    } catch {
      // Path doesn't exist on base — stays deleted
    }
  }

  // 4. Unstage restored files
  try {
    execFileSync('git', ['reset', '--', ...SENSITIVE_PATHS], { stdio: 'pipe' });
  } catch {
    // Nothing staged
  }
}
