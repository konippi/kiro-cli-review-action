import fs, {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reviewWorkspacePaths } from '../../src/review/layout.js';
import {
  createReviewState,
  finalizeReview,
  REVIEW_LIMITS,
  readReviewProposal,
  recordFinding,
} from '../../src/review/proposal.js';

let directory = '';

function proposalPath(): string {
  directory = mkdtempSync(join(tmpdir(), 'kiro-review-state-'));
  return reviewWorkspacePaths(directory).proposal;
}

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe('review proposal', () => {
  it('records and deduplicates findings without writing a file', () => {
    const path = proposalPath();
    const state = createReviewState();
    const first = { path: 'a.ts', side: 'RIGHT' as const, line: 4, body: 'Fix this.' };

    expect(state).toEqual({ findings: [], sealed: false });
    expect(recordFinding(state, first)).toEqual({ ok: true, id: 'f1' });
    expect(state.findings).toEqual([{ id: 'f1', ...first }]);
    expect(recordFinding(state, first)).toEqual({ ok: true, id: 'f1' });
    expect(
      recordFinding(state, {
        path: 'a.ts',
        side: 'LEFT',
        startLine: 8,
        line: 9,
        body: 'Another issue.',
      }),
    ).toEqual({ ok: true, id: 'f2' });
    expect(readReviewProposal(path)).toBeNull();
    expect(readdirSync(directory)).toEqual([]);
  });

  it('validates IDs, writes selected findings in requested order, and seals once', () => {
    const path = proposalPath();
    const state = createReviewState();
    recordFinding(state, { path: 'a', side: 'RIGHT', line: 1, body: 'One' });
    recordFinding(state, { path: 'b', side: 'RIGHT', line: 2, body: 'Two' });

    expect(finalizeReview(state, path, ['missing'], 'Summary')).toEqual({
      ok: false,
      code: 'UNKNOWN_FINDING',
      message: 'Finding ID is unknown',
      validFindingIds: ['f1', 'f2'],
    });
    expect(finalizeReview(state, path, ['f2', 'f1'], 'Final summary')).toEqual({ ok: true });
    expect(readReviewProposal(path)).toEqual({
      summary: 'Final summary',
      findings: [
        { id: 'f2', path: 'b', side: 'RIGHT', line: 2, body: 'Two' },
        { id: 'f1', path: 'a', side: 'RIGHT', line: 1, body: 'One' },
      ],
    });
    expect(recordFinding(state, { path: 'c', side: 'RIGHT', line: 3, body: 'Late' })).toEqual({
      ok: false,
      code: 'FINALIZED',
      message: 'Review is finalized',
    });
    expect(finalizeReview(state, path, [], 'Late')).toEqual({
      ok: false,
      code: 'FINALIZED',
      message: 'Review is finalized',
    });
  });

  it('enforces the finding cap', () => {
    expect(REVIEW_LIMITS).toEqual({
      recordedFindings: 30,
      publishedFindings: 10,
      findingBody: 4_000,
      summaryBody: 8_000,
    });
    const state = createReviewState();
    for (let line = 1; line <= REVIEW_LIMITS.recordedFindings; line += 1) {
      expect(
        recordFinding(state, { path: 'a', side: 'RIGHT', line, body: `${line}` }),
      ).toMatchObject({ ok: true });
    }
    const overflow = REVIEW_LIMITS.recordedFindings + 1;
    expect(
      recordFinding(state, { path: 'a', side: 'RIGHT', line: overflow, body: `${overflow}` }),
    ).toEqual({
      ok: false,
      code: 'LIMIT_EXCEEDED',
      message: 'Finding limit reached',
    });
  });

  it('keeps state retryable and cleans up after an atomic rename failure', () => {
    const path = proposalPath();
    const state = createReviewState();
    recordFinding(state, { path: 'a', side: 'RIGHT', line: 1, body: 'Issue' });
    const renameError = new Error('rename failed');
    const writeFile = vi.spyOn(fs, 'writeFileSync');
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(function failRename() {
      throw renameError;
    });
    const remove = vi.spyOn(fs, 'rmSync');

    expect(function finalizeWithRenameFailure() {
      finalizeReview(state, path, ['f1'], 'Summary');
    }).toThrow(renameError);
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/\/\.[0-9a-f-]+\.tmp$/),
      `${JSON.stringify(
        {
          summary: 'Summary',
          findings: [{ id: 'f1', path: 'a', side: 'RIGHT', line: 1, body: 'Issue' }],
        },
        null,
        2,
      )}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    expect(remove).toHaveBeenCalledWith(expect.stringMatching(/\/\.[0-9a-f-]+\.tmp$/), {
      force: true,
    });
    expect(readReviewProposal(path)).toBeNull();
    expect(readdirSync(directory)).toEqual([]);

    rename.mockRestore();
    expect(finalizeReview(state, path, ['f1'], 'Summary')).toEqual({ ok: true });
    expect(state.sealed).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('preserves a pre-existing temporary file when exclusive creation fails', () => {
    const path = proposalPath();
    const state = createReviewState();
    const uuid = '00000000-0000-4000-8000-000000000000';
    const temporary = join(directory, `.${uuid}.tmp`);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
    writeFileSync(temporary, 'sentinel');

    expect(function finalizeWithCollision() {
      finalizeReview(state, path, [], 'Summary');
    }).toThrow(expect.objectContaining({ code: 'EEXIST' }));
    expect(readFileSync(temporary, 'utf8')).toBe('sentinel');
    expect(state.sealed).toBe(false);
  });

  it('cleans up an owned temporary file when rename fails with EEXIST', () => {
    const path = proposalPath();
    const state = createReviewState();
    const renameError = Object.assign(new Error('rename failed'), { code: 'EEXIST' });
    vi.spyOn(fs, 'renameSync').mockImplementation(function failRename() {
      throw renameError;
    });

    expect(function finalizeWithRenameCollision() {
      finalizeReview(state, path, [], 'Summary');
    }).toThrow(renameError);
    expect(readdirSync(directory)).toEqual([]);
    expect(state.sealed).toBe(false);
  });

  it('rethrows the original write error when temporary cleanup fails', () => {
    const path = proposalPath();
    const state = createReviewState();
    const writeError = new Error('write failed');
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(function failWrite() {
      throw writeError;
    });
    vi.spyOn(fs, 'rmSync').mockImplementationOnce(function failCleanup() {
      throw new Error('cleanup failed');
    });

    expect(function finalizeWithWriteFailure() {
      finalizeReview(state, path, [], 'Summary');
    }).toThrow(writeError);
    expect(state.sealed).toBe(false);
  });
  it('returns null only for a missing proposal and throws other read errors', () => {
    const path = proposalPath();
    expect(readReviewProposal(path)).toBeNull();

    writeFileSync(path, '{');
    expect(() => readReviewProposal(path)).toThrow(SyntaxError);
  });
});
