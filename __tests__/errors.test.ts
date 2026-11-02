import { describe, expect, it } from 'vitest';
import { isErrnoException, isHttpError, toErrorMessage } from '../src/errors.js';

describe('isErrnoException', () => {
  it('recognizes Error objects carrying a system error code', () => {
    const error = new Error('missing');
    Object.assign(error, { code: 'ENOENT' });

    expect(isErrnoException(error)).toBe(true);
    expect(isErrnoException(new Error('ordinary'))).toBe(false);
    expect(isErrnoException({ code: 'ENOENT' })).toBe(false);
  });
});

describe('toErrorMessage', () => {
  it('returns an Error message', () => {
    expect(toErrorMessage(new Error('failed'))).toBe('failed');
  });

  it('returns the string form of another thrown value', () => {
    expect(toErrorMessage('failed')).toBe('failed');
    expect(toErrorMessage(42)).toBe('42');
  });
});

describe('isHttpError', () => {
  it('accepts only errors carrying a numeric status', () => {
    expect(isHttpError(Object.assign(new Error('failed'), { status: 404 }))).toBe(true);
    expect(isHttpError(Object.assign(new Error('failed'), { status: '404' }))).toBe(false);
    expect(isHttpError({ status: 404 })).toBe(false);
  });
});
