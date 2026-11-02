import { describe, expect, it } from 'vitest';
import { paginateHunks, paginateItems } from '../../src/review/pages.js';

const MAX_LINE_LENGTH = 2_000;

const header = '@@ -1 +1 @@';

function line(length: number): string {
  return 'x'.repeat(length);
}

describe('paginateHunks', () => {
  it.each([
    {
      name: 'keeps a line at the limit',
      source: line(MAX_LINE_LENGTH),
      expected: line(MAX_LINE_LENGTH),
    },
    {
      name: 'truncates a longer line',
      source: line(MAX_LINE_LENGTH + 5),
      expected: `${line(MAX_LINE_LENGTH)}… [truncated 5 chars]`,
    },
    {
      name: 'cuts before a surrogate pair straddling the limit',
      source: `${line(MAX_LINE_LENGTH - 1)}😀x`,
      expected: `${line(MAX_LINE_LENGTH - 1)}… [truncated 3 chars]`,
    },
  ])('$name', ({ source, expected }) => {
    expect(paginateHunks([{ header, lines: [source] }])).toEqual([`${header}\n${expected}\n`]);
  });

  it('fills pages up to 30,000 characters and repeats the header of a continued hunk', () => {
    const lines = Array.from({ length: 16 }, () => line(MAX_LINE_LENGTH - 1));
    const pages = paginateHunks([{ header, lines }]);

    expect(pages).toHaveLength(2);
    expect(pages.every((page) => page.length <= 30_000)).toBe(true);
    expect(pages[1]).toMatch(/^@@ -1 \+1 @@ \(continued\)\nx/);
  });

  it('starts a new page at a hunk header without marking it continued', () => {
    const full = [...Array.from({ length: 14 }, () => line(MAX_LINE_LENGTH - 1)), line(1_987)];
    const pages = paginateHunks([
      { header, lines: full },
      { header: '@@ -9 +9 @@', lines: ['+next'] },
    ]);

    expect(pages[0]).toHaveLength(30_000);
    expect(pages[1]).toBe('@@ -9 +9 @@\n+next\n');
  });
});

describe('paginateItems', () => {
  it('returns one empty page for no items', () => {
    expect(paginateItems([], () => 1)).toEqual([[]]);
  });

  it('fills pages up to 30,000 and keeps an oversized item on its own page', () => {
    expect(paginateItems([20_000, 10_000, 1, 40_000, 1], (size) => size)).toEqual([
      [20_000, 10_000],
      [1],
      [40_000],
      [1],
    ]);
  });
});
