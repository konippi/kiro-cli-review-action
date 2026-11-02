import * as z from 'zod/v4';
import { readJsonFile, writeJsonFileAtomic } from '../fs.js';
import type { DiffSide } from './diff.js';

/** Shared limits for recorded review proposals. */
export const REVIEW_LIMITS = {
  recordedFindings: 30,
  publishedFindings: 10,
  findingBody: 4_000,
  summaryBody: 8_000,
} as const;

/** One inline finding recorded by the reviewer. */
export interface ReviewFinding {
  readonly id: string;
  readonly path: string;
  readonly side: DiffSide;
  readonly line: number;
  readonly startLine?: number;
  readonly body: string;
}

/** Finding input before its ID is assigned. */
export type ReviewFindingInput = Omit<ReviewFinding, 'id'>;

/** Complete review written for the host to post. */
export interface ReviewProposal {
  readonly summary: string;
  readonly findings: readonly ReviewFinding[];
}

const ReviewProposalSchema = z.strictObject({
  summary: z.string().max(REVIEW_LIMITS.summaryBody),
  findings: z
    .array(
      z.strictObject({
        id: z.string(),
        path: z.string().min(1),
        side: z.enum(['RIGHT', 'LEFT']),
        line: z.number().int().min(1),
        startLine: z.number().int().min(1).exactOptional(),
        body: z.string().max(REVIEW_LIMITS.findingBody),
      }),
    )
    .max(REVIEW_LIMITS.publishedFindings),
});

/** Reason the review cannot change. */
export type ProposalFailure =
  | { readonly ok: false; readonly code: 'FINALIZED' | 'LIMIT_EXCEEDED' }
  | {
      readonly ok: false;
      readonly code: 'UNKNOWN_FINDING';
      readonly id: string;
      readonly validFindingIds: readonly string[];
    };

/** Draft review that records findings until one submission seals it. */
export interface ReviewRecorder {
  record(
    input: ReviewFindingInput,
  ): { readonly ok: true; readonly id: string; readonly recorded: number } | ProposalFailure;
  submit(findingIds: readonly string[], summary: string): { readonly ok: true } | ProposalFailure;
}

const FINALIZED = { ok: false, code: 'FINALIZED' } as const;

function sameFinding(left: ReviewFindingInput, right: ReviewFindingInput): boolean {
  return (
    left.path === right.path &&
    left.side === right.side &&
    left.line === right.line &&
    left.startLine === right.startLine &&
    left.body === right.body
  );
}

interface Submission {
  readonly findingIds: readonly string[];
  readonly summary: string;
}

function sameSubmission(left: Submission, right: Submission): boolean {
  return (
    left.summary === right.summary &&
    left.findingIds.length === right.findingIds.length &&
    left.findingIds.every((id, index) => id === right.findingIds[index])
  );
}

/** Creates a recorder that writes the proposal file once on submission. */
export function createReviewRecorder(proposalPath: string): ReviewRecorder {
  const findings: ReviewFinding[] = [];
  let submitted: Submission | undefined;

  return {
    record(input) {
      if (submitted) return FINALIZED;

      const existing = findings.find((finding) => sameFinding(finding, input));
      if (existing) return { ok: true, id: existing.id, recorded: findings.length };
      if (findings.length >= REVIEW_LIMITS.recordedFindings) {
        return { ok: false, code: 'LIMIT_EXCEEDED' };
      }

      const finding = { id: `f${findings.length + 1}`, ...input };
      findings.push(finding);
      return { ok: true, id: finding.id, recorded: findings.length };
    },

    submit(findingIds, summary) {
      if (submitted) {
        return sameSubmission(submitted, { findingIds, summary }) ? { ok: true } : FINALIZED;
      }

      const selected: ReviewFinding[] = [];
      for (const id of findingIds) {
        const finding = findings.find((candidate) => candidate.id === id);
        if (!finding) {
          return {
            ok: false,
            code: 'UNKNOWN_FINDING',
            id,
            validFindingIds: findings.map((candidate) => candidate.id),
          };
        }
        selected.push(finding);
      }

      writeJsonFileAtomic(proposalPath, { summary, findings: selected } satisfies ReviewProposal);
      submitted = { findingIds, summary };
      return { ok: true };
    },
  };
}

/** Reads and validates the proposal file written by the review recorder. */
export function readReviewProposal(path: string): ReviewProposal {
  const result = ReviewProposalSchema.safeParse(readJsonFile(path));
  if (!result.success) {
    throw new Error(`Invalid review proposal in ${path}\n${z.prettifyError(result.error)}`, {
      cause: result.error,
    });
  }
  return result.data;
}
