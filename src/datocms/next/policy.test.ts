import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CACHE_PROFILES,
  resolveCacheProfile,
  resolveCacheProfiles,
  shouldBypassCache,
  type CacheProfiles,
} from './policy.js';

describe('resolveCacheProfiles', () => {
  it('defaults to days / minutes / seconds', () => {
    expect(resolveCacheProfiles()).toEqual({ cached: 'days', unstored: 'minutes', draft: 'seconds' });
  });

  it('merges a partial override over the defaults', () => {
    expect(resolveCacheProfiles({ cached: 'weeks' })).toEqual({
      cached: 'weeks',
      unstored: 'minutes',
      draft: 'seconds',
    });
  });

  it('accepts a custom profile name', () => {
    expect(resolveCacheProfiles({ cached: 'blog' }).cached).toBe('blog');
  });
});

describe('shouldBypassCache', () => {
  // The caller (e.g. preview slug resolution) needs a guaranteed-fresh read, not a cached
  // scope that merely happens not to persist.
  it.each([
    ['drafts are explicitly requested', { includeDrafts: true }],
    ['the cache is explicitly skipped', { skipCache: true }],
  ])('bypasses when %s', (_label, input) => {
    expect(shouldBypassCache(input)).toBe(true);
  });

  it.each([
    ['false flags', { includeDrafts: false, skipCache: false }],
    ['undefined flags', {}],
  ])('caches for %s', (_label, input) => {
    expect(shouldBypassCache(input)).toBe(false);
  });
});

describe('resolveCacheProfile', () => {
  const profiles: CacheProfiles = DEFAULT_CACHE_PROFILES;

  it('uses the cached profile when the mapping persisted', () => {
    expect(resolveCacheProfile({ stored: true, profiles })).toBe('days');
  });

  it('honours a per-query override when the mapping persisted', () => {
    expect(resolveCacheProfile({ stored: true, profiles, override: 'weeks' })).toBe('weeks');
  });

  // Without a mapping the webhook cannot reach the entry, so it has to expire on its own.
  it('falls back to the short profile when the mapping did not persist', () => {
    expect(resolveCacheProfile({ stored: false, profiles })).toBe('minutes');
  });

  // Otherwise an override could strand unreachable content for its whole lifetime.
  it('ignores an override when the mapping did not persist', () => {
    expect(resolveCacheProfile({ stored: false, profiles, override: 'max' })).toBe('minutes');
  });

  it('respects custom profile names', () => {
    const custom: CacheProfiles = { cached: 'blog', unstored: 'short', draft: 'live' };

    expect(resolveCacheProfile({ stored: true, profiles: custom })).toBe('blog');
    expect(resolveCacheProfile({ stored: false, profiles: custom })).toBe('short');
  });
});
