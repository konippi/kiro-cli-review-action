import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { finalizeReview, REVIEW_LIMITS } from '../../review/proposal.js';
import { fail, mutationError, ok } from './result.js';
import type { ReviewWorkspace } from './workspace.js';

function hasUniqueFindingIds(findingIds: readonly string[]): boolean {
  return new Set(findingIds).size === findingIds.length;
}

const INPUT_SCHEMA = z.strictObject({
  finding_ids: z
    .array(z.string())
    .max(REVIEW_LIMITS.publishedFindings)
    .refine(hasUniqueFindingIds, 'Finding IDs must be unique')
    .describe('IDs from add_review_finding to post.'),
  summary: z.string().max(REVIEW_LIMITS.summaryBody).regex(/\S/),
});

/** Registers the tool for sealing selected findings and the review summary. */
export function registerSubmitReviewTool(server: McpServer, workspace: ReviewWorkspace): void {
  function submitReview(arguments_: z.infer<typeof INPUT_SCHEMA>): CallToolResult {
    try {
      const result = finalizeReview(
        workspace.state,
        workspace.proposalPath,
        arguments_.finding_ids,
        arguments_.summary,
      );
      if (!result.ok) return mutationError(result);

      return ok({ posted: false });
    } catch {
      return fail('STATE_ERROR', 'Review proposal could not be written', true);
    }
  }

  server.registerTool(
    'submit_review',
    {
      description:
        'Seal the selected findings and summary for the action to post. Call once, even with no findings.',
      inputSchema: INPUT_SCHEMA,
    },
    submitReview,
  );
}
