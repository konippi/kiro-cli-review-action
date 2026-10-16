import type { CallToolResult } from '@modelcontextprotocol/server';
import type { ProposalFailure } from '../../review/proposal.js';

/** Returns a structured successful MCP tool result. */
export function ok(value: Readonly<Record<string, unknown>>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: true, ...value }) }],
  };
}

/** Returns a structured MCP tool failure. */
export function fail(
  code: string,
  message: string,
  retryable: boolean,
  details?: Readonly<Record<string, unknown>>,
): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ ok: false, code, message, retryable, ...details }),
      },
    ],
    isError: true,
  };
}

/** Converts a proposal mutation failure into an MCP tool failure. */
export function mutationError(failure: ProposalFailure): CallToolResult {
  const details =
    failure.validFindingIds === undefined
      ? undefined
      : { valid_finding_ids: failure.validFindingIds };
  return fail(failure.code, failure.message, failure.code === 'UNKNOWN_FINDING', details);
}
