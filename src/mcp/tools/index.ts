import type { McpServer } from '@modelcontextprotocol/server';
import type { ReviewWorkspace } from '../workspace.js';
import { registerAddReviewFindingTool } from './add-review-finding.js';
import { registerGetReviewContextTool } from './get-review-context.js';
import { registerGetReviewDiffTool } from './get-review-diff.js';
import { registerSubmitReviewTool } from './submit-review.js';

/** Registers all credential-free review proposal tools. */
export function registerReviewTools(server: McpServer, workspace: ReviewWorkspace): void {
  registerGetReviewContextTool(server, workspace);
  registerGetReviewDiffTool(server, workspace);
  registerAddReviewFindingTool(server, workspace);
  registerSubmitReviewTool(server, workspace);
}
