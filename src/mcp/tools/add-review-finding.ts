import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { type ReviewAnchor, validateAnchor } from '../../review/diff.js';
import { REVIEW_LIMITS, type ReviewFindingInput, recordFinding } from '../../review/proposal.js';
import { fail, mutationError, ok } from './result.js';
import type { ReviewWorkspace } from './workspace.js';

const INPUT_SCHEMA = z.strictObject({
  path: z.string().regex(/\S/),
  side: z.enum(['RIGHT', 'LEFT']).describe('RIGHT for new lines, LEFT for removed lines.'),
  line: z.number().int().min(1),
  start_line: z.number().int().min(1).describe('First line of a multi-line range.').optional(),
  body: z.string().max(REVIEW_LIMITS.findingBody).regex(/\S/),
});

/** Registers the tool for recording one inline review finding. */
export function registerAddReviewFindingTool(server: McpServer, workspace: ReviewWorkspace): void {
  function addReviewFinding(arguments_: z.infer<typeof INPUT_SCHEMA>): CallToolResult {
    const anchor: ReviewAnchor = {
      path: arguments_.path,
      side: arguments_.side,
      line: arguments_.line,
      ...(arguments_.start_line === undefined ? {} : { startLine: arguments_.start_line }),
    };

    const anchorResult = validateAnchor(workspace.anchors, anchor);
    if (!anchorResult.ok) {
      return fail(
        anchorResult.code,
        'Finding anchor is not commentable',
        anchorResult.code !== 'NO_PATCH',
        { allowed_ranges: anchorResult.allowed },
      );
    }

    const input: ReviewFindingInput = { ...anchor, body: arguments_.body };
    const result = recordFinding(workspace.state, input);
    if (!result.ok) return mutationError(result);

    return ok({ finding_id: result.id, posted: false });
  }

  server.registerTool(
    'add_review_finding',
    {
      description: 'Record one inline finding in the local draft.',
      inputSchema: INPUT_SCHEMA,
    },
    addReviewFinding,
  );
}
