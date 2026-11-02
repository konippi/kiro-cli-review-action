import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ReviewWorkspace } from '../workspace.js';
import { fail, findPatch, ok } from './result.js';

const INPUT_SCHEMA = z.strictObject({
  path: z.string().regex(/\S/).describe('A path from get_review_context.'),
  page: z.number().int().min(1).optional().describe("Up to the file's diff_pages. Defaults to 1."),
});

/** Registers the tool for reading one page of a changed file patch. */
export function registerGetReviewDiffTool(server: McpServer, workspace: ReviewWorkspace): void {
  function getReviewDiff({ path, page = 1 }: z.infer<typeof INPUT_SCHEMA>): CallToolResult {
    const found = findPatch(workspace, path);
    if (!found.ok) return found.error;

    const { pages } = found.patch;
    const text = pages[page - 1];
    if (text === undefined) {
      return fail('INVALID_PAGE', `${path} has no page ${page}.`, { total_pages: pages.length });
    }

    return ok({ path, page, total_pages: pages.length }, text);
  }

  server.registerTool(
    'get_review_diff',
    {
      title: 'Get review diff',
      description:
        "Returns one page of a changed file's diff. Commentable lines start with an anchor: R<n> for a new-file line, L<n> for an old-file line. Lines without an anchor cannot be commented on.",
      inputSchema: INPUT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    getReviewDiff,
  );
}
