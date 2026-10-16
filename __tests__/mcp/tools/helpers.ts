import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { writeJsonFile } from '../../../src/fs.js';
import { isPlainObject } from '../../../src/guards.js';
import { createReviewServer } from '../../../src/mcp/server.js';
import type { PullRequestFile } from '../../../src/review/diff.js';
import { reviewWorkspacePaths } from '../../../src/review/layout.js';

interface ToolFixture {
  readonly directory: string;
  connect(): Promise<Client>;
  close(): Promise<void>;
}

export async function connectReviewServer(directory: string): Promise<Client> {
  const server = createReviewServer({ directory });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

export function textResult(
  result: Awaited<ReturnType<Client['callTool']>>,
): Record<string, unknown> {
  if (!isPlainObject(result) || !Array.isArray(result.content)) throw new Error('Expected content');
  const content: unknown = result.content[0];
  if (!isPlainObject(content) || content.type !== 'text' || typeof content.text !== 'string') {
    throw new Error('Expected text content');
  }
  const parsed: unknown = JSON.parse(content.text);
  if (!isPlainObject(parsed)) throw new Error('Expected object content');
  return parsed;
}

export function createToolFixture(files: readonly PullRequestFile[]): ToolFixture {
  const directory = mkdtempSync(join(tmpdir(), 'kiro-review-tools-'));
  let client: Client | undefined;
  const paths = reviewWorkspacePaths(directory);
  writeJsonFile(paths.context, { number: 1 });
  writeJsonFile(paths.patches, { files });

  async function connect(): Promise<Client> {
    const connected = await connectReviewServer(directory);
    client = connected;
    return connected;
  }

  async function close(): Promise<void> {
    await client?.close();
    client = undefined;
    rmSync(directory, { recursive: true, force: true });
  }

  return { directory, connect, close };
}
