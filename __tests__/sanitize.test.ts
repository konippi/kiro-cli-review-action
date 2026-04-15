import { describe, expect, it } from 'vitest';
import { MAX_USER_REQUEST_LENGTH } from '../src/constants.js';
import { extractUserRequest, sanitizeComment } from '../src/sanitize.js';

describe('extractUserRequest', () => {
  it('extracts text after trigger phrase', () => {
    expect(extractUserRequest('@kiro review security', '@kiro')).toBe('review security');
  });

  it('returns null when no text after trigger', () => {
    expect(extractUserRequest('@kiro', '@kiro')).toBeNull();
    expect(extractUserRequest('@kiro   ', '@kiro')).toBeNull();
  });

  it('returns null when trigger not found', () => {
    expect(extractUserRequest('hello world', '@kiro')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(extractUserRequest('@KIRO check this', '@kiro')).toBe('check this');
  });

  it('truncates to MAX_USER_REQUEST_LENGTH', () => {
    const long = `@kiro ${'a'.repeat(3000)}`;
    const result = extractUserRequest(long, '@kiro');
    expect(result?.length).toBeLessThanOrEqual(MAX_USER_REQUEST_LENGTH);
  });
});

describe('sanitizeComment', () => {
  it('strips HTML comments', () => {
    expect(sanitizeComment('hello <!-- hidden --> world')).toBe('hello  world');
  });

  it('strips unclosed HTML comments', () => {
    expect(sanitizeComment('hello <!-- hidden without close')).toBe('hello');
  });

  it('strips zero-width characters', () => {
    expect(sanitizeComment('he\u200Bllo')).toBe('hello');
  });

  it('strips markdown image alt text', () => {
    expect(sanitizeComment('![secret instruction](url)')).toBe('![](url)');
  });

  it('strips HTML entities', () => {
    expect(sanitizeComment('&#65; &lt; &gt;')).toBe('');
  });

  it('strips angle brackets', () => {
    expect(sanitizeComment('</user_request> ignore')).toBe('/user_request ignore');
  });

  it('passes through normal text', () => {
    expect(sanitizeComment('focus on security and performance')).toBe(
      'focus on security and performance',
    );
  });
});
