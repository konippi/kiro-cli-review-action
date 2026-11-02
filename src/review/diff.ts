const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(?: .*)?$/;

/** Side of a GitHub pull-request diff. */
export type DiffSide = 'RIGHT' | 'LEFT';

type DiffLine =
  | { readonly kind: 'marker'; readonly text: string }
  | {
      readonly kind: 'context';
      readonly text: string;
      readonly oldLine: number;
      readonly newLine: number;
    }
  | { readonly kind: 'addition'; readonly text: string; readonly newLine: number }
  | { readonly kind: 'deletion'; readonly text: string; readonly oldLine: number };

/** One hunk of a unified diff. */
export interface DiffHunk {
  readonly header: string;
  readonly lines: readonly DiffLine[];
}

type IndexedHunk = Readonly<Record<DiffSide, ReadonlySet<number>>>;

/** Commentable lines of one changed file, grouped by hunk. */
export interface FileAnchors {
  readonly renamed: boolean;
  readonly hunks: readonly IndexedHunk[];
}

/** Candidate location for an inline review comment within one file. */
export interface LineAnchor {
  readonly side: DiffSide;
  readonly line: number;
  readonly startLine?: number;
}

/** Reason an anchor cannot carry an inline review comment. */
export type AnchorFailure =
  | { readonly ok: false; readonly code: 'UNSUPPORTED_SIDE' | 'RANGE_ORDER' }
  | {
      readonly ok: false;
      readonly code: 'OUTSIDE_DIFF' | 'INVALID_RANGE';
      readonly allowed: readonly string[];
    };

/** Parses a GitHub file patch, or returns null when it is not a well-formed unified diff. */
export function parsePatch(patch: string): readonly DiffHunk[] | null {
  const hunks: DiffHunk[] = [];
  let current: DiffLine[] | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const text of patch.replace(/\r?\n$/, '').split(/\r?\n/)) {
    const match = HUNK_HEADER.exec(text);
    if (match) {
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      if (!Number.isSafeInteger(oldLine) || !Number.isSafeInteger(newLine)) return null;
      current = [];
      hunks.push({ header: text, lines: current });
      continue;
    }

    if (!current) return null;

    if (text === '\\ No newline at end of file') {
      current.push({ kind: 'marker', text });
      continue;
    }

    switch (text[0]) {
      case ' ':
        current.push({ kind: 'context', text, oldLine, newLine });
        oldLine += 1;
        newLine += 1;
        break;
      case '-':
        current.push({ kind: 'deletion', text, oldLine });
        oldLine += 1;
        break;
      case '+':
        current.push({ kind: 'addition', text, newLine });
        newLine += 1;
        break;
      default:
        return null;
    }
  }

  return hunks;
}

/** Prefixes each commentable hunk line with its anchor, leaving deletions in renamed files unanchored. */
export function anchorHunkLines(hunk: DiffHunk, renamed: boolean): readonly string[] {
  return hunk.lines.map((line) => {
    switch (line.kind) {
      case 'marker':
        return line.text;
      case 'deletion':
        return renamed ? line.text : `L${line.oldLine} ${line.text}`;
      default:
        return `R${line.newLine} ${line.text}`;
    }
  });
}

/** Indexes the LEFT and RIGHT lines of each hunk that can carry a comment. */
export function indexAnchors(hunks: readonly DiffHunk[], renamed: boolean): FileAnchors {
  return {
    renamed,
    hunks: hunks.map((hunk) => {
      const indexed = { RIGHT: new Set<number>(), LEFT: new Set<number>() };
      for (const line of hunk.lines) {
        if (line.kind === 'deletion') indexed.LEFT.add(line.oldLine);
        else if (line.kind !== 'marker') indexed.RIGHT.add(line.newLine);
      }
      return indexed;
    }),
  };
}

function allowedRanges(hunks: readonly IndexedHunk[], side: DiffSide): readonly string[] {
  const lines = hunks.flatMap((hunk) => [...hunk[side]]).sort((left, right) => left - right);
  const ranges: { start: number; end: number }[] = [];
  for (const line of lines) {
    const last = ranges.at(-1);
    if (last && line <= last.end + 1) last.end = line;
    else ranges.push({ start: line, end: line });
  }

  return ranges.map(({ start, end }) => (start === end ? `${start}` : `${start}-${end}`));
}

function containsRange(lines: ReadonlySet<number>, start: number, end: number): boolean {
  for (let line = start; line <= end; line += 1) {
    if (!lines.has(line)) return false;
  }
  return true;
}

/** Validates that an anchor lies within one hunk, rejecting LEFT anchors on renamed files. */
export function validateAnchor(
  file: FileAnchors,
  anchor: LineAnchor,
): { ok: true } | AnchorFailure {
  const { side, line, startLine } = anchor;
  if (file.renamed && side === 'LEFT') return { ok: false, code: 'UNSUPPORTED_SIDE' };
  if (startLine !== undefined && startLine >= line) return { ok: false, code: 'RANGE_ORDER' };

  const start = startLine ?? line;
  if (file.hunks.some((hunk) => containsRange(hunk[side], start, line))) return { ok: true };

  return {
    ok: false,
    code: startLine === undefined ? 'OUTSIDE_DIFF' : 'INVALID_RANGE',
    allowed: allowedRanges(file.hunks, side),
  };
}
