import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeJsonFile } from '../../../src/fs.js';
import { loadReviewWorkspace } from '../../../src/mcp/tools/workspace.js';
import { reviewWorkspacePaths } from '../../../src/review/layout.js';

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'kiro-review-workspace-'));
  writeJsonFile(reviewWorkspacePaths(directory).patches, { files: [] });
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('loadReviewWorkspace', () => {
  it('rejects invalid context JSON with its path', () => {
    const path = reviewWorkspacePaths(directory).context;
    writeFileSync(path, '{bad');

    expect(() => loadReviewWorkspace(directory)).toThrow(`Invalid JSON in ${path}`);
  });
});
