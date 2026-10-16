import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { isErrnoException } from '../errors.js';
import { readJsonFile } from '../fs.js';
import type { DiffSide } from './diff.js';

/** Shared limits for recorded review proposals. */
export const REVIEW_LIMITS = {
  recordedFindings: 30,
  publishedFindings: 10,
  findingBody: 4_000,
  summaryBody: 8_000,
} as const;

interface ReviewFinding {
  readonly id: string;
  readonly path: string;
  readonly side: DiffSide;
  readonly line: number;
  readonly startLine?: number;
  readonly body: string;
}

/** Finding input before its deterministic ID is assigned. */
export type ReviewFindingInput = Omit<ReviewFinding, 'id'>;

/** Complete review output selected during finalization. */
export interface ReviewProposal {
  readonly summary: string;
  readonly findings: readonly ReviewFinding[];
}

/** Mutable state for one review recorder process. */
export interface ReviewState {
  readonly findings: ReviewFinding[];
  sealed: boolean;
}

/** Failure returned when review state cannot be mutated. */
export interface ProposalFailure {
  readonly ok: false;
  readonly code: 'FINALIZED' | 'LIMIT_EXCEEDED' | 'UNKNOWN_FINDING';
  readonly message: string;
  readonly validFindingIds?: readonly string[];
}

function sameFinding(left: ReviewFinding, right: ReviewFindingInput): boolean {
  return (
    left.path === right.path &&
    left.side === right.side &&
    left.line === right.line &&
    left.startLine === right.startLine &&
    left.body === right.body
  );
}

function writeReviewProposal(path: string, proposal: ReviewProposal): void {
  const temporary = join(dirname(path), `.${crypto.randomUUID()}.tmp`);
  const json = `${JSON.stringify(proposal, null, 2)}\n`;

  let created = false;
  try {
    fs.writeFileSync(temporary, json, { mode: 0o600, flag: 'wx' });
    created = true;
    fs.renameSync(temporary, path);
  } catch (error: unknown) {
    if (created || !isErrnoException(error) || error.code !== 'EEXIST') {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {}
    }

    throw error;
  }
}

/** Creates empty in-memory review state. */
export function createReviewState(): ReviewState {
  return { findings: [], sealed: false };
}

/** Records or deduplicates one finding in unsealed review state. */
export function recordFinding(
  state: ReviewState,
  input: ReviewFindingInput,
): { readonly ok: true; readonly id: string } | ProposalFailure {
  if (state.sealed) {
    return { ok: false, code: 'FINALIZED', message: 'Review is finalized' };
  }

  const duplicate = state.findings.find(function matches(finding) {
    return sameFinding(finding, input);
  });
  if (duplicate) return { ok: true, id: duplicate.id };
  if (state.findings.length >= REVIEW_LIMITS.recordedFindings) {
    return { ok: false, code: 'LIMIT_EXCEEDED', message: 'Finding limit reached' };
  }

  const finding: ReviewFinding = {
    id: `f${state.findings.length + 1}`,
    ...input,
  };
  state.findings.push(finding);

  return { ok: true, id: finding.id };
}

/** Writes selected findings and seals review state after a successful atomic write. */
export function finalizeReview(
  state: ReviewState,
  path: string,
  findingIds: readonly string[],
  summary: string,
): { readonly ok: true } | ProposalFailure {
  if (state.sealed) {
    return { ok: false, code: 'FINALIZED', message: 'Review is finalized' };
  }

  const findingsById = new Map<string, ReviewFinding>();
  for (const finding of state.findings) findingsById.set(finding.id, finding);

  const findings: ReviewFinding[] = [];
  for (const id of findingIds) {
    const finding = findingsById.get(id);
    if (!finding) {
      const validFindingIds = state.findings.map(function findingId(candidate) {
        return candidate.id;
      });

      return {
        ok: false,
        code: 'UNKNOWN_FINDING',
        message: 'Finding ID is unknown',
        validFindingIds,
      };
    }

    findings.push(finding);
  }

  writeReviewProposal(path, { summary, findings });
  state.sealed = true;

  return { ok: true };
}

/** Reads a complete review proposal, or null when it does not exist. */
export function readReviewProposal(path: string): ReviewProposal | null {
  try {
    return readJsonFile<ReviewProposal>(path);
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}
