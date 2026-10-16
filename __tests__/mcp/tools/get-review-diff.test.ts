import { afterAll, describe, expect, it } from 'vitest';
import { createToolFixture, textResult } from './helpers.js';

const paginationHeader = '@@ -0,0 +1,7 @@\n';
const pageLine = 'x'.repeat(2_000 - 'R1 +'.length);
const fixture = createToolFixture([
  { filename: 'modified.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' },
  {
    filename: 'paginated.ts',
    status: 'added',
    patch: `${paginationHeader}${Array.from({ length: 7 }, () => `+${pageLine}`).join('\n')}`,
  },
  { filename: 'malformed.ts', status: 'modified', patch: '@@ -1 +1 @@\ninvalid' },
  { filename: 'binary.dat', status: 'modified' },
]);

afterAll(async () => {
  await fixture.close();
});

describe('get_review_diff tool', () => {
  it('returns patch metadata and maps path and patch failures', async () => {
    const client = await fixture.connect();
    const path = 'modified.ts';
    expect(
      textResult(await client.callTool({ name: 'get_review_diff', arguments: { path } })),
    ).toEqual({
      ok: true,
      path,
      page: 1,
      total_pages: 1,
      has_more: false,
      patch: expect.any(String),
    });

    for (const [path, code, retryable] of [
      ['missing.ts', 'UNKNOWN_PATH', true],
      ['binary.dat', 'NO_PATCH', false],
      ['malformed.ts', 'NO_PATCH', false],
    ] as const) {
      expect(
        textResult(await client.callTool({ name: 'get_review_diff', arguments: { path } })),
      ).toMatchObject({ code, retryable });
    }
  });

  it('maps page selection to response metadata', async () => {
    const client = await fixture.connect();
    for (const [page, hasMore] of [
      [1, true],
      [2, false],
    ] as const) {
      expect(
        textResult(
          await client.callTool({
            name: 'get_review_diff',
            arguments: { path: 'paginated.ts', page },
          }),
        ),
      ).toMatchObject({ page, total_pages: 2, has_more: hasMore });
    }
    expect(
      textResult(
        await client.callTool({
          name: 'get_review_diff',
          arguments: { path: 'paginated.ts', page: 3 },
        }),
      ),
    ).toMatchObject({ code: 'INVALID_PAGE', retryable: true });
  });
});
