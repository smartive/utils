import { describe, expect, it, vi } from 'vitest';

import { createMemoryCacheTagStore } from './memory.js';
import type { CacheTagStore } from './types.js';

/**
 * Shared behavioural contract for {@link CacheTagStore} implementations.
 *
 * Exported from this test file, rather than a separate module, so it needs no build or
 * packaging excludes of its own: `*.test.ts` is already excluded from both
 * `tsconfig.build.json` and the published `files`. `neon.test.ts` imports it from here.
 *
 * Pass a factory returning a **fresh, empty, configured** store.
 */
export const describeCacheTagStoreContract = (createStore: () => CacheTagStore) => {
  it('reports itself as configured', () => {
    expect(createStore().isConfigured()).toBe(true);
  });

  it('exposes a name', () => {
    expect(createStore().name).toBeTruthy();
  });

  it('stores a mapping and reports success', async () => {
    await expect(createStore().storeQueryCacheTags('Layout-abc', ['tag-a', 'tag-b'])).resolves.toBe(true);
  });

  // A query that touched nothing has no mapping to persist. Reporting `false` keeps the
  // caller on a short cache lifetime, which is the safe default.
  it('reports failure for an empty tag list', async () => {
    await expect(createStore().storeQueryCacheTags('Layout-abc', [])).resolves.toBe(false);
  });

  it('finds the query IDs referencing a tag', async () => {
    const store = createStore();
    await store.storeQueryCacheTags('Layout-abc', ['tag-a', 'shared']);
    await store.storeQueryCacheTags('Page-def', ['tag-b', 'shared']);

    await expect(store.queriesReferencingCacheTags(['tag-a'])).resolves.toEqual(['Layout-abc']);
    expect((await store.queriesReferencingCacheTags(['shared']))?.sort()).toEqual(['Layout-abc', 'Page-def']);
  });

  it('deduplicates query IDs across several matching tags', async () => {
    const store = createStore();
    await store.storeQueryCacheTags('Layout-abc', ['tag-a', 'tag-b']);

    await expect(store.queriesReferencingCacheTags(['tag-a', 'tag-b'])).resolves.toEqual(['Layout-abc']);
  });

  // `[]` (nothing matched) must stay distinguishable from `null` (lookup failed): the
  // webhook answers 200 for the former and 503 for the latter.
  it('returns an empty array, not null, when nothing matches', async () => {
    await expect(createStore().queriesReferencingCacheTags(['absent'])).resolves.toEqual([]);
  });

  it('is idempotent when the same mapping is stored twice', async () => {
    const store = createStore();
    await store.storeQueryCacheTags('Layout-abc', ['tag-a']);
    await store.storeQueryCacheTags('Layout-abc', ['tag-a']);

    await expect(store.queriesReferencingCacheTags(['tag-a'])).resolves.toEqual(['Layout-abc']);
    await expect(store.deleteCacheTags(['tag-a'])).resolves.toBe(1);
  });

  it('deletes mappings by tag and reports the row count', async () => {
    const store = createStore();
    await store.storeQueryCacheTags('Layout-abc', ['tag-a', 'tag-b']);

    await expect(store.deleteCacheTags(['tag-a'])).resolves.toBe(1);
    await expect(store.queriesReferencingCacheTags(['tag-a'])).resolves.toEqual([]);
    await expect(store.queriesReferencingCacheTags(['tag-b'])).resolves.toEqual(['Layout-abc']);
  });

  it('deletes nothing for an empty or absent tag list', async () => {
    const store = createStore();
    await store.storeQueryCacheTags('Layout-abc', ['tag-a']);

    await expect(store.deleteCacheTags([])).resolves.toBe(0);
    await expect(store.deleteCacheTags(['absent'])).resolves.toBe(0);
  });

  it('truncates every mapping and reports the row count', async () => {
    const store = createStore();
    await store.storeQueryCacheTags('Layout-abc', ['tag-a', 'tag-b']);
    await store.storeQueryCacheTags('Page-def', ['tag-c']);

    await expect(store.truncateCacheTags()).resolves.toBe(3);
    await expect(store.queriesReferencingCacheTags(['tag-a'])).resolves.toEqual([]);
  });

  it('keeps freshly seen mappings when sweeping orphans', async () => {
    const store = createStore();
    await store.storeQueryCacheTags('Layout-abc', ['tag-a']);

    await expect(store.deleteOrphanedCacheTags(3600)).resolves.toBe(0);
    await expect(store.queriesReferencingCacheTags(['tag-a'])).resolves.toEqual(['Layout-abc']);
  });

  // Whether a row *past* the window is actually swept depends on the backend's clock
  // granularity (an in-memory millisecond compare vs a Postgres `now()` per statement),
  // so each implementation asserts that itself rather than sharing an assertion here.
};

describe('createMemoryCacheTagStore', () => {
  describeCacheTagStoreContract(() => createMemoryCacheTagStore());

  it('refreshes the last-seen timestamp instead of duplicating a row', async () => {
    const store = createMemoryCacheTagStore();
    await store.storeQueryCacheTags('Layout-abc', ['tag-a']);
    await store.storeQueryCacheTags('Layout-abc', ['tag-a']);

    await expect(store.truncateCacheTags()).resolves.toBe(1);
  });

  it('sweeps mappings once they fall outside the retention window', async () => {
    vi.useFakeTimers();

    try {
      const store = createMemoryCacheTagStore();
      await store.storeQueryCacheTags('Layout-abc', ['tag-a']);

      vi.advanceTimersByTime(3601 * 1000);

      await expect(store.deleteOrphanedCacheTags(3600)).resolves.toBe(1);
      await expect(store.queriesReferencingCacheTags(['tag-a'])).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports stats for the stored mappings', async () => {
    const store = createMemoryCacheTagStore();
    await store.storeQueryCacheTags('Layout-abc', ['tag-a', 'shared']);
    await store.storeQueryCacheTags('Page-def', ['shared']);

    expect(await store.stats?.()).toMatchObject({ mappings: 3, queries: 2, tags: 2 });
  });

  describe('configured: false', () => {
    const store = createMemoryCacheTagStore({ configured: false });

    it('reports itself as unconfigured', () => {
      expect(store.isConfigured()).toBe(false);
    });

    it('fails soft on every operation', async () => {
      await expect(store.storeQueryCacheTags('Layout-abc', ['tag-a'])).resolves.toBe(false);
      await expect(store.queriesReferencingCacheTags(['tag-a'])).resolves.toBeNull();
      await expect(store.deleteCacheTags(['tag-a'])).resolves.toBe(0);
      await expect(store.deleteOrphanedCacheTags()).resolves.toBe(0);
      await expect(store.truncateCacheTags()).resolves.toBe(0);
      await expect(store.stats?.()).resolves.toBeNull();
    });
  });

  describe('failing: true', () => {
    const store = createMemoryCacheTagStore({ failing: true });

    // Still "configured" — this models a reachable backend that is erroring, which is the
    // case that must downgrade `cacheLife` rather than return a 503.
    it('reports itself as configured', () => {
      expect(store.isConfigured()).toBe(true);
    });

    it('fails soft on every operation', async () => {
      await expect(store.storeQueryCacheTags('Layout-abc', ['tag-a'])).resolves.toBe(false);
      await expect(store.queriesReferencingCacheTags(['tag-a'])).resolves.toBeNull();
      await expect(store.deleteCacheTags(['tag-a'])).resolves.toBe(0);
      await expect(store.truncateCacheTags()).resolves.toBe(0);
    });
  });
});
