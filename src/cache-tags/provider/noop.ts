import { type CacheTag, type CacheTagsProvider } from '../types.js';

export type NoopCacheTagsProviderConfig = {
  /**
   * When true (default), logs each method call via `console.debug`.
   */
  readonly log?: boolean;
};

/**
 * A `CacheTagsProvider` implementation that does not perform any actual storage operations.
 *
 * _Note: This implementation is useful for testing purposes or when you want to disable caching without changing the code that interacts with the cache._
 */
export class NoopCacheTagsProvider implements CacheTagsProvider {
  private readonly log: boolean;

  constructor({ log = true }: NoopCacheTagsProviderConfig = {}) {
    this.log = log;
  }

  public async storeQueryCacheTags(queryId: string, cacheTags: CacheTag[]) {
    if (this.log) {
      console.debug('-- storeQueryCacheTags called', { queryId, cacheTags });
    }

    return Promise.resolve();
  }

  public async queriesReferencingCacheTags(cacheTags: CacheTag[]): Promise<string[]> {
    if (this.log) {
      console.debug('-- queriesReferencingCacheTags called', { cacheTags });
    }

    return Promise.resolve([]);
  }

  public async deleteCacheTags(cacheTags: CacheTag[]) {
    if (this.log) {
      console.debug('-- deleteCacheTags called', { cacheTags });
    }

    return Promise.resolve(0);
  }

  public async truncateCacheTags() {
    if (this.log) {
      console.debug('-- truncateCacheTags called');
    }

    return Promise.resolve(0);
  }
}
