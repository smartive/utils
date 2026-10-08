import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type {
  Fixtures,
  FullConfig,
  Page,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  Response,
} from '@playwright/test';

import { isIgnored, type IgnoreRule } from './ignore.js';
import { matchesPattern } from './patterns.js';
import { fetchSitemapRoutes, type FetchSitemapRoutesOptions } from './sitemap.js';

/** `'example.com'` matches exactly, `'*.example.com'` matches subdomains, a `RegExp` tests the hostname. */
export type HostPattern = string | RegExp;

export type SmokeOptions = {
  /** Known noise. Checked against the message text and its location. */
  ignore?: IgnoreRule[];
  /** Console message types that fail the test. Default `['error', 'warning']`. Uncaught exceptions always do. */
  failOn?: ('error' | 'warning')[];
  /**
   * Hosts allowed besides the `baseURL` origin, typically CMS asset hosts. Every other
   * request is aborted, so trackers, consent banners and embeds neither add console noise
   * nor send hits from CI.
   */
  allowHosts?: HostPattern[];
  /**
   * Fail on first-party responses with status >= 400 and failed first-party requests. Default `true`.
   * When `false`, Chromium's matching "Failed to load resource" console errors are skipped too.
   */
  checkFirstPartyRequests?: boolean;
};

export type SmokeIssue = {
  type: 'console-error' | 'console-warning' | 'pageerror' | 'response' | 'requestfailed';
  text: string;
  location?: string;
};

export type SmokeState = {
  /** Issues collected so far. A test may assert and then empty it to expect specific issues. */
  issues: SmokeIssue[];
  blockedUrls: Set<string>;
};

export type SmokeFixtures = {
  /**
   * Per file or describe block overrides, e.g. `test.use({ smokeOptions: { failOn: ['error'] } })`.
   * Merged over the options passed to {@link smokeFixtures}: `ignore` and `allowHosts` add to
   * them, the other fields replace them.
   */
  smokeOptions: SmokeOptions;
  smoke: SmokeState;
};

type TestArgs = PlaywrightTestArgs & PlaywrightTestOptions;
type WorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions;

const DEFAULT_FAIL_ON: NonNullable<SmokeOptions['failOn']> = ['error', 'warning'];
const DEFAULT_SETTLE_MS = 2000;
const DEFAULT_ROUTES_FILE = 'node_modules/.cache/smartive-utils/smoke-routes.json';

/**
 * `ERR_BLOCKED_BY_CLIENT` is our own blocking. `ERR_ABORTED` is the browser cancelling a
 * request it no longer needs: `<video>` drops range requests when it switches renditions,
 * and closing the page aborts whatever is still in flight.
 */
const EXPECTED_FAILURES = new Set(['net::ERR_BLOCKED_BY_CLIENT', 'net::ERR_ABORTED']);

const matchesHost = (hostname: string, pattern: HostPattern): boolean => {
  if (typeof pattern !== 'string') {
    return matchesPattern(hostname, pattern);
  }

  return pattern.startsWith('*.') ? hostname.endsWith(pattern.slice(1)) : hostname === pattern;
};

const parseUrl = (url: string): URL | undefined => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};

/** First script URL in a stack trace, without `:line:column`, so location ignore rules work for exceptions too. */
const stackLocation = (stack: string | undefined): string | undefined =>
  stack?.match(/https?:\/\/[^\s)]+/)?.[0].replace(/(:\d+){1,2}$/, '');

const formatIssue = ({ type, text, location }: SmokeIssue): string =>
  `  [${type}] ${text}${location && !text.includes(location) ? ` (${location})` : ''}`;

/**
 * Fixtures for `test.extend()` that fail a test on client-side errors.
 *
 * The `smoke` fixture is automatic: it blocks third-party requests, collects console
 * messages, uncaught exceptions and failed first-party requests while the test runs, and
 * fails the test afterwards with every issue that is not ignored.
 *
 * Only imports types from `@playwright/test`, so the project's own pinned version is the
 * one that runs. Request interception disables the browser HTTP cache, which is what a
 * smoke test wants anyway.
 */
export const smokeFixtures = (
  options: SmokeOptions = {},
): Fixtures<SmokeFixtures, Record<never, never>, TestArgs, WorkerArgs> => ({
  smokeOptions: [{}, { option: true }],
  smoke: [
    async ({ page, baseURL, smokeOptions }, use, testInfo) => {
      const { failOn = DEFAULT_FAIL_ON, checkFirstPartyRequests = true } = { ...options, ...smokeOptions };
      // Playwright replaces an option on `test.use()` instead of merging it, which would silently
      // drop the project-wide allowlist and ignore rules.
      const ignore = [...(options.ignore ?? []), ...(smokeOptions.ignore ?? [])];
      const allowHosts = [...(options.allowHosts ?? []), ...(smokeOptions.allowHosts ?? [])];
      const state: SmokeState = { issues: [], blockedUrls: new Set() };
      const seen = new Set<string>();
      let firstPartyOrigin = baseURL ? new URL(baseURL).origin : undefined;

      const isFirstParty = (url: string) => firstPartyOrigin !== undefined && parseUrl(url)?.origin === firstPartyOrigin;

      const isAllowed = (url: string) => {
        const parsed = parseUrl(url);

        if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
          return true;
        }

        return parsed.origin === firstPartyOrigin || allowHosts.some((pattern) => matchesHost(parsed.hostname, pattern));
      };

      const record = (issue: SmokeIssue) => {
        const key = `${issue.type}\n${issue.text}\n${issue.location ?? ''}`;

        if (seen.has(key) || isIgnored(issue, ignore)) {
          return;
        }

        seen.add(key);
        state.issues.push(issue);
      };

      await page.route('**/*', async (route) => {
        const request = route.request();
        const url = request.url();

        // Without a baseURL, the first top-level document defines what counts as first party.
        if (firstPartyOrigin === undefined && request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          firstPartyOrigin = parseUrl(url)?.origin;
        }

        if (isAllowed(url)) {
          await route.fallback();

          return;
        }

        state.blockedUrls.add(url);
        await route.abort('blockedbyclient');
      });

      page.on('console', (message) => {
        const type = message.type();

        if ((type !== 'error' && type !== 'warning') || !failOn.includes(type)) {
          return;
        }

        const text = message.text();
        const location = message.location().url || undefined;

        if (location && state.blockedUrls.has(location)) {
          return;
        }

        // Chromium logs failed loads too. The response and requestfailed handlers own first-party
        // failures (with the status), so `checkFirstPartyRequests: false` silences them entirely.
        if (text.startsWith('Failed to load resource') && location && isFirstParty(location)) {
          return;
        }

        record({ type: type === 'error' ? 'console-error' : 'console-warning', text, location });
      });

      page.on('pageerror', (error) => {
        record({ type: 'pageerror', text: error.message, location: stackLocation(error.stack) });
      });

      page.on('response', (response) => {
        const url = response.url();

        if (checkFirstPartyRequests && response.status() >= 400 && isFirstParty(url)) {
          record({ type: 'response', text: `HTTP ${response.status()} ${url}`, location: url });
        }
      });

      page.on('requestfailed', (request) => {
        const url = request.url();
        const errorText = request.failure()?.errorText ?? 'unknown error';

        if (checkFirstPartyRequests && !EXPECTED_FAILURES.has(errorText) && isFirstParty(url)) {
          record({ type: 'requestfailed', text: `${errorText} ${url}`, location: url });
        }
      });

      await use(state);

      const blockedHosts = [...new Set([...state.blockedUrls].map((url) => parseUrl(url)?.host ?? url))].sort();

      if (blockedHosts.length > 0) {
        testInfo.annotations.push({ type: 'blocked hosts', description: blockedHosts.join(', ') });
      }

      if (state.issues.length > 0) {
        await testInfo.attach('smoke-issues.json', {
          body: JSON.stringify(state.issues, null, 2),
          contentType: 'application/json',
        });

        throw new Error(
          `[testing] ${state.issues.length} issue(s) on ${page.url()}:\n${state.issues.map(formatIssue).join('\n')}`,
        );
      }
    },
    { auto: true },
  ],
});

export type GotoAndSettleOptions = {
  /** Time after `load` for hydration and client components to log errors. Default 2000 ms. */
  settleMs?: number;
  /** Navigation timeout. Defaults to the config's `navigationTimeout`. */
  timeout?: number;
};

/**
 * Navigates and waits a fixed settle time. Deliberately not `networkidle`: a playing
 * `<video>` keeps a range request open indefinitely, so that state never arrives.
 */
export const gotoAndSettle = async (
  page: Page,
  path: string,
  { settleMs = DEFAULT_SETTLE_MS, timeout }: GotoAndSettleOptions = {},
): Promise<Response | null> => {
  const response = await page.goto(path, { waitUntil: 'load', timeout });
  await page.waitForTimeout(settleMs);

  return response;
};

/**
 * Persists the routes for {@link readRoutes}. Playwright loads test files after global
 * setup, so a spec can generate one test per route from this file, and every worker sees
 * the same list even if the sitemap changes mid-run.
 */
export const writeRoutes = (routes: readonly string[], file: string = DEFAULT_ROUTES_FILE): void => {
  const path = resolve(file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(routes));
};

/**
 * Reads the routes written by {@link writeRoutes}. Returns `[]` when the file is missing
 * (e.g. `playwright test --list`, which skips global setup), which makes a real run fail
 * with "No tests found" rather than pass silently.
 */
export const readRoutes = (file: string = DEFAULT_ROUTES_FILE): string[] => {
  let content: string;

  try {
    content = readFileSync(resolve(file), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const routes: unknown = JSON.parse(content);

  return Array.isArray(routes) ? routes.filter((route): route is string => typeof route === 'string') : [];
};

export type SmokeGlobalSetupOptions = Omit<FetchSitemapRoutesOptions, 'baseURL'> & {
  /** Defaults to the first project's `use.baseURL`. */
  baseURL?: string;
  /** Where to write the routes. Must match {@link readRoutes}. */
  file?: string;
};

/**
 * Builds a `globalSetup` function that fetches the sitemap routes and writes them for
 * {@link readRoutes}. Runs after `webServer` is up, so it can read the local sitemap.
 */
export const smokeGlobalSetup =
  ({ baseURL, file, ...options }: SmokeGlobalSetupOptions = {}) =>
  async (config: FullConfig): Promise<void> => {
    const resolvedBaseURL = baseURL ?? config.projects.find((project) => project.use.baseURL)?.use.baseURL;

    if (!resolvedBaseURL) {
      throw new Error('[testing] smokeGlobalSetup needs a baseURL: set use.baseURL in the Playwright config or pass it');
    }

    writeRoutes(await fetchSitemapRoutes({ ...options, baseURL: resolvedBaseURL }), file);
  };
