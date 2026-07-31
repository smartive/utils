# smartive DatoCMS Utilities

A collection of utilities and helpers for working with DatoCMS in Next.js projects.

## Installation

```bash
npm install @smartive/datocms-utils
```

## Utilities

### General Utilities

#### `classNames`

Cleans and joins an array of class names (strings and numbers), filtering out undefined and boolean values.

Numbers are kept intentionally, so patterns like `count && 'badge'` with `count === 0` emit a literal `"0"` class. Prefer `count > 0 && 'badge'` when you want to omit the class for zero.

```typescript
import { classNames } from '@smartive/datocms-utils';

const className = classNames('btn', isActive && 'btn-active', 42, undefined, 'btn-primary');
// Result: "btn btn-active 42 btn-primary"
```

#### `getTelLink`

Converts a phone number into a `tel:` link by removing non-digit characters, while preserving a leading `+` for international numbers.

```typescript
import { getTelLink } from '@smartive/datocms-utils';

const link = getTelLink('+1 (555) 123-4567');
// Result: "tel:+15551234567"
```

### DatoCMS Cache Tags

Utilities for managing [DatoCMS cache tags](https://www.datocms.com/docs/content-delivery-api/cache-tags) with different storage backends. Cache tags enable efficient cache invalidation by tracking which queries reference which content.

#### Core Utilities

Install [graphql](https://github.com/graphql/graphql-js) when using `generateQueryId` (`@smartive/datocms-utils/cache-tags` depends on it at runtime):

```bash
npm install graphql
```

If you only need to parse the `X-Cache-Tags` header, use the graphql-free subpath:

```typescript
import { parseXCacheTagsResponseHeader } from '@smartive/datocms-utils/cache-tags/header';
```

```typescript
import { generateQueryId, parseXCacheTagsResponseHeader } from '@smartive/datocms-utils/cache-tags';

// Generate a unique ID for a GraphQL query
const queryId = generateQueryId(document, variables, headers);

// Parse DatoCMS's X-Cache-Tags header
const tags = parseXCacheTagsResponseHeader('tag-a tag-2 other-tag');
// Result: ['tag-a', 'tag-2', 'other-tag']
```

> **Edge runtime:** `generateQueryId` uses Node.js `crypto.createHash` and cannot run in the Next.js Edge runtime or middleware. Call it from a Node.js runtime route/handler instead.

> **Headers:** Only pass headers that actually affect the GraphQL response (for example locale, DatoCMS environment, or draft-mode credentials). Passing the full `request.headers` object hashes cookies, `user-agent`, tracing headers, and other per-request values, which produces a unique query ID on every request and explodes the tag store.

#### Storage Providers

The package provides multiple storage backends for cache tags: **Neon (Postgres)**, **Redis**, and **Noop**. All implement the same `CacheTagsProvider` interface, with the Noop provider being especially useful for testing and development.

Custom providers can reuse the shared error-handling base class:

```typescript
import { AbstractErrorHandlingCacheTagsProvider } from '@smartive/datocms-utils/cache-tags/base';
```

##### Neon (Postgres) Provider

Use Neon serverless Postgres to store cache tag mappings.

**Setup:**

1. Create the cache tags table:

```sql
CREATE TABLE IF NOT EXISTS query_cache_tags (
  query_id TEXT NOT NULL,
  cache_tag TEXT NOT NULL,
  PRIMARY KEY (query_id, cache_tag)
);
```

2. Install [@neondatabase/serverless](https://github.com/neondatabase/serverless)

```bash
npm install @neondatabase/serverless
```

3. Create and use the store:

```typescript
import { NeonCacheTagsProvider } from '@smartive/datocms-utils/cache-tags/neon';

const provider = new NeonCacheTagsProvider({
  connectionUrl: process.env.DATABASE_URL!,
  table: 'query_cache_tags',
  throwOnError: false, // Optional: Disable error throwing, defaults to `true`
  onError(error, ctx) {
    // Optional: Custom error callback
    console.error('CacheTagsProvider error', { error, context: ctx });
  },
});

// Store cache tags for a query
await provider.storeQueryCacheTags(queryId, ['item:42', 'product']);

// Find queries that reference specific tags
const queries = await provider.queriesReferencingCacheTags(['item:42']);

// Delete specific cache tags (also removes all registrations for affected queries)
await provider.deleteCacheTags(['item:42']);

// Clear all cache tags
await provider.truncateCacheTags();
```

##### Redis Provider

Use Redis to store cache tag mappings with better performance for high-traffic applications.

> **Redis Cluster:** The provider uses multi-key commands (`SUNION`, multi-key `DEL`/`UNLINK`). These fail with `CROSSSLOT` under Redis Cluster when keys hash to different slots. Upstash and single-node Redis are supported.

**Setup:**

1. Install [ioredis](https://github.com/redis/ioredis)

```bash
npm install ioredis
```

2. Create and use the provider:

```typescript
import { RedisCacheTagsProvider } from '@smartive/datocms-utils/cache-tags/redis';

const provider = new RedisCacheTagsProvider({
  connectionUrl: process.env.REDIS_URL!,
  // Strongly recommended: namespaces keys so truncateCacheTags() only deletes this provider's data
  keyPrefix: 'prod:',
  // Optional: expire keys as a safety net against unbounded growth
  ttlSeconds: 60 * 60 * 24 * 30,
  throwOnError: process.env.NODE_ENV === 'development', // Optional: Disable error throwing in production - defaults to `true`
});

// Same API as Neon provider
await provider.storeQueryCacheTags(queryId, ['item:42', 'product']);
const queries = await provider.queriesReferencingCacheTags(['item:42']);
await provider.deleteCacheTags(['item:42']);
await provider.truncateCacheTags();

// Close the connection when the provider created it
await provider.dispose();
```

You can also inject an existing ioredis client (useful in Next.js to share one connection). In that case `dispose()` does not close the client:

```typescript
import Redis from 'ioredis';
import { RedisCacheTagsProvider } from '@smartive/datocms-utils/cache-tags/redis';

const redis = new Redis(process.env.REDIS_URL!);
const provider = new RedisCacheTagsProvider({
  client: redis,
  keyPrefix: 'prod:',
});
```

**Redis connection string examples:**

```bash
# Upstash Redis
REDIS_URL=rediss://default:token@endpoint.upstash.io:6379

# Redis Cloud
REDIS_URL=redis://username:password@redis-host:6379

# Local development
REDIS_URL=redis://localhost:6379
```

#### `CacheTagsProvider` Interface

Providers implement:

- `storeQueryCacheTags(queryId: string, cacheTags: CacheTag[])`: Store cache tags for a query
- `queriesReferencingCacheTags(cacheTags: CacheTag[])`: Get query IDs that reference any of the specified tags
- `deleteCacheTags(cacheTags: CacheTag[])`: Delete specific cache tags and all query registrations that reference them; returns the number of `(query, tag)` registrations removed
- `truncateCacheTags()`: Wipe all cache tags (use with caution; Redis requires a non-empty `keyPrefix`)
- `dispose?()`: Optional cleanup for owned resources (Redis closes its connection when it created one)

### Complete Example

```typescript
import { generateQueryId, parseXCacheTagsResponseHeader } from '@smartive/datocms-utils/cache-tags';
import { RedisCacheTagsProvider } from '@smartive/datocms-utils/cache-tags/redis';

const provider = new RedisCacheTagsProvider({
  connectionUrl: process.env.REDIS_URL!,
  keyPrefix: 'myapp:',
});

// After making a DatoCMS query — only hash headers that affect the response
const queryId = generateQueryId(document, variables, {
  authorization: request.headers.get('authorization') ?? '',
  'x-environment': request.headers.get('x-environment') ?? '',
});
const cacheTags = parseXCacheTagsResponseHeader(response.headers.get('x-cache-tags'));
await provider.storeQueryCacheTags(queryId, cacheTags);

// When handling DatoCMS webhook for cache invalidation
const affectedQueries = await provider.queriesReferencingCacheTags(webhook.entity.attributes.tags);
// Revalidate affected queries...
await provider.deleteCacheTags(webhook.entity.attributes.tags);
```

## TypeScript Types

The package includes TypeScript types for DatoCMS webhooks and cache tags:

- `CacheTag`: A branded type for cache tags, ensuring type safety
- `CacheTagsInvalidateWebhook`: Type definition for DatoCMS cache tag invalidation webhook payloads
- `CacheTagsProvider`: Interface for cache tag storage implementations

## License

MIT © [smartive AG](https://github.com/smartive)
