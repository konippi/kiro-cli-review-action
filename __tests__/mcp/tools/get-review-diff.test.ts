import { describe, expect, it } from 'vitest';
import { callTool, callToolError, connectReviewTools } from '../helpers.js';

const files = [
  { filename: 'a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' },
  { filename: 'binary.dat', status: 'modified' },
];

describe('get_review_diff tool', () => {
  it('returns page metadata followed by the anchored diff as plain text', async () => {
    const { client } = await connectReviewTools(files);

    expect(await callTool(client, 'get_review_diff', { path: 'a.ts' })).toEqual([
      { path: 'a.ts', page: 1, total_pages: 1 },
      '@@ -1 +1 @@\nL1 -old\nR1 +new\n',
    ]);
  });

  it.each([
    { name: 'an unknown path', input: { path: 'missing.ts' }, expected: { error: 'UNKNOWN_PATH' } },
    {
      name: 'a file without a patch',
      input: { path: 'binary.dat' },
      expected: { error: 'NO_PATCH' },
    },
    {
      name: 'a page past the end',
      input: { path: 'a.ts', page: 2 },
      expected: { error: 'INVALID_PAGE', total_pages: 1 },
    },
  ])('rejects $name', async ({ input, expected }) => {
    const { client } = await connectReviewTools(files);

    expect(await callToolError(client, 'get_review_diff', input)).toMatchObject({
      ...expected,
      message: expect.any(String),
    });
  });
});
