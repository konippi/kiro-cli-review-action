import { describe, expect, it } from 'vitest';
import {
  anchorHunkLines,
  type FileAnchors,
  indexAnchors,
  parsePatch,
  validateAnchor,
} from '../../src/review/diff.js';

const twoHunkPatch = [
  '@@ -10,5 +10,6 @@ function example() {',
  ' context',
  '-removed',
  '+added',
  '+another',
  ' shared',
  '-old tail',
  '+new tail',
  ' end',
  '@@ -30,2 +31,2 @@',
  '-before',
  '+after',
  ' stable',
].join('\n');

function anchorsOf(patch: string, renamed = false): FileAnchors {
  const hunks = parsePatch(patch);
  if (!hunks) throw new Error('Expected a valid patch');
  return indexAnchors(hunks, renamed);
}

describe('anchorHunkLines', () => {
  it('prefixes lines with their anchors and leaves renamed deletions unanchored', () => {
    const [hunk] =
      parsePatch('@@ -10,2 +20,3 @@\n context\n-old\n+new\n\\ No newline at end of file') ?? [];
    if (!hunk) throw new Error('Expected a hunk');

    expect(anchorHunkLines(hunk, false)).toEqual([
      'R20  context',
      'L11 -old',
      'R21 +new',
      '\\ No newline at end of file',
    ]);
    expect(anchorHunkLines(hunk, true)).toContain('-old');
  });
});

describe('validateAnchor', () => {
  const anchors = anchorsOf(twoHunkPatch);

  it.each([
    { name: 'an added line', anchor: { side: 'RIGHT', line: 12 } },
    { name: 'a removed line', anchor: { side: 'LEFT', line: 11 } },
    { name: 'a range within one hunk', anchor: { side: 'RIGHT', startLine: 12, line: 15 } },
  ] as const)('accepts $name', ({ anchor }) => {
    expect(validateAnchor(anchors, anchor)).toEqual({ ok: true });
  });

  it.each([
    {
      name: 'a line outside the diff',
      anchor: { side: 'RIGHT', line: 16 },
      expected: { code: 'OUTSIDE_DIFF', allowed: ['10-15', '31-32'] },
    },
    {
      name: 'a range with a gap',
      anchor: { side: 'LEFT', startLine: 11, line: 13 },
      expected: { code: 'INVALID_RANGE', allowed: ['11', '13', '30'] },
    },
    {
      name: 'a range across hunks',
      anchor: { side: 'RIGHT', startLine: 15, line: 31 },
      expected: { code: 'INVALID_RANGE' },
    },
    {
      name: 'a reversed range',
      anchor: { side: 'RIGHT', startLine: 12, line: 12 },
      expected: { code: 'RANGE_ORDER' },
    },
  ] as const)('rejects $name', ({ anchor, expected }) => {
    expect(validateAnchor(anchors, anchor)).toMatchObject({ ok: false, ...expected });
  });

  it('rejects LEFT anchors on renamed files', () => {
    expect(
      validateAnchor(anchorsOf('@@ -1 +1 @@\n-old\n+new', true), { side: 'LEFT', line: 1 }),
    ).toEqual({
      ok: false,
      code: 'UNSUPPORTED_SIDE',
    });
  });
});

describe('parsePatch', () => {
  it.each([
    {
      name: 'a zero-count add',
      patch: '@@ -0,0 +1,2 @@\n+one\n+two',
      anchor: { side: 'RIGHT', line: 2 },
    },
    {
      name: 'a zero-count delete',
      patch: '@@ -3,2 +2,0 @@\n-old\n-gone',
      anchor: { side: 'LEFT', line: 4 },
    },
    {
      name: 'CRLF line endings',
      patch: '@@ -1 +1 @@\r\n-old\r\n+new\r',
      anchor: { side: 'RIGHT', line: 1 },
    },
  ] as const)('accepts $name', ({ patch, anchor }) => {
    expect(validateAnchor(anchorsOf(patch), anchor)).toEqual({ ok: true });
  });

  it.each([
    { name: 'an invalid body prefix', patch: '@@ -1 +1 @@\ninvalid' },
    { name: 'a partial hunk header', patch: '@@ -1 +1 @@invalid\n-old\n+new' },
    { name: 'an unsafe line start', patch: '@@ -9007199254740992 +1 @@\n-old\n+new' },
  ])('rejects $name', ({ patch }) => {
    expect(parsePatch(patch)).toBeNull();
  });
});
