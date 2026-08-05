# smartive Utilities

A collection of general purpose utilities and helpers for web projects.

## Installation

```bash
npm install @smartive/utils
```

Requires **Node.js 20.9+** (breaking change if you are still on older Node). The package ships
dual ESM and CommonJS builds for every public entry point (`.`, `/http`, `/datocms`, `/next`),
so both `import` and `require` work:

```typescript
// ESM
import { createDatoClient } from '@smartive/utils/datocms';

// CommonJS
const { createDatoClient } = require('@smartive/utils/datocms');
```

The root export (`@smartive/utils`) stays dependency-free. Optional peer dependencies are only
required when you import the corresponding subpath. One caveat applies to `/next` — see
[`@smartive/utils/next`](#smartiveutilsnext) below.

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

## `@smartive/utils/next`

Next.js App Router helpers for draft mode, DatoCMS web previews, and cache revalidation.

```bash
npm install next
```

**Requires a bundler.** This subpath imports `next/headers`, `next/navigation`, and `next/server`
as bare specifiers. Next's bundlers (Turbopack and webpack) resolve those, but Node's ESM loader
cannot, because Next ships no package `exports` map. Inside a Next app — the only place these APIs
work, since they need a request context — this is transparent. Outside one, `require()` resolves
but a raw `import` does not.

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

| Env var                           | Purpose                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| `DRAFT_SECRET_TOKEN`              | Authorizes draft enable/disable and web-previews           |
| `CACHE_INVALIDATION_SECRET_TOKEN` | Authorizes the revalidate webhook (`Webhook-Token` header) |

## Migrating from `@smartive/datocms-utils`

This package was previously published as `@smartive/datocms-utils`. With `4.0.0` it was renamed to
`@smartive/utils` and the old cache-tag utilities were removed.

- `classNames` and `getTelLink` are unchanged — only the import specifier needs to be updated.
- The `cache-tags` entry points (`/cache-tags`, `/cache-tags/neon`, `/cache-tags/redis`, `/cache-tags/noop`)
  and the `CacheTag`, `CacheTagsProvider` and `CacheTagsInvalidateWebhook` types are gone. Stay on
  `@smartive/datocms-utils@3` if you still rely on them.
- New DatoCMS / Next.js helpers live under `@smartive/utils/http`, `@smartive/utils/datocms`, and
  `@smartive/utils/next`.

## License

MIT © [smartive AG](https://github.com/smartive)
