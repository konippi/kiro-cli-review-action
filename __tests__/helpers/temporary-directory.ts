import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';

/** Creates a temporary directory that is removed when the current test finishes. */
export function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'kiro-test-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
