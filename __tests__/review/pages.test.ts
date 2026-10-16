import { describe, expect, it } from 'vitest';
import { paginatePatchLines } from '../../src/review/pages.js';

function anchoredLine(anchor: string, length: number): string {
  return `${anchor}${'x'.repeat(length - anchor.length - 1)}\n`;
}

describe('paginatePatchLines', () => {
  it('returns no pages for no lines', () => {
    expect(paginatePatchLines([])).toEqual([]);
  });

  it('keeps a line with exactly 2,000 content characters unchanged', () => {
    const line = anchoredLine('R1 +', 2_001);

    expect(paginatePatchLines([line])).toEqual([line]);
  });

  it('truncates longer lines while keeping the anchor', () => {
    const line = anchoredLine('R27 +', 2_002);

    expect(paginatePatchLines([line])).toEqual([`${line.slice(0, 2_000)} [line truncated]\n`]);
  });

  it.each([
    {
      name: 'cuts before a surrogate pair straddling the cap',
      content: `${'x'.repeat(1_999)}😀x`,
      expected: `${'x'.repeat(1_999)} [line truncated]\n`,
    },
    {
      name: 'keeps a surrogate pair fully inside the cap',
      content: `${'x'.repeat(1_998)}😀x`,
      expected: `${'x'.repeat(1_998)}😀 [line truncated]\n`,
    },
  ])('$name', ({ content, expected }) => {
    expect(paginatePatchLines([`${content}\n`])).toEqual([expected]);
  });

  it('greedily fills a page to exactly 12,000 characters', () => {
    const lines = Array.from({ length: 6 }, (_, index) => anchoredLine(`R${index + 1} +`, 2_000));

    expect(paginatePatchLines(lines)).toEqual([lines.join('')]);
  });

  it('splits at 12,001 characters and bounds every page', () => {
    const lines = [
      ...Array.from({ length: 5 }, (_, index) => anchoredLine(`R${index + 1} +`, 2_000)),
      anchoredLine('R6 +', 1_998),
      'R7\n',
    ];
    const pages = paginatePatchLines(lines);

    expect(pages).toEqual([lines.slice(0, 6).join(''), lines[6]]);
    expect(pages.every((page) => page.length <= 12_000)).toBe(true);
  });
});
