import { describe, expect, it } from 'vitest';
import { buildAnchorMap, numberPatchLines, validateAnchor } from '../../src/review/diff.js';

const patch = [
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

describe('review diff anchors', () => {
  it('numbers commentable patch lines and suppresses renamed deletions', () => {
    expect(
      numberPatchLines(
        '@@ -10,2 +20,3 @@ heading\n context\n-old\n+new\n+tail\n\\ No newline at end of file',
        false,
      ),
    ).toEqual([
      '@@ -10,2 +20,3 @@ heading\n',
      'R20  context\n',
      'L11 -old\n',
      'R21 +new\n',
      'R22 +tail\n',
      '\\ No newline at end of file\n',
    ]);
    expect(numberPatchLines('@@ -1 +1 @@\n-old\n+new', true)).toEqual([
      '@@ -1 +1 @@\n',
      '-old\n',
      'R1 +new\n',
    ]);
  });

  it('maps additions and context to RIGHT and deletions to LEFT', () => {
    const anchors = buildAnchorMap([{ filename: 'src/file.ts', status: 'modified', patch }]);

    expect(validateAnchor(anchors, { path: 'src/file.ts', side: 'RIGHT', line: 12 })).toEqual({
      ok: true,
    });
    expect(validateAnchor(anchors, { path: 'src/file.ts', side: 'LEFT', line: 11 })).toEqual({
      ok: true,
    });
    expect(validateAnchor(anchors, { path: 'src/file.ts', side: 'RIGHT', line: 16 })).toEqual({
      ok: false,
      code: 'OUTSIDE_DIFF',
      allowed: ['10-15', '31-32'],
    });
    expect(validateAnchor(anchors, { path: 'src/file.ts', side: 'LEFT', line: 12 })).toEqual({
      ok: false,
      code: 'OUTSIDE_DIFF',
      allowed: ['11', '13', '30'],
    });
  });

  it('requires multiline anchors to be ordered, contiguous, and within one hunk', () => {
    const anchors = buildAnchorMap([{ filename: 'src/file.ts', status: 'modified', patch }]);

    expect(
      validateAnchor(anchors, {
        path: 'src/file.ts',
        side: 'RIGHT',
        startLine: 12,
        line: 15,
      }),
    ).toEqual({ ok: true });
    expect(
      validateAnchor(anchors, {
        path: 'src/file.ts',
        side: 'LEFT',
        startLine: 11,
        line: 13,
      }),
    ).toEqual({ ok: false, code: 'INVALID_RANGE', allowed: ['11', '13', '30'] });
    for (const [startLine, line] of [
      [12, 12],
      [15, 12],
      [15, 31],
    ] as const) {
      expect(
        validateAnchor(anchors, { path: 'src/file.ts', side: 'RIGHT', startLine, line }),
      ).toMatchObject({ ok: false, code: 'INVALID_RANGE' });
    }
  });

  it('reports unknown and patchless paths with compact allowed ranges', () => {
    const anchors = buildAnchorMap([
      { filename: 'binary.dat', status: 'modified' },
      { filename: 'added.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+added' },
      { filename: 'src/file.ts', status: 'modified', patch },
    ]);

    expect(validateAnchor(anchors, { path: 'missing.ts', side: 'RIGHT', line: 1 })).toEqual({
      ok: false,
      code: 'UNKNOWN_PATH',
      allowed: [],
    });
    expect(validateAnchor(anchors, { path: 'binary.dat', side: 'RIGHT', line: 1 })).toEqual({
      ok: false,
      code: 'NO_PATCH',
      allowed: [],
    });
    expect(validateAnchor(anchors, { path: 'added.ts', side: 'LEFT', line: 1 })).toEqual({
      ok: false,
      code: 'OUTSIDE_DIFF',
      allowed: [],
    });
  });

  it('uses current rename paths and conservatively rejects LEFT rename anchors', () => {
    const anchors = buildAnchorMap([
      {
        filename: 'new-name.ts',
        status: 'renamed',
        patch: '@@ -1,2 +1 @@\n-old\n-older\n+new',
      },
    ]);

    expect(validateAnchor(anchors, { path: 'old-name.ts', side: 'RIGHT', line: 1 })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_PATH',
    });
    expect(validateAnchor(anchors, { path: 'new-name.ts', side: 'RIGHT', line: 1 })).toEqual({
      ok: true,
    });
    expect(validateAnchor(anchors, { path: 'new-name.ts', side: 'LEFT', line: 1 })).toEqual({
      ok: false,
      code: 'INVALID_RANGE',
      allowed: [],
    });
  });

  it.each([
    ['accepts a zero-count add', '@@ -0,0 +1,2 @@\n+one\n+two', 'RIGHT', 2],
    ['accepts a zero-count delete', '@@ -3,2 +2,0 @@\n-old\n-gone', 'LEFT', 4],
    ['accepts mismatched counts', '@@ -1 +1 @@\n-old\n+new\n+extra', 'RIGHT', 2],
    ['accepts a zero start with an omitted count', '@@ -0 +1 @@\n-old\n+new', 'LEFT', 0],
    ['accepts a context-only hunk', '@@ -1 +1 @@\n unchanged', 'RIGHT', 1],
    ['accepts backward hunks', '@@ -10 +10 @@\n-old\n+new\n@@ -1 +1 @@\n-old\n+new', 'RIGHT', 1],
    [
      'ignores no-newline marker placement',
      '@@ -1 +1 @@\n\\ No newline at end of file\n-old\n+new',
      'RIGHT',
      1,
    ],
    ['tolerates CRLF', '@@ -1 +1 @@\r\n-old\r\n+new\r', 'RIGHT', 1],
  ] as const)('%s', (_name, candidate, side, line) => {
    const anchors = buildAnchorMap([
      { filename: 'candidate.patch', status: 'modified', patch: candidate },
    ]);

    expect(validateAnchor(anchors, { path: 'candidate.patch', side, line })).toEqual({ ok: true });
  });

  it.each([
    ['rejects an invalid body prefix', '@@ -1 +1 @@\ninvalid'],
    ['rejects a partial hunk header', '@@ -1 +1 @@invalid\n-old\n+new'],
    ['rejects an unsafe line start', '@@ -9007199254740992 +1 @@\n-old\n+new'],
  ] as const)('%s', (_name, candidate) => {
    const anchors = buildAnchorMap([
      { filename: 'candidate.patch', status: 'modified', patch: candidate },
    ]);

    expect(validateAnchor(anchors, { path: 'candidate.patch', side: 'RIGHT', line: 1 })).toEqual({
      ok: false,
      code: 'NO_PATCH',
      allowed: [],
    });
  });
});
