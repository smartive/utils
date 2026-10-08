import { toPath } from './routes.js';

export type CheckUrlsOptions = {
  /** When set, each URL's host is replaced by it, so production sitemap URLs can be checked locally. */
  baseURL?: string;
  /** Requests in flight at once. Default 8. */
  concurrency?: number;
  /** Default 200. Redirects are not followed, so a redirecting URL fails the check. */
  expectedStatus?: number;
  /** Extra attempts after a network error or a 5xx. Default 1. Other statuses are final. */
  retries?: number;
  /** Per request. Default 30 seconds. */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
};

export type UrlCheckResult = {
  url: string;
  /** `null` when no response arrived. */
  status: number | null;
  ok: boolean;
  error?: string;
};

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_RETRIES = 1;
const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 500;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Requests every URL without a browser and reports its status. Cheap enough to cover the
 * full sitemap where the browser test only samples it.
 *
 * Never throws: every URL yields a result, so the caller can report all failures at once.
 */
export const checkUrls = async (
  urls: readonly string[],
  {
    baseURL,
    concurrency = DEFAULT_CONCURRENCY,
    expectedStatus = 200,
    retries = DEFAULT_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchFn = fetch,
  }: CheckUrlsOptions = {},
): Promise<UrlCheckResult[]> => {
  const check = async (url: string): Promise<UrlCheckResult> => {
    for (let attempt = 0; ; attempt++) {
      const isLastAttempt = attempt >= retries;

      try {
        const response = await fetchFn(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
        // Only the status matters; release the connection instead of buffering the page.
        await response.body?.cancel();

        if (response.status >= 500 && !isLastAttempt) {
          await wait(RETRY_DELAY_MS);
          continue;
        }

        return { url, status: response.status, ok: response.status === expectedStatus };
      } catch (error) {
        if (!isLastAttempt) {
          await wait(RETRY_DELAY_MS);
          continue;
        }

        return { url, status: null, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  };

  const targets = urls.map((url) => (baseURL ? new URL(toPath(url), baseURL).toString() : url));
  const results = new Array<UrlCheckResult>(targets.length);
  let next = 0;

  const worker = async () => {
    while (next < targets.length) {
      const index = next++;
      results[index] = await check(targets[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, targets.length)) }, worker));

  return results;
};

/** One line per failed URL, for an assertion message that lists every problem at once. */
export const formatUrlCheckFailures = (results: readonly UrlCheckResult[]): string =>
  results
    .filter(({ ok }) => !ok)
    .map(({ url, status, error }) => `${status ?? 'no response'} ${url}${error ? ` (${error})` : ''}`)
    .join('\n');
