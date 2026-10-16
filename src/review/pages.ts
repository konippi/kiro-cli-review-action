const DIFF_PAGE_SIZE = 12_000;
const MAX_LINE_LENGTH = 2_000;

function truncate(value: string, length: number): string {
  const left = value.charCodeAt(length - 1);
  const right = value.charCodeAt(length);
  const splitsPair = left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;

  return value.slice(0, splitsPair ? length - 1 : length);
}

function truncateLine(line: string): string {
  const content = line.slice(0, -1);
  if (content.length <= MAX_LINE_LENGTH) return line;

  return `${truncate(content, MAX_LINE_LENGTH)} [line truncated]\n`;
}

/** Splits anchored patch lines into bounded pages. */
export function paginatePatchLines(lines: readonly string[]): readonly string[] {
  const patchPages: string[] = [];
  let currentPage = '';
  for (const sourceLine of lines) {
    const line = truncateLine(sourceLine);
    if (currentPage !== '' && currentPage.length + line.length > DIFF_PAGE_SIZE) {
      patchPages.push(currentPage);
      currentPage = '';
    }
    currentPage += line;
  }
  if (currentPage !== '') patchPages.push(currentPage);
  return patchPages;
}
