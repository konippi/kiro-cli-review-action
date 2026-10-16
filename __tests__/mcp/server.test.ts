import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import { writeJsonFile } from '../../src/fs.js';
import { reviewWorkspacePaths } from '../../src/review/layout.js';
import { REVIEW_LIMITS } from '../../src/review/proposal.js';
import { connectReviewServer } from './tools/helpers.js';

let directory = '';
let client: Client | undefined;

async function connect(): Promise<Client> {
  const connected = await connectReviewServer(directory);
  client = connected;
  return connected;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'kiro-review-protocol-'));
  const paths = reviewWorkspacePaths(directory);
  writeJsonFile(paths.context, { number: 1 });
  writeJsonFile(paths.patches, { files: [] });
});

afterEach(async () => {
  await client?.close();
  client = undefined;
  rmSync(directory, { recursive: true, force: true });
});

describe('review MCP server', () => {
  it('loads the workspace and advertises its identity and four review tools', async () => {
    const connected = await connect();
    expect(connected.getServerVersion()).toEqual({
      name: 'kiro-review',
      version: packageJson.version,
    });

    const tools = (await connected.listTools()).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      'get_review_context',
      'get_review_diff',
      'add_review_finding',
      'submit_review',
    ]);
    expect(tools.find((tool) => tool.name === 'get_review_context')).toMatchObject({
      description: 'Read pull request metadata and the changed-file list.',
    });
    expect(tools.find((tool) => tool.name === 'get_review_diff')).toMatchObject({
      description:
        'Read one page of a changed file patch. Each line starts with its add_review_finding anchor (R<line> or L<line>).',
    });
    const addTool = tools.find((tool) => tool.name === 'add_review_finding');
    expect(addTool).toMatchObject({
      description: 'Record one inline finding in the local draft.',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        additionalProperties: false,
        required: ['path', 'side', 'line', 'body'],
        properties: {
          side: { description: 'RIGHT for new lines, LEFT for removed lines.' },
          line: { maximum: Number.MAX_SAFE_INTEGER },
          start_line: {
            description: 'First line of a multi-line range.',
            maximum: Number.MAX_SAFE_INTEGER,
          },
          body: { maxLength: REVIEW_LIMITS.findingBody, pattern: '\\S' },
        },
      },
    });
    expect(addTool?.inputSchema.properties?.line).not.toHaveProperty('description');
    const submitTool = tools.find((tool) => tool.name === 'submit_review');
    expect(submitTool).toMatchObject({
      description:
        'Seal the selected findings and summary for the action to post. Call once, even with no findings.',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        additionalProperties: false,
        required: ['finding_ids', 'summary'],
        properties: {
          finding_ids: {
            items: { type: 'string' },
            maxItems: REVIEW_LIMITS.publishedFindings,
            description: 'IDs from add_review_finding to post.',
          },
          summary: { maxLength: REVIEW_LIMITS.summaryBody, pattern: '\\S' },
        },
      },
    });
    expect(submitTool?.inputSchema.properties?.finding_ids).not.toHaveProperty('uniqueItems');
    expect(submitTool?.inputSchema.properties?.finding_ids).not.toHaveProperty('items.pattern');
    expect(submitTool?.inputSchema.properties?.summary).not.toHaveProperty('description');
    expect(JSON.stringify(tools)).not.toMatch(/"minLength"|owner|repo|pull_number|sha|event/);
    expect(tools.every((tool) => !('mutation' in tool))).toBe(true);
  });
});
