import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AbstractErrorHandlingCacheTagsProvider } from '../dist/cache-tags/provider/base.js';
import type { CacheTag, CacheTagsProviderErrorHandlingConfig } from '../dist/cache-tags/types.js';

class FlakyProvider extends AbstractErrorHandlingCacheTagsProvider {
  public fail = true;

  constructor(config: CacheTagsProviderErrorHandlingConfig = {}) {
    super('FlakyProvider', config);
  }

  public async storeQueryCacheTags(...args: [string, CacheTag[]]) {
    return this.wrap(
      'storeQueryCacheTags',
      args,
      async () => {
        if (this.fail) {
          throw new Error('boom');
        }
      },
      undefined,
    );
  }

  public async queriesReferencingCacheTags(...args: [CacheTag[]]) {
    return this.wrap(
      'queriesReferencingCacheTags',
      args,
      async () => {
        throw new Error('boom');
      },
      [],
    );
  }

  public async deleteCacheTags(...args: [CacheTag[]]) {
    return this.wrap(
      'deleteCacheTags',
      args,
      async () => {
        throw new Error('boom');
      },
      0,
    );
  }

  public async truncateCacheTags() {
    return this.wrap(
      'truncateCacheTags',
      [],
      async () => {
        throw new Error('boom');
      },
      0,
    );
  }
}

describe('AbstractErrorHandlingCacheTagsProvider', () => {
  it('rethrows by default and still invokes onError', async () => {
    const events: unknown[] = [];
    const provider = new FlakyProvider({
      onError: (error, ctx) => {
        events.push({ error, ctx });
      },
    });

    await assert.rejects(() => provider.storeQueryCacheTags('q', []), /boom/);
    assert.equal(events.length, 1);
  });

  it('returns the fallback when throwOnError is false', async () => {
    const provider = new FlakyProvider({ throwOnError: false });

    assert.deepEqual(await provider.queriesReferencingCacheTags([]), []);
    assert.equal(await provider.deleteCacheTags([]), 0);
    assert.equal(await provider.truncateCacheTags(), 0);
  });

  it('does not mask the original error when onError itself throws', async () => {
    const provider = new FlakyProvider({
      onError: () => {
        throw new Error('handler failed');
      },
    });

    await assert.rejects(() => provider.storeQueryCacheTags('q', []), /boom/);
  });
});
