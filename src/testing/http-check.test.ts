import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkUrls, formatUrlCheckFailures } from './http-check.js';

const statusResponse = (status: number) => new Response(status === 204 || status === 304 ? null : 'body', { status });

describe('checkUrls', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports each URL with its status, in input order', async () => {
    const statuses: Record<string, number> = { 'https://example.com/a': 200, 'https://example.com/b': 404 };
    const fetchFn = vi.fn((input: RequestInfo | URL) => Promise.resolve(statusResponse(statuses[input as string])));

    await expect(checkUrls(['https://example.com/a', 'https://example.com/b'], { fetchFn })).resolves.toEqual([
      { url: 'https://example.com/a', status: 200, ok: true },
      { url: 'https://example.com/b', status: 404, ok: false },
    ]);
  });

  it('does not follow redirects, so a redirect fails the check', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 308, headers: { Location: '/elsewhere' } }));

    const [result] = await checkUrls(['https://example.com/old'], { fetchFn });

    expect(result).toMatchObject({ status: 308, ok: false });
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('rewrites hosts to the base URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(statusResponse(200));

    const [result] = await checkUrls(['https://prod.example.com/a?x=1'], { baseURL: 'http://localhost:3000', fetchFn });

    expect(result.url).toBe('http://localhost:3000/a?x=1');
    expect(fetchFn).toHaveBeenCalledWith('http://localhost:3000/a?x=1', expect.anything());
  });

  it('retries 5xx and network errors, but not 4xx', async () => {
    vi.useFakeTimers();

    const fetchFn = vi.fn((input: RequestInfo | URL) => {
      const url = input as string;

      if (url.endsWith('/flaky')) {
        return Promise.resolve(
          statusResponse(fetchFn.mock.calls.filter(([called]) => called === url).length === 1 ? 502 : 200),
        );
      }

      if (url.endsWith('/down')) {
        return Promise.reject(new TypeError('fetch failed'));
      }

      return Promise.resolve(statusResponse(404));
    });

    const promise = checkUrls(['https://example.com/flaky', 'https://example.com/down', 'https://example.com/gone'], {
      retries: 1,
      fetchFn,
    });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual([
      { url: 'https://example.com/flaky', status: 200, ok: true },
      { url: 'https://example.com/down', status: null, ok: false, error: 'fetch failed' },
      { url: 'https://example.com/gone', status: 404, ok: false },
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it('keeps at most `concurrency` requests in flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchFn = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;

      return statusResponse(200);
    });

    const results = await checkUrls(
      Array.from({ length: 10 }, (_, index) => `https://example.com/${index}`),
      { concurrency: 3, fetchFn },
    );

    expect(results).toHaveLength(10);
    expect(results.every(({ ok }) => ok)).toBe(true);
    expect(maxInFlight).toBe(3);
  });

  it('accepts a different expected status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(statusResponse(204));

    await expect(checkUrls(['https://example.com/'], { expectedStatus: 204, fetchFn })).resolves.toEqual([
      { url: 'https://example.com/', status: 204, ok: true },
    ]);
  });

  it('returns no results for no URLs', async () => {
    await expect(checkUrls([], { fetchFn: vi.fn() })).resolves.toEqual([]);
  });
});

describe('formatUrlCheckFailures', () => {
  it('lists only failures, one per line', () => {
    expect(
      formatUrlCheckFailures([
        { url: 'https://example.com/a', status: 200, ok: true },
        { url: 'https://example.com/b', status: 404, ok: false },
        { url: 'https://example.com/c', status: null, ok: false, error: 'fetch failed' },
      ]),
    ).toBe('404 https://example.com/b\nno response https://example.com/c (fetch failed)');
  });
});
