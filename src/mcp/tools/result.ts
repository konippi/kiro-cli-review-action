import type { CallToolResult } from '@modelcontextprotocol/server';
import type { AnchorFailure } from '../../review/diff.js';
import { type ProposalFailure, REVIEW_LIMITS } from '../../review/proposal.js';
import type { ReviewPatch, ReviewWorkspace } from '../workspace.js';

type ToolErrorCode =
  | AnchorFailure['code']
  | ProposalFailure['code']
  | 'UNKNOWN_PATH'
  | 'NO_PATCH'
  | 'INVALID_PAGE'
  | 'STATE_ERROR';

/** Returns text content: strings as-is, anything else as JSON. */
export function ok(...contents: readonly (string | object)[]): CallToolResult {
  return {
    content: contents.map((content) => ({
      type: 'text',
      text: typeof content === 'string' ? content : JSON.stringify(content),
    })),
  };
}

/** Returns a tool error whose body starts with its code, since some clients hide isError from the model. */
export function fail(
  code: ToolErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: code, message, ...details }),
      },
    ],
    isError: true,
  };
}

/** Converts a recorder failure into a tool error. */
export function proposalError(failure: ProposalFailure): CallToolResult {
  switch (failure.code) {
    case 'FINALIZED':
      return fail(failure.code, 'The review was already submitted. Stop calling review tools.');
    case 'LIMIT_EXCEEDED':
      return fail(
        failure.code,
        `The draft already has ${REVIEW_LIMITS.recordedFindings} findings. Call submit_review with the most important ones.`,
      );
    case 'UNKNOWN_FINDING':
      return fail(failure.code, `${failure.id} is not a recorded finding.`, {
        valid_finding_ids: failure.validFindingIds,
      });
  }
}

/** Looks up a changed file with a text patch, or the tool error explaining why there is none. */
export function findPatch(
  workspace: ReviewWorkspace,
  path: string,
):
  | { readonly ok: true; readonly patch: ReviewPatch }
  | { readonly ok: false; readonly error: CallToolResult } {
  const patch = workspace.files.get(path);
  if (patch === undefined) {
    return {
      ok: false,
      error: fail(
        'UNKNOWN_PATH',
        `${path} is not a changed file. Use a path from get_review_context.`,
      ),
    };
  }
  if (patch === null) {
    return {
      ok: false,
      error: fail('NO_PATCH', `${path} has no diff. Report its issues in the summary.`),
    };
  }
  return { ok: true, patch };
}
