import { DEFAULT_ORPHAN_RETENTION_SECONDS } from './retention.js';
import type { CacheTagStore, CacheTagStoreStats } from './types.js';

export type MemoryCacheTagStoreConfig = {
  /** Simulate an unconfigured store, to exercise the handler's 503 path. Default `true`. */
  configured?: boolean;
  /**
   * Force every method into its failure branch, so callers can exercise fail-soft paths
   * without a real backend outage.
   */
  failing?: boolean;
};

type Row = { queryId: string; cacheTag: string; lastSeenAt: number };

/**
 * In-process {@link CacheTagStore}.
 *
 * Suitable for tests, local development, and single-instance deployments only — the
 * mapping lives in one process's memory, so on a serverless platform each instance would
 * see a different subset and the invalidation webhook would miss entries. Use
 * `createNeonCacheTagStore` from `@smartive/utils/cache-tags/neon` in production.
 *
 * Also serves as the reference implementation of the `CacheTagStore` contract.
 */
export const createMemoryCacheTagStore = ({
  configured = true,
  failing = false,
}: MemoryCacheTagStoreConfig = {}): CacheTagStore => {
  let rows: Row[] = [];

  const usable = () => configured && !failing;

  return {
    name: 'MemoryCacheTagStore',

    isConfigured: () => configured,

    storeQueryCacheTags: (queryId, cacheTags) => {
      if (!usable() || cacheTags.length === 0) {
        return Promise.resolve(false);
      }

      const lastSeenAt = Date.now();

      for (const cacheTag of cacheTags) {
        const existing = rows.find((row) => row.queryId === queryId && row.cacheTag === cacheTag);

        if (existing) {
          existing.lastSeenAt = lastSeenAt;
        } else {
          rows.push({ queryId, cacheTag, lastSeenAt });
        }
      }

      return Promise.resolve(true);
    },

    queriesReferencingCacheTags: (cacheTags) => {
      if (!usable()) {
        return Promise.resolve(null);
      }

      const matching = rows.filter((row) => cacheTags.includes(row.cacheTag)).map(({ queryId }) => queryId);

      return Promise.resolve([...new Set(matching)]);
    },

    deleteCacheTags: (cacheTags) => {
      if (!usable()) {
        return Promise.resolve(0);
      }

      const before = rows.length;
      rows = rows.filter((row) => !cacheTags.includes(row.cacheTag));

      return Promise.resolve(before - rows.length);
    },

    deleteOrphanedCacheTags: (maxAgeSeconds = DEFAULT_ORPHAN_RETENTION_SECONDS) => {
      if (!usable()) {
        return Promise.resolve(0);
      }

      const threshold = Date.now() - maxAgeSeconds * 1000;
      const before = rows.length;
      rows = rows.filter((row) => row.lastSeenAt >= threshold);

      return Promise.resolve(before - rows.length);
    },

    truncateCacheTags: () => {
      if (!usable()) {
        return Promise.resolve(0);
      }

      const before = rows.length;
      rows = [];

      return Promise.resolve(before);
    },

    stats: (): Promise<CacheTagStoreStats | null> => {
      if (!usable()) {
        return Promise.resolve(null);
      }

      const timestamps = rows.map(({ lastSeenAt }) => lastSeenAt);

      return Promise.resolve({
        mappings: rows.length,
        queries: new Set(rows.map(({ queryId }) => queryId)).size,
        tags: new Set(rows.map(({ cacheTag }) => cacheTag)).size,
        oldest: timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null,
        newest: timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null,
      });
    },
  };
};
