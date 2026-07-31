/**
 * A branded type for cache tags. This is created by intersecting `string`
 * with `{ readonly _: unique symbol }`, making it a unique type.
 * Although it is fundamentally a string, it is treated as a distinct type
 * due to the unique symbol.
 */
export type CacheTag = string & { readonly _: unique symbol };

/**
 * A type representing the structure of a webhook payload for cache tag invalidation.
 * It includes the entity type, event type, and the entity details which contain
 * the cache tags to be invalidated.
 */
export type CacheTagsInvalidateWebhook = {
  entity_type: 'cda_cache_tags';
  event_type: 'invalidate';
  entity: {
    id: 'cda_cache_tags';
    type: 'cda_cache_tags';
    attributes: {
      tags: CacheTag[];
    };
  };
};

/**
 * Configuration object for creating a `CacheTagsProvider` implementation.
 */
export interface CacheTagsProvider {
  /**
   * Stores the cache tags of a query.
   *
   * @param {string} queryId Unique query ID
   * @param {CacheTag[]} cacheTags Array of cache tags
   *
   */
  storeQueryCacheTags(queryId: string, cacheTags: CacheTag[]): Promise<void>;

  /**
   * Retrieves the query IDs that reference any of the specified cache tags.
   *
   * @param {CacheTag[]} cacheTags Array of cache tags to check
   * @returns Array of unique query IDs
   *
   */
  queriesReferencingCacheTags(cacheTags: CacheTag[]): Promise<string[]>;

  /**
   * Deletes the specified cache tags and all query registrations that reference them.
   *
   * When queries are revalidated and run again, fresh cache tag mappings will be created.
   *
   * @param {CacheTag[]} cacheTags Array of cache tags to delete
   * @returns Number of (query, tag) registrations removed
   *
   */
  deleteCacheTags(cacheTags: CacheTag[]): Promise<number>;

  /**
   * Wipes out all cache tags.
   *
   * ⚠️ **Warning**: This will delete all cache tag data. Use with caution!
   *
   * @returns Number of (query, tag) registrations removed (or keys deleted, depending on the backend)
   */
  truncateCacheTags(): Promise<number>;

  /**
   * Optional cleanup hook for providers that own external resources (e.g. Redis connections).
   */
  dispose?(): Promise<void>;
}

export type CacheTagsProviderErrorHandlingConfig = {
  /**
   * If false, errors are suppressed and a fallback value is returned.
   * Default: true
   */
  throwOnError?: boolean;

  /**
   * Optional callback invoked when an error occurs in a `CacheTagsProvider` method,
   * useful for logging and telemetry.
   *
   * Called before the error is either thrown (when `throwOnError` is true or
   * undefined) or suppressed (when `throwOnError` is false).
   */
  onError?: (error: unknown, ctx: { provider: string; method: keyof CacheTagsProvider; args: unknown[] }) => void;
};
