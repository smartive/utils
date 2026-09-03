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

export const queryDatoCMS = createCachedDatoClient({
  store: createNeonCacheTagStore(),
});
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
