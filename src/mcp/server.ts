import { McpServer } from '@modelcontextprotocol/server';
import packageJson from '../../package.json' with { type: 'json' };
import { registerReviewTools } from './tools/index.js';
import { loadReviewWorkspace } from './tools/workspace.js';

interface ReviewServerOptions {
  readonly directory: string;
}

/** Creates a credential-free MCP server exposing only review proposal tools. */
export function createReviewServer(options: ReviewServerOptions): McpServer {
  const workspace = loadReviewWorkspace(options.directory);
  const server = new McpServer({
    name: 'kiro-review',
    version: packageJson.version,
  });
  registerReviewTools(server, workspace);
  return server;
}
