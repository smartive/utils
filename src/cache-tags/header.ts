/**
 * Parses DatoCMS's `X-Cache-Tags` response header into a deduplicated list.
 *
 * The header is a whitespace-separated list, e.g. `'tag-a tag-2 other-tag'`. Only present
 * when the query was sent with `returnCacheTags: true`, which `@datocms/cda-client` maps
 * to the `X-Cache-Tags` request header.
 *
 * @param value Raw header value, or `null`/`undefined` when absent.
 * @returns Unique tags in first-seen order; empty when the header is missing or blank.
 */
export const parseXCacheTagsResponseHeader = (value?: string | null): string[] => [
  ...new Set(value?.split(/\s+/).filter(Boolean) ?? []),
];
