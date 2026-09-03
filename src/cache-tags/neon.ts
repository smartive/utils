import { neon } from '@neondatabase/serverless';

import type { CacheTagStore, CacheTagStoreErrorContext, CacheTagStoreStats } from './types.js';

export type NeonCacheTagStoreConfig = {
  /** Neon connection string. Falls back to `CACHETAGS_POSTGRES_URL`. Resolved lazily. */
  connectionUrl?: string;
  /**
   * Table to read and write. Default `'query_cache_tags'`. Validated and quoted, so a
   * caller-supplied name cannot inject SQL. Schema-qualified names are supported.
   *
   * Create it with {@link cacheTagStoreSchemaSql}.
   */
  table?: string;
  /**
   * How long to stop touching the backend after a failure, so one outage does not turn
   * every render into a failing round-trip. Default 30 seconds.
   */
  retryDelayMs?: number;
  /** Default retention for {@link CacheTagStore.deleteOrphanedCacheTags}. Default 30 days. */
  orphanRetentionSeconds?: number;
  /**
   * Telemetry hook, called before the failure is swallowed. An exception thrown by the
   * hook itself is caught, so it can never mask the original error.
   */
  onError?: (error: unknown, context: CacheTagStoreErrorContext) => void;
};

const DEFAULT_TABLE = 'query_cache_tags';
const DEFAULT_RETRY_DELAY_MS = 30_000;
const DEFAULT_ORPHAN_RETENTION_SECONDS = 30 * 24 * 60 * 60;

/**
 * Validates and quotes a PostgreSQL identifier so a caller-supplied table name cannot
 * break out of its quoting. Supports `schema.table`.
 */
const quoteIdentifier = (identifier: string): string => {
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z_$][a-zA-Z0-9_$]*)?$/.test(identifier)) {
    throw new Error(
      `[cache-tags] Invalid table name: ${identifier}. Table names must start with a letter, underscore, or dollar sign and contain only letters, digits, underscores, and dollar signs. Schema-qualified names (e.g. "schema.table") are supported.`,
    );
  }

  return identifier
    .split('.')
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join('.');
};

/**
 * Idempotent DDL for the mapping table.
 *
 * Exported so the schema lives with the queries that depend on it rather than in a
 * consumer's README, where the two can drift. Apply with
 * `psql "$CACHETAGS_POSTGRES_URL" -c "$(…)"`.
 *
 * The `cache_tag` index serves the webhook lookup; the `last_seen_at` index serves the
 * orphan sweep.
 */
export const cacheTagStoreSchemaSql = (table: string = DEFAULT_TABLE): string => {
  const quoted = quoteIdentifier(table);
  // Index names cannot be quoted-and-qualified the same way, so derive a plain suffix.
  const indexBase = table.replace(/[^a-zA-Z0-9_$]/g, '_');

  return `CREATE TABLE IF NOT EXISTS ${quoted} (
  query_id TEXT NOT NULL,
  cache_tag TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (query_id, cache_tag)
);

CREATE INDEX IF NOT EXISTS ${indexBase}_cache_tag_idx ON ${quoted} (cache_tag);

CREATE INDEX IF NOT EXISTS ${indexBase}_last_seen_at_idx ON ${quoted} (last_seen_at);`;
};

/**
 * Neon-backed {@link CacheTagStore}.
 *
 * Never throws. Every method fails soft to its documented fallback and arms a
 * `retryDelayMs` backoff, because a store outage must degrade cache lifetimes rather than
 * fail a page render. The distinction the callers rely on is preserved: writes report a
 * `boolean`, and lookups return `null` on failure versus `[]` for "nothing matched".
 */
export const createNeonCacheTagStore = ({
  connectionUrl,
  table = DEFAULT_TABLE,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  orphanRetentionSeconds = DEFAULT_ORPHAN_RETENTION_SECONDS,
  onError,
}: NeonCacheTagStoreConfig = {}): CacheTagStore => {
  const name = 'NeonCacheTagStore';
  const quotedTable = quoteIdentifier(table);

  let client: ReturnType<typeof neon> | undefined;
  let retryAt = 0;

  const getClient = () => {
    const url = connectionUrl ?? process.env.CACHETAGS_POSTGRES_URL;

    if (!url) {
      return undefined;
    }

    client ??= neon(url, { fullResults: true });

    return client;
  };

  const isConfigured = () => getClient() !== undefined;

  /**
   * `neon()`'s `query` is typed as a union across its `fullResults` and `arrayMode`
   * options, which TypeScript cannot narrow from the runtime flag. We always construct
   * the client with `fullResults: true`, so normalize the shape once here rather than
   * casting at every call site.
   */
  const run = (
    sql: NonNullable<ReturnType<typeof getClient>>,
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> =>
    sql.query(text, params) as Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;

  /** Runs `query`, returning `fallback` and arming the backoff on any failure. */
  const attempt = async <T>(
    method: keyof CacheTagStore,
    args: readonly unknown[],
    fallback: T,
    query: (sql: NonNullable<ReturnType<typeof getClient>>) => Promise<T>,
  ): Promise<T> => {
    const sql = getClient();

    if (!sql || Date.now() < retryAt) {
      return fallback;
    }

    try {
      return await query(sql);
    } catch (error) {
      retryAt = Date.now() + retryDelayMs;

      try {
        onError?.(error, { store: name, method, args });
      } catch (handlerError) {
        console.error(`[cache-tags] onError handler itself failed in ${name}.${String(method)}`, { handlerError });
      }

      console.error(`[cache-tags] ${name}.${String(method)} failed`, {
        table,
        error: error instanceof Error ? error.message : String(error),
      });

      return fallback;
    }
  };

  return {
    name,

    isConfigured,

    storeQueryCacheTags: async (queryId, cacheTags) => {
      if (cacheTags.length === 0) {
        return false;
      }

      return attempt('storeQueryCacheTags', [queryId, cacheTags], false, async (sql) => {
        await run(
          sql,
          `INSERT INTO ${quotedTable} (query_id, cache_tag, last_seen_at)
           SELECT $1, cache_tag, now() FROM unnest($2::text[]) AS cache_tags(cache_tag)
           ON CONFLICT (query_id, cache_tag) DO UPDATE SET last_seen_at = now()`,
          [queryId, cacheTags],
        );

        return true;
      });
    },

    queriesReferencingCacheTags: async (cacheTags) => {
      if (cacheTags.length === 0) {
        return [];
      }

      return attempt<string[] | null>('queriesReferencingCacheTags', [cacheTags], null, async (sql) => {
        const { rows } = await run(sql, `SELECT DISTINCT query_id FROM ${quotedTable} WHERE cache_tag = ANY($1::text[])`, [
          cacheTags,
        ]);

        return rows.flatMap(({ query_id: queryId }) => (typeof queryId === 'string' ? [queryId] : []));
      });
    },

    deleteCacheTags: async (cacheTags) => {
      if (cacheTags.length === 0) {
        return 0;
      }

      return attempt('deleteCacheTags', [cacheTags], 0, async (sql) => {
        const { rowCount } = await run(sql, `DELETE FROM ${quotedTable} WHERE cache_tag = ANY($1::text[])`, [cacheTags]);

        return rowCount ?? 0;
      });
    },

    deleteOrphanedCacheTags: async (maxAgeSeconds = orphanRetentionSeconds) =>
      attempt('deleteOrphanedCacheTags', [maxAgeSeconds], 0, async (sql) => {
        const { rowCount } = await run(
          sql,
          `DELETE FROM ${quotedTable} WHERE last_seen_at < now() - make_interval(secs => $1::double precision)`,
          [maxAgeSeconds],
        );

        return rowCount ?? 0;
      }),

    truncateCacheTags: async () =>
      attempt('truncateCacheTags', [], 0, async (sql) => {
        const { rowCount } = await run(sql, `DELETE FROM ${quotedTable}`);

        return rowCount ?? 0;
      }),

    stats: async () =>
      attempt<CacheTagStoreStats | null>('stats', [], null, async (sql) => {
        const { rows } = await run(
          sql,
          `SELECT count(*)::int AS mappings,
                  count(DISTINCT query_id)::int AS queries,
                  count(DISTINCT cache_tag)::int AS tags,
                  min(last_seen_at) AS oldest,
                  max(last_seen_at) AS newest
           FROM ${quotedTable}`,
        );

        return (rows[0] as CacheTagStoreStats | undefined) ?? null;
      }),
  };
};
