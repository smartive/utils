import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
const neon = vi.fn(() => ({ query }));

vi.mock('@neondatabase/serverless', () => ({ neon }));

const { cacheTagStoreSchemaSql, createNeonCacheTagStore } = await import('./neon.js');

const rows = (value: unknown[]) => ({ rows: value, rowCount: value.length });

/** `vi.fn()` mock args are `any`; read them through a typed view. */
const callArgs = (index: number): [string, unknown[] | undefined] =>
  query.mock.calls[index] as unknown as [string, unknown[] | undefined];

describe('cacheTagStoreSchemaSql', () => {
  it('creates the table and both indexes', () => {
    const sql = cacheTagStoreSchemaSql();

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "query_cache_tags"');
    expect(sql).toContain('PRIMARY KEY (query_id, cache_tag)');
    expect(sql).toContain('query_cache_tags_cache_tag_idx');
    expect(sql).toContain('query_cache_tags_last_seen_at_idx');
  });

  it('quotes a schema-qualified table', () => {
    expect(cacheTagStoreSchemaSql('cache.tags')).toContain('CREATE TABLE IF NOT EXISTS "cache"."tags"');
  });

  it('rejects an invalid table name', () => {
    expect(() => cacheTagStoreSchemaSql('tags; DROP TABLE users')).toThrow('Invalid table name');
  });
});

describe('createNeonCacheTagStore', () => {
  beforeEach(() => {
    query.mockReset();
    neon.mockClear();
    process.env.CACHETAGS_POSTGRES_URL = 'postgresql://user:pass@host/db';
  });

  afterEach(() => {
    delete process.env.CACHETAGS_POSTGRES_URL;
  });

  describe('table name validation', () => {
    it.each(['tags"; DROP TABLE users; --', 'tags; DELETE FROM users', 'tags--comment', '1tags', 'a.b.c', 'tags name', ''])(
      'rejects %p at construction time',
      (table) => {
        expect(() => createNeonCacheTagStore({ table })).toThrow('Invalid table name');
      },
    );

    it.each(['query_cache_tags', '_tags', '$tags', 'schema.tags', 'Tags123'])('accepts %p', (table) => {
      expect(() => createNeonCacheTagStore({ table })).not.toThrow();
    });

    it('quotes the table name in emitted SQL', async () => {
      query.mockResolvedValue(rows([]));
      await createNeonCacheTagStore({ table: 'schema.tags' }).truncateCacheTags();

      expect(query.mock.calls[0]?.[0]).toContain('"schema"."tags"');
    });
  });

  describe('configuration', () => {
    it('reports unconfigured without a connection URL', () => {
      delete process.env.CACHETAGS_POSTGRES_URL;

      expect(createNeonCacheTagStore().isConfigured()).toBe(false);
    });

    it('prefers an explicit connection URL over the environment', () => {
      createNeonCacheTagStore({ connectionUrl: 'postgresql://explicit@host/db' }).isConfigured();

      expect(neon).toHaveBeenCalledWith('postgresql://explicit@host/db', { fullResults: true });
    });

    // Read lazily rather than captured at import, so build-time and runtime env can differ.
    it('picks up a connection URL set after construction', () => {
      delete process.env.CACHETAGS_POSTGRES_URL;
      const store = createNeonCacheTagStore();
      expect(store.isConfigured()).toBe(false);

      process.env.CACHETAGS_POSTGRES_URL = 'postgresql://late@host/db';
      expect(store.isConfigured()).toBe(true);
    });

    it('fails soft on every operation when unconfigured', async () => {
      delete process.env.CACHETAGS_POSTGRES_URL;
      const store = createNeonCacheTagStore();

      await expect(store.storeQueryCacheTags('Layout-abc', ['tag-a'])).resolves.toBe(false);
      await expect(store.queriesReferencingCacheTags(['tag-a'])).resolves.toBeNull();
      await expect(store.deleteCacheTags(['tag-a'])).resolves.toBe(0);
      await expect(store.truncateCacheTags()).resolves.toBe(0);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('queries', () => {
    it('upserts mappings and reports success', async () => {
      query.mockResolvedValue(rows([]));

      await expect(createNeonCacheTagStore().storeQueryCacheTags('Layout-abc', ['tag-a', 'tag-b'])).resolves.toBe(true);

      const [sql, params] = callArgs(0);
      expect(sql).toContain('ON CONFLICT (query_id, cache_tag) DO UPDATE SET last_seen_at = now()');
      expect(params).toEqual(['Layout-abc', ['tag-a', 'tag-b']]);
    });

    it('skips the round-trip for an empty tag list', async () => {
      await expect(createNeonCacheTagStore().storeQueryCacheTags('Layout-abc', [])).resolves.toBe(false);

      expect(query).not.toHaveBeenCalled();
    });

    it('returns the referencing query IDs', async () => {
      query.mockResolvedValue(rows([{ query_id: 'Layout-abc' }, { query_id: 'Page-def' }]));

      await expect(createNeonCacheTagStore().queriesReferencingCacheTags(['tag-a'])).resolves.toEqual([
        'Layout-abc',
        'Page-def',
      ]);
    });

    it('discards non-string query IDs', async () => {
      query.mockResolvedValue(rows([{ query_id: 'Layout-abc' }, { query_id: null }, {}]));

      await expect(createNeonCacheTagStore().queriesReferencingCacheTags(['tag-a'])).resolves.toEqual(['Layout-abc']);
    });

    it('returns an empty array for an empty tag list without querying', async () => {
      await expect(createNeonCacheTagStore().queriesReferencingCacheTags([])).resolves.toEqual([]);

      expect(query).not.toHaveBeenCalled();
    });

    it('sweeps orphans by a seconds interval', async () => {
      query.mockResolvedValue({ rows: [], rowCount: 4 });

      await expect(createNeonCacheTagStore().deleteOrphanedCacheTags(3600)).resolves.toBe(4);

      const [sql, params] = callArgs(0);
      expect(sql).toContain('last_seen_at < now() - make_interval(secs =>');
      expect(params).toEqual([3600]);
    });

    it('defaults the orphan window to 30 days', async () => {
      query.mockResolvedValue({ rows: [], rowCount: 0 });

      await createNeonCacheTagStore().deleteOrphanedCacheTags();

      expect(query.mock.calls[0]?.[1]).toEqual([30 * 24 * 60 * 60]);
    });

    it('reports stats', async () => {
      query.mockResolvedValue(rows([{ mappings: 3, queries: 2, tags: 2, oldest: null, newest: null }]));

      expect(await createNeonCacheTagStore().stats?.()).toMatchObject({ mappings: 3, queries: 2 });
    });
  });

  describe('fail-soft behaviour', () => {
    it('returns fallbacks instead of throwing', async () => {
      query.mockRejectedValue(new Error('connection refused'));
      const store = createNeonCacheTagStore();

      await expect(store.storeQueryCacheTags('Layout-abc', ['tag-a'])).resolves.toBe(false);
      await expect(store.queriesReferencingCacheTags(['tag-a'])).resolves.toBeNull();
    });

    it('calls onError with context', async () => {
      query.mockRejectedValue(new Error('connection refused'));
      const onError = vi.fn();

      await createNeonCacheTagStore({ onError }).storeQueryCacheTags('Layout-abc', ['tag-a']);

      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ store: 'NeonCacheTagStore', method: 'storeQueryCacheTags' }),
      );
    });

    // The handler's own failure must not mask the original database error.
    it('survives an onError handler that throws', async () => {
      query.mockRejectedValue(new Error('connection refused'));
      const onError = vi.fn(() => {
        throw new Error('telemetry exploded');
      });

      await expect(createNeonCacheTagStore({ onError }).storeQueryCacheTags('Layout-abc', ['tag-a'])).resolves.toBe(false);
    });

    // One outage must not turn every subsequent render into a failing round-trip.
    it('stops touching the backend during the retry window', async () => {
      query.mockRejectedValue(new Error('connection refused'));
      const store = createNeonCacheTagStore({ retryDelayMs: 30_000 });

      await store.storeQueryCacheTags('Layout-abc', ['tag-a']);
      expect(query).toHaveBeenCalledTimes(1);

      await store.storeQueryCacheTags('Layout-abc', ['tag-b']);
      await store.queriesReferencingCacheTags(['tag-a']);
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('retries once the backoff window has passed', async () => {
      vi.useFakeTimers();

      try {
        query.mockRejectedValueOnce(new Error('connection refused')).mockResolvedValue(rows([]));
        const store = createNeonCacheTagStore({ retryDelayMs: 30_000 });

        await store.storeQueryCacheTags('Layout-abc', ['tag-a']);
        expect(query).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(30_001);

        await expect(store.storeQueryCacheTags('Layout-abc', ['tag-a'])).resolves.toBe(true);
        expect(query).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
