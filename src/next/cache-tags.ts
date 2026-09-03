import { revalidatePath, revalidateTag } from 'next/cache';
import { after, type NextRequest, NextResponse } from 'next/server';

import { isCacheTagsInvalidateWebhook } from '../cache-tags/webhook.js';
import type { CacheTagStore } from '../cache-tags/types.js';
import { withCORS } from '../http/cors.js';
import { isValidToken } from '../http/tokens.js';

const DEFAULT_ORPHAN_RETENTION_SECONDS = 30 * 24 * 60 * 60;

export type CacheTagInvalidationResult = {
  store: string;
  receivedCacheTags: number;
  revalidatedQueryIds: string[];
  deletedMappings: number;
  durationMs: number;
};

export type CacheTagInvalidationHandlerConfig = {
  /** Mapping store, typically `createNeonCacheTagStore()`. */
  store: CacheTagStore;
  /** Secret expected in the `Webhook-Token` header. Falls back to `CACHE_INVALIDATION_SECRET_TOKEN`. */
  secret?: string;
  /**
   * Retention for the orphan sweep run via `after()` on each successful invalidation.
   * `false` disables the sweep. Default 30 days.
   */
  orphanRetentionSeconds?: number | false;
  /** Called with the result of a successful invalidation. Defaults to `console.info`. */
  onInvalidate?: (result: CacheTagInvalidationResult) => void;
  /** Extra fields merged into the `GET` diagnostics response. */
  diagnostics?: () => Record<string, unknown>;
};

const preflight = () => new NextResponse(null, withCORS({ status: 204 }));

/**
 * Handlers for the DatoCMS `cda_cache_tags` invalidation webhook.
 *
 * `POST` receives the webhook, resolves which query IDs the changed content affects, and
 * revalidates exactly those — instead of purging the whole app.
 *
 * `GET` is token-guarded diagnostics (`?token=`), for checking whether invalidation is
 * actually configured in a given environment.
 *
 * @example
 * ```ts
 * // app/api/invalidate-cache-tags/route.ts
 * export const { POST, GET, OPTIONS } = createCacheTagInvalidationHandler({ store });
 * ```
 */
export function createCacheTagInvalidationHandler({
  store,
  secret,
  orphanRetentionSeconds = DEFAULT_ORPHAN_RETENTION_SECONDS,
  onInvalidate = (result) => console.info('[cache-tags] invalidate', result),
  diagnostics,
}: CacheTagInvalidationHandlerConfig) {
  const getSecret = () => secret ?? process.env.CACHE_INVALIDATION_SECRET_TOKEN;

  const POST = async (request: NextRequest): Promise<NextResponse> => {
    if (!isValidToken(request.headers.get('Webhook-Token'), getSecret())) {
      return NextResponse.json(
        { error: 'You need to provide a secret token in the `Webhook-Token` header for this endpoint.' },
        withCORS({ status: 401 }),
      );
    }

    // 503 rather than a 200 no-op, so DatoCMS retries instead of recording a successful
    // delivery for an invalidation that never happened.
    if (!store.isConfigured()) {
      return NextResponse.json(
        { error: `${store.name} is not configured, cache tag invalidation is disabled.` },
        withCORS({ status: 503 }),
      );
    }

    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: 'Expected a JSON request body.' }, withCORS({ status: 400 }));
    }

    if (!isCacheTagsInvalidateWebhook(payload)) {
      return NextResponse.json({ error: 'Expected a `cda_cache_tags` invalidation payload.' }, withCORS({ status: 400 }));
    }

    const startedAt = Date.now();
    const cacheTags = payload.entity.attributes.tags;

    if (cacheTags.length === 0) {
      return NextResponse.json({ error: 'Expected at least one cache tag.' }, withCORS({ status: 400 }));
    }

    const queryIds = await store.queriesReferencingCacheTags(cacheTags);

    // `null` means the lookup failed, which is not the same as nothing matching: retrying
    // may succeed, so ask DatoCMS to come back.
    if (queryIds === null) {
      return NextResponse.json({ error: 'Could not read the cache tag mappings.' }, withCORS({ status: 503 }));
    }

    for (const queryId of queryIds) {
      revalidateTag(queryId, { expire: 0 });
    }

    // Revalidate before deleting: a leftover mapping only causes a harmless extra
    // invalidation later, whereas deleting first would lose it if revalidation threw.
    const deletedMappings = await store.deleteCacheTags(cacheTags);

    const result: CacheTagInvalidationResult = {
      store: store.name,
      receivedCacheTags: cacheTags.length,
      revalidatedQueryIds: queryIds,
      deletedMappings,
      durationMs: Date.now() - startedAt,
    };

    onInvalidate(result);

    if (orphanRetentionSeconds !== false) {
      after(() => store.deleteOrphanedCacheTags(orphanRetentionSeconds));
    }

    return NextResponse.json(result, withCORS());
  };

  const GET = async (request: NextRequest): Promise<NextResponse> => {
    if (!isValidToken(new URL(request.url).searchParams.get('token'), getSecret())) {
      return NextResponse.json({ error: 'Invalid Token' }, withCORS({ status: 401 }));
    }

    return NextResponse.json(
      {
        store: store.name,
        configured: store.isConfigured(),
        stats: (await store.stats?.()) ?? null,
        ...diagnostics?.(),
      },
      withCORS(),
    );
  };

  return { POST, GET, OPTIONS: preflight };
}

export type CacheTagInvalidateAllHandlerConfig = {
  /** Mapping store. Without one, only path revalidation runs. */
  store?: CacheTagStore;
  /** Secret expected in `?token=` (GET) or the `Webhook-Token` header (POST). */
  secret?: string;
  /** Extra paths to revalidate alongside `'/'` with `'layout'`. */
  paths?: string[];
};

/**
 * Manual full reset: revalidates everything and empties the mapping store.
 *
 * Needed after a missed webhook, or after any change to the query-ID format — which makes
 * every stored mapping unreachable, so the rows must go too.
 *
 * `GET` reads `?token=` so it can be triggered from a browser; `POST` reads the
 * `Webhook-Token` header.
 */
export function createCacheTagInvalidateAllHandler({ store, secret, paths = [] }: CacheTagInvalidateAllHandlerConfig = {}) {
  const getSecret = () => secret ?? process.env.CACHE_INVALIDATION_SECRET_TOKEN;

  const invalidateAll = async () => {
    revalidatePath('/', 'layout');

    for (const path of paths) {
      revalidatePath(path);
    }

    const result = {
      success: true,
      store: store?.name ?? null,
      configured: store?.isConfigured() ?? false,
      deletedMappings: (await store?.truncateCacheTags()) ?? 0,
    };

    console.info('[cache-tags] invalidate-all', result);

    return NextResponse.json(result, withCORS());
  };

  const GET = async (request: NextRequest): Promise<NextResponse> => {
    if (!isValidToken(new URL(request.url).searchParams.get('token'), getSecret())) {
      return NextResponse.json({ error: 'Invalid Token' }, withCORS({ status: 401 }));
    }

    return invalidateAll();
  };

  const POST = async (request: NextRequest): Promise<NextResponse> => {
    if (!isValidToken(request.headers.get('Webhook-Token'), getSecret())) {
      return NextResponse.json({ error: 'Invalid Token' }, withCORS({ status: 401 }));
    }

    return invalidateAll();
  };

  return { GET, POST, OPTIONS: preflight };
}
