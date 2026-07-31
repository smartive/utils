import { type CacheTag } from './types.js';

/**
 * Converts the value of DatoCMS's `X-Cache-Tags` header into an array of strings typed as `CacheTag`.
 * For example, it transforms `'tag-a tag-2 other-tag'` into `['tag-a', 'tag-2', 'other-tag']`.
 *
 * @param string String value of the `X-Cache-Tags` header
 * @returns Array of strings typed as `CacheTag`
 */
export const parseXCacheTagsResponseHeader = (string?: null | string) =>
  (string?.split(/\s+/).filter(Boolean) ?? []).map((tag) => tag as CacheTag);
