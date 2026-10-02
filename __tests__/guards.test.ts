import { describe, expect, it } from 'vitest';
import { isPlainObject } from '../src/guards.js';

describe('isPlainObject', () => {
  it('accepts non-null, non-array objects', () => {
    expect(isPlainObject({ value: 1 })).toBe(true);
    expect(isPlainObject(new Date())).toBe(true);
  });

  it('rejects arrays, null, and primitive values', () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject('object')).toBe(false);
    expect(isPlainObject(1)).toBe(false);
  });
});
