/** Maximum number of comment characters accepted after a review trigger. */
export const MAX_USER_REQUEST_LENGTH = 2048;

const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const INVISIBLE_CHARS = /(?![\t\n\r])[\p{Cc}\p{Cf}]/gu;

/** Removes content hidden from the rendered comment. */
export function sanitizeComment(content: string): string {
  return content.replace(HTML_COMMENT, '').replace(INVISIBLE_CHARS, '').trim();
}

/** Extract user request text after the trigger phrase. */
export function extractUserRequest(body: string, triggerPhrase: string): string | null {
  const escaped = RegExp.escape(triggerPhrase);
  const match = new RegExp(escaped).exec(body);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length;
  const after = body.substring(start, start + MAX_USER_REQUEST_LENGTH).trim();
  return after || null;
}
