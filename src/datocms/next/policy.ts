/**
 * Cache-policy decisions, kept as pure functions.
 *
 * `'use cache'` is a compiler directive that is a complete no-op under vitest and `tsc`,
 * so nothing inside a cached scope can be unit-tested. Extracting every decision here
 * means the logic that actually matters is testable, and `cached-query.ts` is reduced to
 * applying the outcome.
 */

/**
 * A `cacheLife` profile name. The built-ins are listed for autocompletion; the trailing
 * `(string & {})` keeps custom profiles from `next.config.ts` assignable.
 */
export type CacheLifeProfile = 'default' | 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'max' | (string & {});

export type CacheProfiles = {
  /** Applied when the tag mapping persisted, so the webhook can reach this entry. */
  cached: CacheLifeProfile;
  /**
   * Applied when the mapping did **not** persist. Without a mapping the invalidation
   * webhook cannot find this entry, so it must expire on its own, and soon.
   */
  unstored: CacheLifeProfile;
  /** Applied while draft mode is enabled. */
  draft: CacheLifeProfile;
};

export const DEFAULT_CACHE_PROFILES: CacheProfiles = {
  cached: 'days',
  unstored: 'minutes',
  draft: 'seconds',
};

export const resolveCacheProfiles = (profiles: Partial<CacheProfiles> = {}): CacheProfiles => ({
  ...DEFAULT_CACHE_PROFILES,
  ...profiles,
});

/**
 * How a query was served, as reported to `onCacheDecision`.
 *
 * - `bypass` — never entered a cached scope.
 * - `draft` — inside the cached scope, but draft mode is on, so Next re-executes on every
 *   request and writes nothing to the cache.
 * - `cached` — the normal published path.
 */
export type CacheMode = 'bypass' | 'draft' | 'cached';

export type ShouldBypassCacheInput = {
  /**
   * Explicitly requested by the caller, e.g. preview slug resolution. Distinct from draft
   * mode being merely *enabled*: an explicit request bypasses the cache entirely so the
   * caller is guaranteed a fresh read.
   */
  includeDrafts?: boolean;
  /** Explicit per-query cache bypass. */
  skipCache?: boolean;
};

/**
 * Decided *before* entering a cached scope, since a bypass must not enter one at all.
 * Draft mode being merely enabled is handled inside the scope instead.
 */
export const shouldBypassCache = ({ includeDrafts, skipCache }: ShouldBypassCacheInput): boolean =>
  includeDrafts === true || skipCache === true;

export type ResolveCacheProfileInput = {
  /** Whether `storeQueryCacheTags` reported the mapping as durable. */
  stored: boolean;
  profiles: CacheProfiles;
  /** Per-query override. */
  override?: CacheLifeProfile;
};

/**
 * Picks the `cacheLife` profile for the published path. The draft path always uses
 * `profiles.draft`, since nothing is written to the cache there.
 */
export const resolveCacheProfile = ({ stored, profiles, override }: ResolveCacheProfileInput): CacheLifeProfile => {
  // An override must not be able to extend the lifetime of an entry the webhook cannot
  // reach — that would strand stale content until the override expires.
  if (!stored) {
    return profiles.unstored;
  }

  return override ?? profiles.cached;
};
