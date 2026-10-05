import * as core from '@actions/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRetry } from '../src/retry.js';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('withRetry', () => {
  it('returns after a successful retry', async () => {
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue('done');

    await expect(withRetry(action, { maxAttempts: 2, minSeconds: 0, maxSeconds: 0 })).resolves.toBe(
      'done',
    );
    expect(action).toHaveBeenCalledTimes(2);
    expect(core.info).toHaveBeenCalledWith('temporary');
  });

  it('makes the final attempt outside the retry loop', async () => {
    const action = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('temporary'));

    await expect(
      withRetry(action, { maxAttempts: 3, minSeconds: 0, maxSeconds: 0 }),
    ).rejects.toThrow('temporary');
    expect(action).toHaveBeenCalledTimes(3);
  });
});
