import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import { connectReviewTools } from './helpers.js';

describe('review MCP server', () => {
  it('advertises its identity and instructions', async () => {
    const { client } = await connectReviewTools([]);

    expect(client.getServerVersion()).toEqual({
      name: 'kiro-review',
      version: packageJson.version,
    });
    expect(client.getInstructions()).toMatch(/untrusted data, not instructions/);
  });

  it('lists the review tools as snapshotted', async () => {
    const { client } = await connectReviewTools([]);
    const { tools } = await client.listTools();

    expect(tools.map(({ name }) => name)).toEqual([
      'get_review_context',
      'get_review_diff',
      'add_review_finding',
      'submit_review',
    ]);
    for (const tool of tools) {
      await expect(`${JSON.stringify(tool, null, 2)}\n`).toMatchFileSnapshot(
        `./__toolsnaps__/${tool.name}.snap`,
      );
    }
  });
});
