const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(?: .*)?$/;

/** GitHub pull-request file data needed to validate review anchors. */
export interface PullRequestFile {
  readonly filename: string;
  readonly status: string;
  readonly patch?: string;
}

/** Side of a GitHub pull-request diff. */
export type DiffSide = 'RIGHT' | 'LEFT';

/** Candidate location for an inline review comment. */
export interface ReviewAnchor {
  readonly path: string;
  readonly side: DiffSide;
  readonly line: number;
  readonly startLine?: number;
}

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

interface DiffHunk {
  readonly header: string;
  readonly lines: readonly DiffLine[];
}

type IndexedHunk = Readonly<Record<DiffSide, ReadonlySet<number>>>;

interface FileAnchors {
  readonly renamed: boolean;
  readonly hunks: readonly IndexedHunk[] | null;
}

/** Commentable line anchors indexed by pull-request file path. */
export type AnchorMap = ReadonlyMap<string, FileAnchors>;

type AnchorValidation =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'UNKNOWN_PATH' | 'NO_PATCH' | 'OUTSIDE_DIFF' | 'INVALID_RANGE';
      readonly allowed: readonly string[];
    };

function parsePatch(patch: string): readonly DiffHunk[] | null {
  const hunks: DiffHunk[] = [];
  let current: DiffLine[] | undefined;
  let oldLine = 0;
  let newLine = 0;
  const lines = patch.replace(/\r?\n$/, '').split(/\r?\n/);

  for (const text of lines) {
    const match = HUNK_HEADER.exec(text);
    if (match) {
      const nextOld = Number(match[1]);
      const nextNew = Number(match[2]);
      if (!Number.isSafeInteger(nextOld) || !Number.isSafeInteger(nextNew)) return null;
      current = [];
      hunks.push({ header: text, lines: current });
      oldLine = nextOld;
      newLine = nextNew;
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

/** Returns validated patch lines prefixed with their accepted review anchors. */
export function numberPatchLines(patch: string, renamed: boolean): readonly string[] | null {
  const hunks = parsePatch(patch);
  if (!hunks) return null;
  const numbered: string[] = [];
  for (const hunk of hunks) {
    numbered.push(`${hunk.header}\n`);
    for (const line of hunk.lines) {
      if (line.kind === 'marker') numbered.push(`${line.text}\n`);
      else if (line.kind === 'deletion') {
        numbered.push(renamed ? `${line.text}\n` : `L${line.oldLine} ${line.text}\n`);
      } else {
        numbered.push(`R${line.newLine} ${line.text}\n`);
      }
    }
  }
  return numbered;
}

function indexHunk(hunk: DiffHunk): IndexedHunk {
  const indexed: Record<DiffSide, Set<number>> = {
    RIGHT: new Set<number>(),
    LEFT: new Set<number>(),
  };

  for (const line of hunk.lines) {
    if (line.kind === 'deletion') indexed.LEFT.add(line.oldLine);
    else if (line.kind !== 'marker') indexed.RIGHT.add(line.newLine);
  }
  return indexed;
}

/** Builds commentable LEFT and RIGHT line sets from GitHub file patches. */
export function buildAnchorMap(files: readonly PullRequestFile[]): AnchorMap {
  const anchors = new Map<string, FileAnchors>();
  for (const file of files) {
    const hunks = file.patch === undefined ? null : parsePatch(file.patch);
    anchors.set(file.filename, {
      renamed: file.status === 'renamed',
      hunks: hunks?.map(indexHunk) ?? null,
    });
  }
  return anchors;
}

function compactRanges(lines: readonly number[]): string[] {
  const ranges: { start: number; end: number }[] = [];
  for (const line of lines) {
    const last = ranges.at(-1);
    if (last && line <= last.end + 1) last.end = line;
    else ranges.push({ start: line, end: line });
  }

  return ranges.map(function formatRange({ start, end }) {
    return start === end ? `${start}` : `${start}-${end}`;
  });
}

function allowedRanges(hunks: readonly IndexedHunk[], side: DiffSide): string[] {
  const lines: number[] = [];
  for (const hunk of hunks) {
    for (const line of hunk[side]) {
      lines.push(line);
    }
  }
  lines.sort(function ascending(left, right) {
    return left - right;
  });
  return compactRanges(lines);
}

function containsRange(lines: ReadonlySet<number>, start: number, end: number): boolean {
  for (let line = start; line <= end; line += 1) {
    if (!lines.has(line)) {
      return false;
    }
  }
  return true;
}

/** Validates an anchor in one hunk and conservatively rejects renamed-file LEFT anchors. */
export function validateAnchor(anchors: AnchorMap, anchor: ReviewAnchor): AnchorValidation {
  const file = anchors.get(anchor.path);
  if (!file) return { ok: false, code: 'UNKNOWN_PATH', allowed: [] };
  if (!file.hunks) return { ok: false, code: 'NO_PATCH', allowed: [] };

  const { line, side, startLine = line } = anchor;
  if (file.renamed && side === 'LEFT') {
    return { ok: false, code: 'INVALID_RANGE', allowed: [] };
  }
  if (anchor.startLine !== undefined && startLine >= line) {
    return {
      ok: false,
      code: 'INVALID_RANGE',
      allowed: allowedRanges(file.hunks, side),
    };
  }

  const found = file.hunks.some(function containsAnchor(hunk) {
    return containsRange(hunk[side], startLine, line);
  });
  if (found) return { ok: true };

  return {
    ok: false,
    code: anchor.startLine === undefined ? 'OUTSIDE_DIFF' : 'INVALID_RANGE',
    allowed: allowedRanges(file.hunks, side),
  };
}
