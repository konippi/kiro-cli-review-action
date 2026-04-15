import { MAX_USER_REQUEST_LENGTH } from './constants.js';

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional stripping of control characters for sanitization
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const ZERO_WIDTH = /\u200B|\u200C|\u200D|\uFEFF/g;
const BIDI_CHARS = /[\u202A-\u202E\u2066-\u2069]/g;

/** Sanitize user-provided comment text to mitigate prompt injection. */
export function sanitizeComment(content: string): string {
  content = content.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  content = content.replace(ZERO_WIDTH, '');
  content = content.replace(CONTROL_CHARS, '');
  content = content.replace(BIDI_CHARS, '');
  content = content.replace(/!\[[^\]]*\]\(/g, '![](');
  content = content.replace(/&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g, '');
  content = content.replace(/[<>]/g, '');
  return content.trim();
}

/** Extract user request text after the trigger phrase (truncated to MAX_USER_REQUEST_LENGTH). */
export function extractUserRequest(body: string, triggerPhrase: string): string | null {
  const escaped = triggerPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(escaped, 'i').exec(body);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length;
  const after = body.substring(start, start + MAX_USER_REQUEST_LENGTH).trim();
  return after || null;
}
