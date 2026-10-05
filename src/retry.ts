import * as core from '@actions/core';
import { toErrorMessage } from './errors.js';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MIN_DELAY_SECONDS = 10;
const DEFAULT_MAX_DELAY_SECONDS = 20;

/** Configure the number of retry attempts, delay range, and retryable failures. */
export interface RetryOptions {
  maxAttempts?: number;
  minSeconds?: number;
  maxSeconds?: number;
  isRetryable?: (error: unknown) => boolean;
}

/** Run an asynchronous action again after failures up to the configured attempt limit. */
export async function withRetry<T>(
  action: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    minSeconds = DEFAULT_MIN_DELAY_SECONDS,
    maxSeconds = DEFAULT_MAX_DELAY_SECONDS,
    isRetryable,
  } = options;

  for (let attempt = 1; attempt < maxAttempts; attempt++) {
    try {
      return await action();
    } catch (error: unknown) {
      if (isRetryable && !isRetryable(error)) throw error;

      core.info(toErrorMessage(error));

      const delaySeconds = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;

      core.info(`Waiting ${delaySeconds} seconds before trying again`);

      await new Promise<void>((resolve) => setTimeout(resolve, delaySeconds * 1000));
    }
  }

  return action();
}
