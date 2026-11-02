import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { toErrorMessage } from '../../errors.js';
import { REVIEW_LIMITS } from '../../review/proposal.js';
import type { ReviewWorkspace } from '../workspace.js';
import { fail, ok, proposalError } from './result.js';

const INPUT_SCHEMA = z.strictObject({
  finding_ids: z
    .array(z.string())
    .max(REVIEW_LIMITS.publishedFindings)
    .refine((ids) => new Set(ids).size === ids.length, 'finding_ids must be unique')
    .describe('Unique finding_ids to publish, most important first. May be empty.'),
  summary: z
    .string()
    .max(REVIEW_LIMITS.summaryBody)
    .regex(/\S/)
    .describe(
      'Markdown review body: overall assessment plus issues that cannot be anchored to a diff line.',
    ),
});

/** Registers the tool for sealing selected findings and the review summary. */
export function registerSubmitReviewTool(server: McpServer, workspace: ReviewWorkspace): void {
  function submitReview({
    finding_ids: findingIds,
    summary,
  }: z.infer<typeof INPUT_SCHEMA>): CallToolResult {
    try {
      const result = workspace.recorder.submit(findingIds, summary);
      if (!result.ok) return proposalError(result);
    } catch (error: unknown) {
      process.stderr.write(`Review proposal could not be written: ${toErrorMessage(error)}\n`);
      return fail('STATE_ERROR', 'The review could not be saved. Retry the same call.');
    }

    const count = findingIds.length;
    return ok(
      `Saved ${count} inline finding${count === 1 ? '' : 's'}. The review is posted after this session.`,
    );
  }

  server.registerTool(
    'submit_review',
    {
      title: 'Submit review',
      description:
        'Ends the review: saves the summary and the selected findings, discards the rest, and posts it after the session. Call it once, last, even with no findings.',
      inputSchema: INPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    submitReview,
  );
}
