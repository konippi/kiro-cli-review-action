import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ReviewWorkspace } from './workspace.js';

const INPUT_SCHEMA = z.strictObject({});

/** Registers the tool for reading pull request context. */
export function registerGetReviewContextTool(server: McpServer, workspace: ReviewWorkspace): void {
  function getReviewContext(): CallToolResult {
    return { content: [{ type: 'text', text: workspace.context }] };
  }

  server.registerTool(
    'get_review_context',
    {
      description: 'Read pull request metadata and the changed-file list.',
      inputSchema: INPUT_SCHEMA,
    },
    getReviewContext,
  );
}
