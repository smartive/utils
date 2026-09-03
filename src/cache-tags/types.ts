/**
 * Persistence for the `queryId` ⇄ DatoCMS `X-Cache-Tags` mapping.
 *
 * DatoCMS reports which content a query touched via the `X-Cache-Tags` response header,
 * but Next.js caps a cache entry at a limited number of tags (128 on Vercel). Tagging an
 * entry with one synthetic `queryId` and storing the DatoCMS tags separately keeps entries
 * under that cap while still allowing a webhook to invalidate exactly the affected queries.
 *
 * Implementations must **never throw**: a store outage has to degrade cache lifetime, not
 * fail a page render. Each method therefore fails soft to the documented fallback.
 */
export type CacheTagStore = {
  /** Human-readable name, used in log lines and diagnostics responses. */
  readonly name: string;

  /**
   * Whether the store can currently reach its backend configuration. Read lazily rather
   * than captured at import, so build-time and runtime environments can differ.
   */
  isConfigured(): boolean;

  /**
   * Persists the mapping, refreshing the last-seen timestamp.
   *
   * @returns `true` only when the mapping is durable. This drives the `cacheLife` choice:
   *   an entry whose mapping was not stored can never be reached by the webhook, so it
   *   must get a short TTL instead of a long one.
   */
  storeQueryCacheTags(queryId: string, cacheTags: string[]): Promise<boolean>;

  /**
   * @returns the matching query IDs, or `null` when the lookup itself failed. `null` must
   *   stay distinguishable from `[]`: the webhook answers 503 on `null` so DatoCMS retries,
   *   and 200 on `[]` because nothing matched.
   */
  queriesReferencingCacheTags(cacheTags: string[]): Promise<string[] | null>;

  /**
   * Removes mappings for the given DatoCMS tags. Queries recreate them on their next run.
   *
   * @returns the number of `(query_id, cache_tag)` registrations removed, `0` on failure.
   */
  deleteCacheTags(cacheTags: string[]): Promise<number>;

  /**
   * Removes mappings not refreshed within `maxAgeSeconds`, so rows for queries that no
   * longer exist do not accumulate.
   *
   * @returns the number of registrations removed, `0` on failure.
   */
  deleteOrphanedCacheTags(maxAgeSeconds?: number): Promise<number>;

  /**
   * Wipes every mapping. Needed after a change to the query-ID format, which makes all
   * existing rows unreachable.
   *
   * @returns the number of registrations removed, `0` on failure.
   */
  truncateCacheTags(): Promise<number>;

  /** Optional diagnostics, surfaced by the invalidation handler's `GET` endpoint. */
  stats?(): Promise<CacheTagStoreStats | null>;

  /** Optional cleanup for stores that own a connection. */
  dispose?(): Promise<void>;
};

export type CacheTagStoreStats = {
  mappings: number;
  queries: number;
  tags: number;
  oldest: string | null;
  newest: string | null;
};

export type CacheTagStoreErrorContext = {
  store: string;
  method: keyof CacheTagStore;
  args: readonly unknown[];
};

/**
 * Payload of the DatoCMS `cda_cache_tags` invalidation webhook.
 *
 * @see https://www.datocms.com/docs/content-delivery-api/cache-tags
 */
export type CacheTagsInvalidateWebhook = {
  entity_type: 'cda_cache_tags';
  event_type?: string;
  entity: {
    attributes: {
      tags: string[];
    };
  };
};
