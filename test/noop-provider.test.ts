import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NoopCacheTagsProvider } from '../dist/cache-tags/provider/noop.js';
import type { CacheTag } from '../dist/cache-tags/types.js';

describe('NoopCacheTagsProvider', () => {
  it('returns empty/zero results without logging when log is false', async () => {
    const originalDebug = console.debug;
    const calls: unknown[][] = [];
    console.debug = (...args: unknown[]) => {
      calls.push(args);
    };

    try {
      const provider = new NoopCacheTagsProvider({ log: false });
      const tag = 'tag-a' as CacheTag;

      await provider.storeQueryCacheTags('q1', [tag]);
      assert.deepEqual(await provider.queriesReferencingCacheTags([tag]), []);
      assert.equal(await provider.deleteCacheTags([tag]), 0);
      assert.equal(await provider.truncateCacheTags(), 0);
      assert.equal(calls.length, 0);
    } finally {
      console.debug = originalDebug;
    }
  });
});
