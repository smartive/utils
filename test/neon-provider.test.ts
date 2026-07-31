import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { CacheTag } from '../dist/cache-tags/types.js';

describe('NeonCacheTagsProvider', () => {
  it('rejects invalid table names', async () => {
    const { NeonCacheTagsProvider } = await import('../dist/cache-tags/provider/neon.js');

    assert.throws(
      () =>
        new NeonCacheTagsProvider({
          connectionUrl: 'postgresql://user:pass@host/db',
          table: 'bad;drop table',
        }),
      /Invalid table name/,
    );
  });

  it('names columns, uses ANY($1), and deletes by affected query_id', async () => {
    const queries: { sql: string; params: unknown[] }[] = [];

    mock.module('@neondatabase/serverless', {
      // @types/node still types this as namedExports; Node prefers options.exports.
      namedExports: {
        neon: () => ({
          query: async (sql: string, params: unknown[] = []) => {
            queries.push({ sql, params });

            if (sql.startsWith('SELECT')) {
              return { rows: [{ query_id: 'q1' }], rowCount: 1 };
            }

            return { rows: [], rowCount: 2 };
          },
        }),
      },
    });

    const { NeonCacheTagsProvider } = await import(`../dist/cache-tags/provider/neon.js?t=${Date.now()}`);
    const provider = new NeonCacheTagsProvider({
      connectionUrl: 'postgresql://user:pass@host/db',
      table: 'query_cache_tags',
    });

    const tags = ['item:42', 'product'] as CacheTag[];
    await provider.storeQueryCacheTags('q1', tags);
    await provider.queriesReferencingCacheTags(tags);
    await provider.deleteCacheTags(tags);

    assert.match(queries[0].sql, /INSERT INTO "query_cache_tags" \(query_id, cache_tag\) VALUES/);
    assert.deepEqual(queries[0].params, ['q1', 'item:42', 'q1', 'product']);

    assert.match(queries[1].sql, /cache_tag = ANY\(\$1\)/);
    assert.deepEqual(queries[1].params, [tags]);

    assert.match(
      queries[2].sql,
      /DELETE FROM "query_cache_tags" WHERE query_id IN \(SELECT query_id FROM "query_cache_tags" WHERE cache_tag = ANY\(\$1\)\)/,
    );
    assert.deepEqual(queries[2].params, [tags]);
  });
});
