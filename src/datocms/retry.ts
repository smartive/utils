import { ApiError } from '@datocms/cda-client';

import type { DatoClientConfig } from './types.js';

const DEFAULT_MAX_RETRIES = 3;
const JITTER_CAP_SECONDS = 5;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimitError = (error: unknown): error is ApiError => error instanceof ApiError && error.response.status === 429;

/**
 * Seconds until the rate-limit bucket refills. Falls back to the attempt number when
 * DatoCMS sends no `X-RateLimit-Reset`, the same as cda-client.
 */
const getResetSeconds = (error: ApiError, attempt: number): number => {
  const reset = Number.parseInt(error.response.headers.get('x-ratelimit-reset') ?? '', 10);

  return Number.isNaN(reset) ? attempt : reset;
};

/**
 * Never waits less than the reset (retrying earlier is guaranteed to 429 again), plus a
 * capped random extra so concurrent callers don't all retry on the same tick.
 */
const withJitter = (seconds: number): number => seconds + Math.random() * Math.min(seconds, JITTER_CAP_SECONDS);

/**
 * `NaN` or `Infinity` would never fail the `attempt > retries` check and bring back the
 * unbounded retry, so anything non-finite (e.g. an unset env var through `Number()`) gets
 * the default.
 */
const resolveRetries = ({ autoRetry = true, maxRetries }: Pick<DatoClientConfig, 'autoRetry' | 'maxRetries'>): number => {
  if (!autoRetry) {
    return 0;
  }

  return maxRetries !== undefined && Number.isFinite(maxRetries) ? Math.max(0, Math.floor(maxRetries)) : DEFAULT_MAX_RETRIES;
};

/**
 * Runs a cda-client request (with its own `autoRetry` disabled) and retries 429s a
 * bounded number of times. cda-client's own retry recurses until DatoCMS recovers, so
 * under sustained rate limiting a render or form submission would never settle.
 */
export const withRateLimitRetry = async <T>(
  request: () => Promise<T>,
  config: Pick<DatoClientConfig, 'autoRetry' | 'maxRetries'>,
): Promise<T> => {
  const retries = resolveRetries(config);

  for (let attempt = 1; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      if (!isRateLimitError(error) || attempt > retries) {
        throw error;
      }

      await wait(withJitter(getResetSeconds(error, attempt)) * 1000);
    }
  }
};
