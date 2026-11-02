const MAX_LINE_LENGTH = 2_000;

const PAGE_SIZE = 30_000;

/** Hunk header and lines to lay out on diff pages. */
export interface PageHunk {
  readonly header: string;
  readonly lines: readonly string[];
}

function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_LENGTH) return line;

  const last = line.charCodeAt(MAX_LINE_LENGTH - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? MAX_LINE_LENGTH - 1 : MAX_LINE_LENGTH;
  return `${line.slice(0, end)}… [truncated ${line.length - end} chars]`;
}

/** Splits hunks into bounded pages, repeating the hunk header when a hunk continues on a new page. */
export function paginateHunks(hunks: readonly PageHunk[]): readonly string[] {
  const pages: string[] = [];
  let page = '';

  for (const hunk of hunks) {
    const header = truncateLine(hunk.header);
    for (const [index, line] of [header, ...hunk.lines.map(truncateLine)].entries()) {
      const text = `${line}\n`;
      if (page !== '' && page.length + text.length > PAGE_SIZE) {
        pages.push(page);
        page = index === 0 ? '' : `${header} (continued)\n`;
      }
      page += text;
    }
  }

  if (page !== '') pages.push(page);
  return pages;
}

/** Splits items into at least one page, keeping each page's summed size within the page budget. */
export function paginateItems<T>(
  items: readonly T[],
  size: (item: T) => number,
): readonly (readonly T[])[] {
  let page: T[] = [];
  const pages = [page];
  let used = 0;

  for (const item of items) {
    const itemSize = size(item);
    if (page.length > 0 && used + itemSize > PAGE_SIZE) {
      page = [];
      pages.push(page);
      used = 0;
    }
    page.push(item);
    used += itemSize;
  }

  return pages;
}
