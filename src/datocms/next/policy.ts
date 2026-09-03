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
 * - `bypass` — do not enter a cached scope at all.
 * - `draft` — inside the cached scope, but draft mode is on, so Next re-executes on every
 *   request and writes nothing to the cache.
 * - `cached` — the normal published path.
 */
export type CacheMode = 'bypass' | 'draft' | 'cached';

export type ResolveCacheModeInput = {
  /**
   * Explicitly requested by the caller, e.g. preview slug resolution. Distinct from draft
   * mode being merely *enabled*: an explicit request bypasses the cache entirely so the
   * caller is guaranteed a fresh read.
   */
  includeDrafts?: boolean;
  /** Explicit per-query cache bypass. */
  skipCache?: boolean;
  /** `(await draftMode()).isEnabled`, read inside the cached scope. */
  draftModeEnabled?: boolean;
};

export const resolveCacheMode = ({ includeDrafts, skipCache, draftModeEnabled }: ResolveCacheModeInput): CacheMode => {
  if (includeDrafts === true || skipCache === true) {
    return 'bypass';
  }

  return draftModeEnabled === true ? 'draft' : 'cached';
};

export type ResolveCacheProfileInput = {
  mode: Exclude<CacheMode, 'bypass'>;
  /** Whether `storeQueryCacheTags` reported the mapping as durable. */
  stored: boolean;
  profiles: CacheProfiles;
  /** Per-query override. Only honoured on the fully cached path. */
  override?: CacheLifeProfile;
};

export const resolveCacheProfile = ({ mode, stored, profiles, override }: ResolveCacheProfileInput): CacheLifeProfile => {
  if (mode === 'draft') {
    return profiles.draft;
  }

  // An override must not be able to extend the lifetime of an entry the webhook cannot
  // reach — that would strand stale content until the override expires.
  if (!stored) {
    return profiles.unstored;
  }

  return override ?? profiles.cached;
};
