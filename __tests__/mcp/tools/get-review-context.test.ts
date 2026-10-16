import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { reviewWorkspacePaths } from '../../../src/review/layout.js';
import { createToolFixture } from './helpers.js';

const fixture = createToolFixture([]);

afterEach(async () => {
  await fixture.close();
});

describe('get_review_context tool', () => {
  it('returns context unchanged', async () => {
    const context = '{"number":1,  "spacing":"preserved"}\n\n';
    writeFileSync(reviewWorkspacePaths(fixture.directory).context, context);
    const client = await fixture.connect();

    expect(await client.callTool({ name: 'get_review_context', arguments: {} })).toMatchObject({
      content: [{ type: 'text', text: context }],
    });
  });
});
