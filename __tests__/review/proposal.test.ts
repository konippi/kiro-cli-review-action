import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createReviewRecorder,
  REVIEW_LIMITS,
  readReviewProposal,
} from '../../src/review/proposal.js';
import { createTemporaryDirectory } from '../helpers/temporary-directory.js';

const finding = { path: 'a.ts', side: 'RIGHT', line: 1, body: 'Issue' } as const;

function createRecorder() {
  const directory = createTemporaryDirectory();
  const proposalPath = join(directory, 'proposal.json');
  return { directory, proposalPath, recorder: createReviewRecorder(proposalPath) };
}

describe('createReviewRecorder', () => {
  it('returns the existing id for an identical finding', () => {
    const { recorder } = createRecorder();

    expect(recorder.record(finding)).toEqual({ ok: true, id: 'f1', recorded: 1 });
    expect(recorder.record(finding)).toEqual({ ok: true, id: 'f1', recorded: 1 });
  });

  it('rejects findings beyond the limit', () => {
    const { recorder } = createRecorder();
    for (let line = 1; line <= REVIEW_LIMITS.recordedFindings; line += 1) {
      recorder.record({ ...finding, line });
    }

    expect(recorder.record({ ...finding, body: 'Over' })).toEqual({
      ok: false,
      code: 'LIMIT_EXCEEDED',
    });
  });

  it('rejects an unknown finding id with the recorded ids', () => {
    const { recorder } = createRecorder();
    recorder.record(finding);

    expect(recorder.submit(['f2'], 'Summary')).toEqual({
      ok: false,
      code: 'UNKNOWN_FINDING',
      id: 'f2',
      validFindingIds: ['f1'],
    });
  });

  it('writes the selected findings in the requested order', () => {
    const { proposalPath, recorder } = createRecorder();
    recorder.record(finding);
    recorder.record({ ...finding, line: 2 });

    expect(recorder.submit(['f2', 'f1'], 'Summary')).toEqual({ ok: true });
    expect(readReviewProposal(proposalPath)).toEqual({
      summary: 'Summary',
      findings: [
        { id: 'f2', ...finding, line: 2 },
        { id: 'f1', ...finding },
      ],
    });
  });

  it('accepts only an identical resubmission once submitted', () => {
    const { recorder } = createRecorder();
    recorder.record(finding);
    recorder.submit(['f1'], 'Summary');

    expect(recorder.submit(['f1'], 'Summary')).toEqual({ ok: true });
    expect(recorder.submit([], 'Summary')).toEqual({ ok: false, code: 'FINALIZED' });
    expect(recorder.record({ ...finding, line: 3 })).toEqual({ ok: false, code: 'FINALIZED' });
  });

  it('stays open and leaves no temporary file when the proposal cannot be written', () => {
    const { directory, proposalPath, recorder } = createRecorder();
    mkdirSync(proposalPath);

    expect(() => recorder.submit([], 'Summary')).toThrow();
    expect(readdirSync(directory)).toEqual(['proposal.json']);

    rmSync(proposalPath, { recursive: true });
    expect(recorder.submit([], 'Summary')).toEqual({ ok: true });
  });
});

describe('readReviewProposal', () => {
  it('rejects a proposal that does not match the schema with its path and the failing field', () => {
    const path = join(createTemporaryDirectory(), 'proposal.json');
    writeFileSync(
      path,
      JSON.stringify({ summary: 'Summary', findings: [{ id: 'f1', ...finding, side: 'BOTH' }] }),
    );

    expect(() => readReviewProposal(path)).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(
          new RegExp(`^Invalid review proposal in ${path}\\n.*findings\\[0\\]\\.side`, 's'),
        ),
      }),
    );
  });
});
