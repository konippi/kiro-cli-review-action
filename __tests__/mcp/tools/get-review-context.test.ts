import { describe, expect, it } from 'vitest';
import { callTool, callToolError, connectReviewTools } from '../helpers.js';

interface ContextPage {
  readonly total_pages: number;
  readonly files: readonly unknown[];
}

describe('get_review_context tool', () => {
  it('separates verified metadata from author content and lists every file', async () => {
    const { client } = await connectReviewTools(
      [
        {
          filename: 'src/new.ts',
          previous_filename: 'src/old.ts',
          status: 'renamed',
          additions: 1,
          deletions: 1,
          patch: '@@ -1 +1 @@\n-old\n+new',
        },
        { filename: 'image.png', status: 'added' },
      ],
      { changedFiles: 3 },
    );

    expect(await callTool(client, 'get_review_context')).toEqual([
      {
        page: 1,
        total_pages: 1,
        pull_request: { number: 1, author: 'octocat', base: 'main', head: 'feature' },
        author_content: { title: 'Add feature', description: 'Description' },
        omitted_files: 1,
        files: [
          {
            path: 'src/new.ts',
            previous_path: 'src/old.ts',
            status: 'renamed',
            additions: 1,
            deletions: 1,
            diff_pages: 1,
          },
          { path: 'image.png', status: 'added', additions: 0, deletions: 0, diff_pages: 0 },
        ],
      },
    ]);
  });

  it('pages a long file list and sends the metadata only on the first page', async () => {
    const { client } = await connectReviewTools(
      Array.from({ length: 500 }, (_, index) => ({
        filename: `src/${'nested/'.repeat(5)}file-${index}.ts`,
        status: 'modified',
      })),
    );
    const read = async (page: number) =>
      (await callTool(client, 'get_review_context', { page }))[0] as ContextPage;
    const first = await read(1);
    const rest: ContextPage[] = [];
    for (let page = 2; page <= first.total_pages; page += 1) rest.push(await read(page));

    expect(first.total_pages).toBeGreaterThan(1);
    expect(first).toHaveProperty('pull_request');
    expect(rest.every((page) => !('pull_request' in page))).toBe(true);
    expect([first, ...rest].flatMap((page) => page.files)).toHaveLength(500);
    expect(
      await callToolError(client, 'get_review_context', { page: first.total_pages + 1 }),
    ).toMatchObject({ error: 'INVALID_PAGE', total_pages: first.total_pages });
  });
});
