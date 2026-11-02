import { type CallToolResult, Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { expect, onTestFinished } from 'vitest';
import { writeJsonFile } from '../../src/fs.js';
import { createReviewServer } from '../../src/mcp/server.js';
import {
  type PullRequestFile,
  type ReviewInput,
  reviewWorkspacePaths,
} from '../../src/review/input.js';
import { createTemporaryDirectory } from '../helpers/temporary-directory.js';

type FileFixture = Pick<PullRequestFile, 'filename' | 'status' | 'patch'> &
  Partial<PullRequestFile>;

type ReviewPullRequest = ReviewInput['pullRequest'];

interface ReviewTools {
  readonly client: Client;
  readonly directory: string;
}

function parseContents(result: CallToolResult): unknown[] {
  return result.content.map((content) => {
    if (content.type !== 'text') throw new Error('Expected text content');
    try {
      return JSON.parse(content.text);
    } catch {
      return content.text;
    }
  });
}

/** Connects a client to a review server over the given files, closing both when the test finishes. */
export async function connectReviewTools(
  files: readonly FileFixture[],
  pullRequest: Partial<ReviewPullRequest> = {},
): Promise<ReviewTools> {
  const directory = createTemporaryDirectory();
  writeJsonFile(reviewWorkspacePaths(directory).input, {
    pullRequest: {
      number: 1,
      title: 'Add feature',
      body: 'Description',
      author: 'octocat',
      baseRef: 'main',
      headRef: 'feature',
      changedFiles: files.length,
      ...pullRequest,
    },
    files: files.map((file) => ({ additions: 0, deletions: 0, ...file })),
  });

  const server = createReviewServer({ directory });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  onTestFinished(() => client.close());
  return { client, directory };
}

/** Calls a tool that must succeed and returns its text blocks, parsing JSON blocks. */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown[]> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return parseContents(result);
}

/** Calls a tool that must fail and returns its error body. */
export async function callToolError(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).toBe(true);
  return parseContents(result)[0];
}
