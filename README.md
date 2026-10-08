# smartive Utilities

A collection of general purpose utilities and helpers for web projects.

## Installation

```bash
npm install @smartive/utils
```

The root export (`@smartive/utils`) stays dependency-free. Optional peer dependencies are only
required when you import the corresponding subpath.

## Utilities

### `classNames`

Cleans and joins an array of class names (strings and numbers), filtering out undefined and boolean values.

```typescript
import { classNames } from '@smartive/utils';

const className = classNames('btn', isActive && 'btn-active', 42, undefined, 'btn-primary');
// Result: "btn btn-active 42 btn-primary"
```

### `getTelLink`

Converts a phone number into a `tel:` link by removing non-digit characters (except `+` for international numbers).

```typescript
import { getTelLink } from '@smartive/utils';

const link = getTelLink('+1 (555) 123-4567');
// Result: "tel:+15551234567"
```

## `@smartive/utils/http`

Framework-agnostic HTTP helpers for token checks, open-redirect protection, and CORS headers.

```typescript
import { isSafeRelativePath, isValidToken, withCORS } from '@smartive/utils/http';

isValidToken(request.headers.get('Webhook-Token'), process.env.CACHE_INVALIDATION_SECRET_TOKEN);
isSafeRelativePath('/relative/path');
withCORS({ status: 401 });
```

No environment variables are required by this subpath; callers pass secrets explicitly.

## `@smartive/utils/datocms`

Typed GraphQL client factory wrapping [`@datocms/cda-client`](https://www.npmjs.com/package/@datocms/cda-client).

```bash
npm install @datocms/cda-client
```

```typescript
import { createDatoClient, queryDatoCMS } from '@smartive/utils/datocms';

// Default client (reads env vars)
const data = await queryDatoCMS({ document: MyDocument, includeDrafts: true });

// Or configure explicitly
const query = createDatoClient({
  apiToken: process.env.DATOCMS_API_TOKEN,
  revalidate: 60 * 60,
});
```

| Env var                         | Purpose                                           |
| ------------------------------- | ------------------------------------------------- |
| `DATOCMS_API_TOKEN`             | Read-only CDA token (draft-capable when needed)   |
| `DATOCMS_ENVIRONMENT`           | Optional `X-Environment` header                   |
| `NEXT_DATOCMS_BASE_EDITING_URL` | Enables Content Link headers when querying drafts |

Config passed to `createDatoClient` always wins over environment variables.

On HTTP 429 a query waits for `X-RateLimit-Reset` (plus a few seconds of jitter) and retries up to
`maxRetries` times (default `3`) before rethrowing the cda-client `ApiError`. Set `autoRetry: false`
to fail immediately. cda-client's own unbounded retry is always disabled.

## `@smartive/utils/datocms/next`

The same client, backed by [Next.js Cache Components](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)
instead of the `fetch` data cache. Queries are wrapped in `use cache`, tagged with a
deterministic query ID, and given a `cacheLife` profile — so a DatoCMS publish can
invalidate exactly the affected queries instead of purging the whole app.

**Requires Next.js >= 16 with `cacheComponents: true`.** Without that flag, use
`@smartive/utils/datocms`.

```bash
npm install @datocms/cda-client @neondatabase/serverless
```

```typescript
// lib/dato.ts
import { createNeonCacheTagStore } from '@smartive/utils/cache-tags/neon';
import { createCachedDatoClient } from '@smartive/utils/datocms/next';

export const store = createNeonCacheTagStore();

export const queryDatoCMS = createCachedDatoClient({ store });
```

```typescript
// app/api/invalidate-cache-tags/route.ts
import { createCacheTagInvalidationHandler } from '@smartive/utils/next';
import { store } from '@/lib/dato';

export const { POST, GET, OPTIONS } = createCacheTagInvalidationHandler({ store });
```

Point a DatoCMS **cache tags invalidation** webhook at that `POST` route, with the secret in
the `Webhook-Token` header.

There is deliberately **no default client**: one without a `store` looks like it works but can
never be invalidated, so the store is a required, visible decision. Omitting it is still
supported for local development — every entry then falls back to the short `unstored` lifetime.

### `cacheLife` profiles

| Profile    | Default     | When it applies                                                     |
| ---------- | ----------- | ------------------------------------------------------------------- |
| `cached`   | `'days'`    | The tag mapping persisted, so the webhook can reach the entry       |
| `unstored` | `'minutes'` | The mapping could not be stored — the entry must expire on its own  |
| `draft`    | `'seconds'` | Draft mode is enabled (Next writes nothing to the cache regardless) |

Override per client via `profiles`, or per query via `cacheProfile`. A per-query override is
ignored when the mapping did not persist, so it can never extend the lifetime of an entry the
webhook cannot reach.

### Draft mode

`draftMode().isEnabled` is read _inside_ the cached scope, which Next.js permits. While draft
mode is on, cached functions re-execute per request and nothing is written to the cache, so
`includeDrafts` no longer needs threading through your data layer.

Pass `includeDrafts: true` (or `skipCache: true`) explicitly only when you need a guaranteed
fresh read — preview slug resolution, for example. That bypasses the cached scope entirely.

## `@smartive/utils/cache-tags`

The query-ID ⇄ DatoCMS cache-tag mapping used by `@smartive/utils/datocms/next`. Zero
dependencies; no Next.js import.

```typescript
import { buildQueryId, createMemoryCacheTagStore, parseXCacheTagsResponseHeader } from '@smartive/utils/cache-tags';
```

`createMemoryCacheTagStore()` is for tests, local development, and single-instance deployments
only — on a serverless platform each instance would see a different subset of the mapping. It
also accepts `{ configured: false }` and `{ failing: true }` for exercising fail-soft paths.

### `@smartive/utils/cache-tags/neon`

```typescript
import { cacheTagStoreSchemaSql, createNeonCacheTagStore } from '@smartive/utils/cache-tags/neon';

const store = createNeonCacheTagStore({ onError: (error) => captureException(error) });
```

Create the table once per Neon branch:

```bash
psql "$CACHETAGS_POSTGRES_URL" -c "$(node -e "import('@smartive/utils/cache-tags/neon').then((m) => console.log(m.cacheTagStoreSchemaSql()))")"
```

The store **never throws**: every method fails soft to a documented fallback and arms a 30-second
backoff, because a store outage must degrade cache lifetimes rather than fail a page render.
Writes report a `boolean`, and lookups return `null` on failure versus `[]` for "nothing matched" —
that distinction is what drives the `cacheLife` choice and the webhook's 503-vs-200 response.

Isolate the store per DatoCMS environment (a Neon branch per deployment environment). The query ID
already includes the resolved environment, but a table shared between _apps_ also needs a
`tagPrefix`.

| Env var                  | Purpose                                      |
| ------------------------ | -------------------------------------------- |
| `CACHETAGS_POSTGRES_URL` | Neon connection string for the mapping table |

> One synthetic tag per query, rather than one tag per DatoCMS record, is deliberate: Vercel caps a
> cache entry at 128 tags.

## `@smartive/utils/next`

Next.js App Router helpers for draft mode, DatoCMS web previews, and cache revalidation.

```bash
npm install next
```

```typescript
// app/api/draft/enable/route.ts
import { createDraftHandlers } from '@smartive/utils/next';

export const { enable: GET } = createDraftHandlers();

// app/api/draft/preview-links/route.ts
import { createWebPreviewsHandler } from '@smartive/utils/next';

export const { OPTIONS, POST } = createWebPreviewsHandler({
  baseUrl: 'https://example.com/api/draft',
  resolvePreviewUrl: async ({ item, itemType }) => {
    if (itemType.attributes.api_key === 'page') return `/${item.attributes.slug}`;
    return null;
  },
});

// app/api/revalidate-path/route.ts
import { createRevalidateHandler } from '@smartive/utils/next';

export const POST = createRevalidateHandler({ paths: ['/sitemap.xml'] });
```

Draft enable/disable and web-preview links use the `url` query parameter for redirect targets
(e.g. `/api/draft/enable?url=/page&token=…`).

`createRevalidateHandler` revalidates `'/'` with `'layout'` — the whole app — on every call. For
per-query invalidation, use `createCacheTagInvalidationHandler` with a
[cache-tag store](#smartiveutilscache-tagsneon) instead. `createCacheTagInvalidateAllHandler`
covers the manual full reset (a missed webhook, or a change to the query-ID format).

| Env var                           | Purpose                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `DRAFT_SECRET_TOKEN`              | Authorizes draft enable/disable and web-previews                   |
| `CACHE_INVALIDATION_SECRET_TOKEN` | Authorizes the revalidate and cache-tag webhooks (`Webhook-Token`) |

## `@smartive/utils/testing`

Building blocks for sitemap-driven smoke tests. Zero dependencies, no browser.

```typescript
import { checkUrls, fetchSitemapRoutes, formatUrlCheckFailures } from '@smartive/utils/testing';

const routes = await fetchSitemapRoutes({
  baseURL: 'http://localhost:3333',
  limits: [{ pattern: '/arbeiten/', max: 3 }], // sample large collections
  exclude: ['/ueber-uns/livebilder'],
});

const results = await checkUrls(routes, { baseURL: 'http://localhost:3333' });
```

- `fetchSitemapRoutes` follows a sitemap index and includes `xhtml:link` alternates. It replaces the
  sitemap host with `baseURL`, deduplicates, applies `exclude` then `limits`, and throws when the
  sitemap is unreachable or empty, so a broken sitemap never turns into a green run that checked
  nothing.
- `checkUrls` requests every URL without following redirects (a redirecting sitemap URL fails),
  retries network errors and 5xx once, and never throws. `formatUrlCheckFailures` turns the
  failures into an assertion message.
- `parseSitemap`, `limitRoutes`, `excludeRoutes`, `toPath` and `isIgnored` are exported for custom
  setups. Patterns are a `string` (substring) or a `RegExp`.

### `@smartive/utils/testing/playwright`

Fixtures that fail a Playwright test on client-side errors: hydration mismatches, React errors,
exceptions in client components, failed first-party requests. Only types are imported from
`@playwright/test`, so install the version that matches your CI image:

```bash
npm install -D @playwright/test@<version of mcr.microsoft.com/playwright in your CI>
```

The automatic `smoke` fixture:

- blocks every request that is not same-origin with `baseURL` or listed in `allowHosts`, so
  trackers, consent banners and embeds neither add noise nor send hits from CI
- collects console errors and warnings (`failOn`), uncaught exceptions and unhandled rejections,
  first-party responses with status ≥ 400 and failed first-party requests
- ignores console errors of blocked requests and expected aborts (`<video>` range requests, page
  close), drops entries matching `ignore`, and deduplicates
- fails the test afterwards with the full list, attaches it as `smoke-issues.json`, and annotates
  the blocked hosts

Navigate with `gotoAndSettle`: `waitUntil: 'load'` plus a settle time (default 2 s) for hydration.
Never `networkidle`, which a playing `<video>` prevents from ever arriving.

#### Recipe

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const PORT = 3333; // not 3000, so reuseExistingServer never picks up `next dev`

export default defineConfig({
  testDir: 'test/smoke',
  globalSetup: './test/smoke/global-setup.ts',
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['junit', { outputFile: 'test-results/junit.xml' }], ['html', { open: 'never' }]],
  use: { baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: `npm run build && npm run start -- -p ${PORT}`,
        url: `http://localhost:${PORT}/sitemap.xml`,
        timeout: 15 * 60_000,
        reuseExistingServer: !process.env.CI,
      },
});
```

```typescript
// test/smoke/global-setup.ts
import { smokeGlobalSetup } from '@smartive/utils/testing/playwright';

export default smokeGlobalSetup({ limits: [{ pattern: '/arbeiten/', max: 3 }] });
```

```typescript
// test/smoke/fixtures.ts
import { test as base } from '@playwright/test';
import { smokeFixtures, type SmokeFixtures } from '@smartive/utils/testing/playwright';

export const test = base.extend<SmokeFixtures>(
  smokeFixtures({
    allowHosts: ['*.datocms-assets.com', 'stream.mux.com', 'image.mux.com'],
    ignore: ['Please ensure that the container has a non-static position'],
  }),
);
export { expect } from '@playwright/test';
```

```typescript
// test/smoke/pages.spec.ts
import { gotoAndSettle, readRoutes } from '@smartive/utils/testing/playwright';

import { expect, test } from './fixtures';

for (const route of readRoutes()) {
  test(route, async ({ page }) => {
    const response = await gotoAndSettle(page, route);

    expect(response?.status()).toBe(200);
  });
}
```

```typescript
// test/smoke/http.spec.ts – plain `test`, so no browser is started
import { expect, test } from '@playwright/test';
import { checkUrls, fetchSitemapRoutes, formatUrlCheckFailures } from '@smartive/utils/testing';

test('every sitemap URL returns 200', async ({ baseURL }) => {
  const results = await checkUrls(await fetchSitemapRoutes({ baseURL: baseURL! }), { baseURL });

  expect(formatUrlCheckFailures(results)).toBe('');
});
```

```yaml
# .gitlab-ci.yml
tests:
  image: mcr.microsoft.com/playwright:v<same version as @playwright/test>-noble
  script:
    - npm ci
    - npx playwright test
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  artifacts:
    when: always
    expire_in: 1 week
    reports:
      junit: test-results/junit.xml
    paths: [playwright-report/, test-results/]
```

#### Notes

- **Why global setup:** Playwright runs `webServer` and `globalSetup` before it loads test files,
  so the spec can generate one test per route from the file `smokeGlobalSetup` writes (default
  `node_modules/.cache/smartive-utils/smoke-routes.json`). Every worker reads the same list, even
  if the sitemap changes mid-run. Setup projects run too late for this. `playwright test --list`
  skips global setup and lists no routes.
- **Existing Playwright setup:** `globalSetup` applies to a whole config, so put the smoke suite in
  its own `playwright.smoke.config.ts` and run it with `playwright test -c playwright.smoke.config.ts`.
- **Per-file options:** `test.use({ smokeOptions: { failOn: ['error'] } })`.
- **Expecting issues:** a test can assert on `smoke.issues` and empty it (`smoke.issues.length = 0`)
  to pass.
- **CommonJS projects** (most Next.js apps) work: Playwright compiles the specs to `require()`, and
  both subpaths have a `default` export condition for that.
- **Keep the version in sync:** group `@playwright/test` and `mcr.microsoft.com/playwright` in one
  Renovate rule, otherwise the browser in the image and the runner drift apart.
- **Retries** rerun every failure, so an intermittent console error shows up as flaky and passes.
  Set `failOnFlakyTests: true` to fail on it instead.
- **Video** is never really played: Playwright's Chromium has no H.264 decoder. Only the page around
  it is checked.

## Migrating from `@smartive/datocms-utils`

This package was previously published as `@smartive/datocms-utils`. With `4.0.0` it was renamed to
`@smartive/utils` and the old cache-tag utilities were removed.

- `classNames` and `getTelLink` are unchanged — only the import specifier needs to be updated.
- DatoCMS / Next.js helpers live under `@smartive/utils/http`, `@smartive/utils/datocms`, and
  `@smartive/utils/next`.

### Cache tags

The cache-tag utilities are **back**, rebuilt for Next.js Cache Components. You no longer need to
stay on `@smartive/datocms-utils@3`.

| Removed in 4.0.0                | Replacement                                             |
| ------------------------------- | ------------------------------------------------------- |
| `CacheTagsProvider` (interface) | `CacheTagStore` from `@smartive/utils/cache-tags`       |
| `NeonCacheTagsProvider`         | `createNeonCacheTagStore` (`/cache-tags/neon`)          |
| `NoopCacheTagsProvider`         | `createMemoryCacheTagStore` (`/cache-tags`)             |
| `RedisCacheTagsProvider`        | Not ported — open an issue if you need it               |
| `generateQueryId`               | `buildQueryId` — **different output format**, see below |
| `parseXCacheTagsResponseHeader` | Unchanged, now from `@smartive/utils/cache-tags`        |
| `CacheTag` (branded type)       | Plain `string`                                          |
| `CacheTagsInvalidateWebhook`    | Unchanged, plus an `isCacheTagsInvalidateWebhook` guard |

Behavioural changes worth knowing:

- **Query IDs changed format.** `buildQueryId` emits `<operationName>-<hash16>` rather than a bare
  sha1, so every stored mapping from v3 is unreachable. Run the invalidate-all handler once after
  upgrading to clear them.
- **Stores never throw.** The `throwOnError` option is gone: a store outage must degrade cache
  lifetimes, not fail a render. `onError` remains, for telemetry.
- **Return types carry more signal.** `storeQueryCacheTags` returns `boolean` and
  `queriesReferencingCacheTags` returns `string[] | null`, which is what lets the client pick a
  `cacheLife` profile and the webhook distinguish 503 from 200.
- **`buildQueryId` needs no `graphql` dependency.** It hashes the document structurally, ignoring
  `loc`, so `graphql-tag` output is stable across unrelated edits in the same file.

## License

MIT © [smartive AG](https://github.com/smartive)
