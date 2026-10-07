import { ApiError } from '@datocms/cda-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withRateLimitRetry } from './retry.js';

const rateLimitError = (headers: Record<string, string> = { 'X-RateLimit-Reset': '0' }) =>
  new ApiError({ status: 429, statusText: 'Too Many Requests', headers: new Headers(headers) }, 'query', { token: 'token' });

describe('withRateLimitRetry', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries a 429 until the request succeeds', async () => {
    const request = vi.fn().mockRejectedValueOnce(rateLimitError()).mockResolvedValueOnce('ok');

    await expect(withRateLimitRetry(request, {})).resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries and rethrows the 429', async () => {
    const error = rateLimitError();
    const request = vi.fn().mockRejectedValue(error);

    await expect(withRateLimitRetry(request, { maxRetries: 2 })).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('retries three times by default', async () => {
    const request = vi.fn().mockRejectedValue(rateLimitError());

    await expect(withRateLimitRetry(request, {})).rejects.toBeInstanceOf(ApiError);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('does not retry when autoRetry is disabled', async () => {
    const request = vi.fn().mockRejectedValue(rateLimitError());

    await expect(withRateLimitRetry(request, { autoRetry: false, maxRetries: 5 })).rejects.toBeInstanceOf(ApiError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not retry other errors', async () => {
    const error = new ApiError({ status: 500, statusText: 'Server Error', headers: new Headers() }, 'query', {
      token: 'token',
    });
    const request = vi.fn().mockRejectedValue(error);

    await expect(withRateLimitRetry(request, {})).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('waits for X-RateLimit-Reset before retrying', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError({ 'X-RateLimit-Reset': '2' }))
      .mockResolvedValueOnce('ok');

    const result = withRateLimitRetry(request, {});

    await vi.advanceTimersByTimeAsync(1999);
    expect(request).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('falls back to waiting the attempt number in seconds without X-RateLimit-Reset', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockRejectedValueOnce(rateLimitError({})).mockResolvedValueOnce('ok');

    const result = withRateLimitRetry(request, {});

    await vi.advanceTimersByTimeAsync(999);
    expect(request).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('ok');
  });
});
