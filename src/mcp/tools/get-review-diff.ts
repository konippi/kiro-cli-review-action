import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { numberPatchLines } from '../../review/diff.js';
import { paginatePatchLines } from '../../review/pages.js';
import { fail, ok } from './result.js';
import type { ReviewWorkspace } from './workspace.js';

const INPUT_SCHEMA = z.strictObject({
  path: z.string().regex(/\S/),
  page: z.number().int().min(1).optional(),
});

/** Registers the tool for reading one page of a changed file patch. */
export function registerGetReviewDiffTool(server: McpServer, workspace: ReviewWorkspace): void {
  function getReviewDiff(arguments_: z.infer<typeof INPUT_SCHEMA>): CallToolResult {
    const file = workspace.files.get(arguments_.path);
    if (!file) return fail('UNKNOWN_PATH', 'Path is not in the pull request', true);

    const renamed = file.status === 'renamed';
    const lines = file.patch === undefined ? null : numberPatchLines(file.patch, renamed);
    if (!lines) return fail('NO_PATCH', 'Path has no text patch', false);

    const page = arguments_.page ?? 1;
    const patchPages = paginatePatchLines(lines);
    if (page > patchPages.length) {
      return fail('INVALID_PAGE', `Page must be from 1 to ${patchPages.length}`, true);
    }

    return ok({
      path: file.filename,
      page,
      total_pages: patchPages.length,
      has_more: page < patchPages.length,
      patch: patchPages[page - 1],
    });
  }

  server.registerTool(
    'get_review_diff',
    {
      description:
        'Read one page of a changed file patch. Each line starts with its add_review_finding anchor (R<line> or L<line>).',
      inputSchema: INPUT_SCHEMA,
    },
    getReviewDiff,
  );
}
