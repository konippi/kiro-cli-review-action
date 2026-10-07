import { describe, expect, it } from 'vitest';
import { extractUserRequest, MAX_USER_REQUEST_LENGTH, sanitizeComment } from '../src/sanitize.js';

describe('sanitizeComment', () => {
  it.each([
    ['C0 control', '\u0007'],
    ['escape', '\u001b'],
    ['DEL and C1 controls', '\u007f\u0085'],
    ['zero-width space', '\u200b'],
    ['byte order mark', '\ufeff'],
    ['bidirectional override', '\u202e'],
    ['word joiner', '\u2060'],
    ['soft hyphen', '\u00ad'],
    ['tag character', '\u{e0041}'],
  ])('removes %s characters', (_name, characters) => {
    expect(sanitizeComment(`before${characters}after`)).toBe('beforeafter');
  });

  it('preserves visible text and rendered whitespace', () => {
    const content = 'before\t\n\r<>&lt; ![alt](url) 日本語 😀 after';

    expect(sanitizeComment(content)).toBe(content);
  });

  it('removes HTML comments, including unterminated comments', () => {
    expect(sanitizeComment('hello <!-- hidden --> world')).toBe('hello  world');
    expect(sanitizeComment('hello <!-- hidden without close')).toBe('hello');
  });
});

describe('extractUserRequest', () => {
  it('extracts text after the trigger phrase', () => {
    expect(extractUserRequest('@kiro review security', '@kiro')).toBe('review security');
  });

  it('returns null when nothing follows the trigger phrase', () => {
    expect(extractUserRequest('@kiro   ', '@kiro')).toBeNull();
  });

  it('truncates to MAX_USER_REQUEST_LENGTH', () => {
    expect(extractUserRequest(`@kiro${'a'.repeat(3000)}`, '@kiro')).toBe(
      'a'.repeat(MAX_USER_REQUEST_LENGTH),
    );
  });

  it('matches the trigger phrase case-sensitively', () => {
    expect(extractUserRequest('@Kiro do x', '@kiro')).toBeNull();
  });
});
