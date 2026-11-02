import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { type AnchorFailure, validateAnchor } from '../../review/diff.js';
import { REVIEW_LIMITS } from '../../review/proposal.js';
import type { ReviewWorkspace } from '../workspace.js';
import { fail, findPatch, ok, proposalError } from './result.js';

const INPUT_SCHEMA = z.strictObject({
  path: z.string().regex(/\S/).describe('A path from get_review_context.'),
  side: z.enum(['RIGHT', 'LEFT']).describe('RIGHT for an R anchor, LEFT for an L anchor.'),
  line: z.number().int().min(1).describe('Anchor number. For a range, its last line.'),
  start_line: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('First line of a range, on the same side and in the same @@ hunk as line.'),
  body: z
    .string()
    .max(REVIEW_LIMITS.findingBody)
    .regex(/\S/)
    .describe('Markdown: the problem, when it occurs, and the fix.'),
});

function anchorError(
  failure: AnchorFailure,
  { path, side, line, start_line }: z.infer<typeof INPUT_SCHEMA>,
): CallToolResult {
  switch (failure.code) {
    case 'UNSUPPORTED_SIDE':
      return fail(
        failure.code,
        `Renamed file ${path} has no commentable LEFT lines. Anchor to an R line or use the summary.`,
      );
    case 'RANGE_ORDER':
      return fail(failure.code, 'start_line must be less than line.');
    case 'OUTSIDE_DIFF':
      return fail(
        failure.code,
        `${side} line ${line} is not in the diff of ${path}. Pick a line in allowed_ranges or use the summary.`,
        {
          allowed_ranges: failure.allowed,
        },
      );
    case 'INVALID_RANGE':
      return fail(
        failure.code,
        `${side} lines ${start_line}-${line} are not all in one hunk of ${path}. Keep them in one allowed_ranges entry.`,
        { allowed_ranges: failure.allowed },
      );
  }
}

/** Registers the tool for recording one inline review finding. */
export function registerAddReviewFindingTool(server: McpServer, workspace: ReviewWorkspace): void {
  function addReviewFinding(input: z.infer<typeof INPUT_SCHEMA>): CallToolResult {
    const { path, side, line, start_line: startLine, body } = input;
    const found = findPatch(workspace, path);
    if (!found.ok) return found.error;

    const anchor = { side, line, ...(startLine === undefined ? {} : { startLine }) };
    const validation = validateAnchor(found.patch.anchors, anchor);
    if (!validation.ok) return anchorError(validation, input);

    const result = workspace.recorder.record({ path, ...anchor, body });
    if (!result.ok) return proposalError(result);

    return ok({
      finding_id: result.id,
      recorded: result.recorded,
      max_recorded: REVIEW_LIMITS.recordedFindings,
    });
  }

  server.registerTool(
    'add_review_finding',
    {
      title: 'Add review finding',
      description: `Records one inline finding in the draft review and returns its finding_id. Nothing is posted until submit_review publishes the findings you select. Up to ${REVIEW_LIMITS.recordedFindings} can be recorded.`,
      inputSchema: INPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    addReviewFinding,
  );
}
