import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CACHE_PROFILES,
  resolveCacheMode,
  resolveCacheProfile,
  resolveCacheProfiles,
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

describe('resolveCacheMode', () => {
  it('bypasses when drafts are explicitly requested', () => {
    expect(resolveCacheMode({ includeDrafts: true })).toBe('bypass');
  });

  it('bypasses when the cache is explicitly skipped', () => {
    expect(resolveCacheMode({ skipCache: true })).toBe('bypass');
  });

  // An explicit request must win: the caller (e.g. preview slug resolution) needs a
  // guaranteed-fresh read, not a cached scope that merely happens not to persist.
  it('prefers bypass over draft when both apply', () => {
    expect(resolveCacheMode({ includeDrafts: true, draftModeEnabled: true })).toBe('bypass');
  });

  it('uses the draft path when draft mode is merely enabled', () => {
    expect(resolveCacheMode({ draftModeEnabled: true })).toBe('draft');
  });

  it('caches by default', () => {
    expect(resolveCacheMode({})).toBe('cached');
  });

  it.each([
    ['false flags', { includeDrafts: false, skipCache: false, draftModeEnabled: false }],
    ['undefined flags', {}],
  ])('caches for %s', (_label, input) => {
    expect(resolveCacheMode(input)).toBe('cached');
  });
});

describe('resolveCacheProfile', () => {
  const profiles: CacheProfiles = DEFAULT_CACHE_PROFILES;

  it('uses the draft profile on the draft path', () => {
    expect(resolveCacheProfile({ mode: 'draft', stored: false, profiles })).toBe('seconds');
  });

  it('ignores an override on the draft path', () => {
    expect(resolveCacheProfile({ mode: 'draft', stored: true, profiles, override: 'max' })).toBe('seconds');
  });

  it('uses the cached profile when the mapping persisted', () => {
    expect(resolveCacheProfile({ mode: 'cached', stored: true, profiles })).toBe('days');
  });

  it('honours a per-query override when the mapping persisted', () => {
    expect(resolveCacheProfile({ mode: 'cached', stored: true, profiles, override: 'weeks' })).toBe('weeks');
  });

  // Without a mapping the webhook cannot reach the entry, so it has to expire on its own.
  it('falls back to the short profile when the mapping did not persist', () => {
    expect(resolveCacheProfile({ mode: 'cached', stored: false, profiles })).toBe('minutes');
  });

  // Otherwise an override could strand unreachable content for its whole lifetime.
  it('ignores an override when the mapping did not persist', () => {
    expect(resolveCacheProfile({ mode: 'cached', stored: false, profiles, override: 'max' })).toBe('minutes');
  });

  it('respects custom profile names', () => {
    const custom: CacheProfiles = { cached: 'blog', unstored: 'short', draft: 'live' };

    expect(resolveCacheProfile({ mode: 'cached', stored: true, profiles: custom })).toBe('blog');
    expect(resolveCacheProfile({ mode: 'cached', stored: false, profiles: custom })).toBe('short');
    expect(resolveCacheProfile({ mode: 'draft', stored: true, profiles: custom })).toBe('live');
  });
});
