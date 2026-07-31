import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RedisCacheTagsProvider } from '../dist/cache-tags/provider/redis.js';

describe('RedisCacheTagsProvider', () => {
  it('allows a missing keyPrefix but rejects truncateCacheTags without one', async () => {
    const provider = new RedisCacheTagsProvider({
      connectionUrl: 'redis://localhost:6379',
      keyPrefix: undefined,
      throwOnError: true,
    });

    await assert.rejects(() => provider.truncateCacheTags(), /non-empty keyPrefix/);
    await provider.dispose();
  });

  it('allows an empty keyPrefix but rejects truncateCacheTags without one', async () => {
    const provider = new RedisCacheTagsProvider({
      connectionUrl: 'redis://localhost:6379',
      keyPrefix: '',
      throwOnError: true,
    });

    await assert.rejects(() => provider.truncateCacheTags(), /non-empty keyPrefix/);
    await provider.dispose();
  });

  it('dispose is a no-op for an injected client', async () => {
    const calls: string[] = [];
    const fakeClient = {
      on() {
        return this;
      },
      quit: async () => {
        calls.push('quit');

        return 'OK';
      },
      pipeline: () => {
        throw new Error('not used');
      },
    };

    const provider = new RedisCacheTagsProvider({
      client: fakeClient as never,
      keyPrefix: 'test:',
    });

    await provider.dispose();
    assert.deepEqual(calls, []);
  });
});
