import { Redis, type RedisOptions } from 'ioredis';
import type { CacheTag, CacheTagsProvider, CacheTagsProviderErrorHandlingConfig } from '../types.js';
import { AbstractErrorHandlingCacheTagsProvider } from './base.js';

type RedisCacheTagsProviderSharedConfig = {
  /**
   * Optional prefix for Redis keys. All keys used to store cache tags are prefixed with this value.
   * This avoids key collisions if the same Redis instance is used for multiple purposes, and ensures
   * `truncateCacheTags()` only deletes keys owned by this provider.
   * For example, if you set `keyPrefix` to `'myapp:'`, a cache tag like `'tag1'` will be stored under the key `'myapp:tag1'`.
   *
   * @deprecated Omitting `keyPrefix` (or passing an empty string) is deprecated. A non-empty prefix
   * is strongly recommended; `truncateCacheTags()` will throw without one.
   */
  readonly keyPrefix?: string;
  /**
   * Optional TTL in seconds applied to tag and reverse-index keys on write.
   * Useful as a safety net against unbounded growth of stale registrations.
   */
  readonly ttlSeconds?: number;
};

type RedisCacheTagsProviderConnectionConfig = RedisCacheTagsProviderSharedConfig & {
  /**
   * Redis connection string. For example, `redis://user:pass@host:port/db`.
   */
  readonly connectionUrl: string;
  /**
   * Optional ioredis options merged into the default client options when creating a new connection.
   */
  readonly redisOptions?: RedisOptions;
  readonly client?: never;
};

type RedisCacheTagsProviderClientConfig = RedisCacheTagsProviderSharedConfig & {
  /**
   * An existing ioredis client. When provided, the provider does not create or close the connection;
   * call `dispose()` is a no-op for the Redis connection in this case.
   */
  readonly client: Redis;
  readonly connectionUrl?: never;
  readonly redisOptions?: never;
};

export type RedisCacheTagsProviderConfig = (RedisCacheTagsProviderConnectionConfig | RedisCacheTagsProviderClientConfig) &
  CacheTagsProviderErrorHandlingConfig;

const DELETE_BATCH_SIZE = 1000;
const QUERY_KEY_MARKER = '\0query:';

/**
 * A `CacheTagsProvider` implementation that uses Redis as the storage backend.
 */
export class RedisCacheTagsProvider extends AbstractErrorHandlingCacheTagsProvider implements CacheTagsProvider {
  private readonly redis: Redis;
  private readonly ownsClient: boolean;
  private readonly keyPrefix: string;
  private readonly ttlSeconds?: number;

  constructor(config: RedisCacheTagsProviderConfig) {
    const { keyPrefix, ttlSeconds, throwOnError, onError } = config;
    super('RedisCacheTagsProvider', { throwOnError, onError });

    this.keyPrefix = keyPrefix ?? '';
    this.ttlSeconds = ttlSeconds;

    if (this.keyPrefix.length === 0) {
      console.warn(
        'RedisCacheTagsProvider: omitting keyPrefix (or using an empty string) is deprecated. ' +
          'Provide a non-empty keyPrefix so truncateCacheTags() only deletes keys owned by this provider.',
      );
    }

    if ('client' in config && config.client) {
      this.redis = config.client;
      this.ownsClient = false;
    } else {
      this.redis = new Redis(config.connectionUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        ...config.redisOptions,
      });
      this.ownsClient = true;
    }

    this.redis.on('error', (error) => {
      try {
        this.onError?.(error, { provider: this.providerName, method: 'dispose', args: [] });
      } catch (handlerError) {
        console.error(`Error handler itself failed in ${this.providerName} error listener.`, { handlerError });
      }
    });

    if (typeof Symbol.asyncDispose === 'symbol') {
      Object.defineProperty(this, Symbol.asyncDispose, {
        value: () => this.dispose(),
        configurable: true,
      });
    }
  }

  public async storeQueryCacheTags(queryId: string, cacheTags: CacheTag[]) {
    return this.wrap(
      'storeQueryCacheTags',
      [queryId, cacheTags],
      async () => {
        if (!cacheTags?.length) {
          return;
        }

        const pipeline = this.redis.pipeline();
        const queryKey = this.queryKey(queryId);

        for (const tag of cacheTags) {
          const tagKey = this.tagKey(tag);
          pipeline.sadd(tagKey, queryId);
          pipeline.sadd(queryKey, tag);
          if (this.ttlSeconds !== undefined) {
            pipeline.expire(tagKey, this.ttlSeconds);
          }
        }

        if (this.ttlSeconds !== undefined) {
          pipeline.expire(queryKey, this.ttlSeconds);
        }

        const results = await pipeline.exec();
        const error = results?.find(([err]) => err)?.[0];
        if (error) {
          throw error;
        }
      },
      undefined,
    );
  }

  public async queriesReferencingCacheTags(cacheTags: CacheTag[]) {
    return this.wrap(
      'queriesReferencingCacheTags',
      [cacheTags],
      async () => {
        if (!cacheTags?.length) {
          return [];
        }

        const keys = cacheTags.map((tag) => this.tagKey(tag));

        return this.redis.sunion(...keys);
      },
      [],
    );
  }

  public async deleteCacheTags(cacheTags: CacheTag[]) {
    return this.wrap(
      'deleteCacheTags',
      [cacheTags],
      async () => {
        if (!cacheTags?.length) {
          return 0;
        }

        // Read-then-write race: concurrent storeQueryCacheTags can re-add members between
        // SUNION/SMEMBERS and the cleanup pipeline. A Lua script would make this atomic if needed.
        const tagKeys = cacheTags.map((tag) => this.tagKey(tag));
        const queryIds = await this.redis.sunion(...tagKeys);

        if (queryIds.length === 0) {
          return this.redis.del(...tagKeys);
        }

        const reversePipeline = this.redis.pipeline();
        for (const queryId of queryIds) {
          reversePipeline.smembers(this.queryKey(queryId));
        }
        const reverseResults = await reversePipeline.exec();
        const reverseError = reverseResults?.find(([err]) => err)?.[0];
        if (reverseError) {
          throw reverseError;
        }

        const allTags = new Set<string>(cacheTags);
        for (const result of reverseResults ?? []) {
          const members = (result?.[1] as string[] | undefined) ?? [];
          for (const tag of members) {
            allTags.add(tag);
          }
        }

        const cleanupPipeline = this.redis.pipeline();
        for (const queryId of queryIds) {
          for (const tag of allTags) {
            cleanupPipeline.srem(this.tagKey(tag), queryId);
          }
          cleanupPipeline.del(this.queryKey(queryId));
        }
        for (const tag of cacheTags) {
          cleanupPipeline.del(this.tagKey(tag));
        }

        const cleanupResults = await cleanupPipeline.exec();
        const cleanupError = cleanupResults?.find(([err]) => err)?.[0];
        if (cleanupError) {
          throw cleanupError;
        }

        // Count (query, tag) registrations removed. Legacy entries without a reverse index
        // only lose the tags being deleted explicitly.
        let removed = 0;
        for (const result of reverseResults ?? []) {
          const members = (result?.[1] as string[] | undefined) ?? [];
          removed += members.length > 0 ? members.length : cacheTags.length;
        }

        return removed;
      },
      0,
    );
  }

  public async truncateCacheTags() {
    return this.wrap(
      'truncateCacheTags',
      [],
      async () => {
        if (this.keyPrefix.length === 0) {
          throw new Error(
            'RedisCacheTagsProvider.truncateCacheTags() requires a non-empty keyPrefix to avoid deleting unrelated Redis keys.',
          );
        }

        const keys = await this.getKeys();

        if (keys.length === 0) {
          return 0;
        }

        return this.deleteKeysInBatches(keys);
      },
      0,
    );
  }

  /**
   * Closes the Redis connection when this provider created it.
   * No-op when an external `client` was injected.
   */
  public async dispose(): Promise<void> {
    if (!this.ownsClient) {
      return;
    }

    await this.redis.quit();
  }

  private tagKey(tag: string): string {
    return `${this.keyPrefix}${tag}`;
  }

  private queryKey(queryId: string): string {
    return `${this.keyPrefix}${QUERY_KEY_MARKER}${queryId}`;
  }

  private async deleteKeysInBatches(keys: string[]): Promise<number> {
    let deleted = 0;

    for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
      const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
      try {
        deleted += await this.redis.unlink(...batch);
      } catch {
        deleted += await this.redis.del(...batch);
      }
    }

    return deleted;
  }

  /**
   * Retrieves all keys matching the given pattern using the Redis SCAN command.
   * This method is more efficient than using the KEYS command, especially for large datasets.
   *
   * @returns An array of matching keys
   */
  private async getKeys(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const keys: string[] = [];

      const stream = this.redis.scanStream({
        match: `${this.keyPrefix}*`,
        count: 1000,
      });

      stream.on('data', (resultKeys: string[]) => {
        keys.push(...resultKeys);
      });

      stream.on('end', () => {
        resolve(keys);
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });
  }
}
