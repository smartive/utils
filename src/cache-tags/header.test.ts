import { describe, expect, it } from 'vitest';

import { parseXCacheTagsResponseHeader } from './header.js';

describe('parseXCacheTagsResponseHeader', () => {
  it('splits a whitespace-separated header', () => {
    expect(parseXCacheTagsResponseHeader('tag-a tag-2 other-tag')).toEqual(['tag-a', 'tag-2', 'other-tag']);
  });

  it('collapses runs of whitespace', () => {
    expect(parseXCacheTagsResponseHeader('  tag-a \t tag-b \n tag-c  ')).toEqual(['tag-a', 'tag-b', 'tag-c']);
  });

  it('deduplicates while preserving first-seen order', () => {
    expect(parseXCacheTagsResponseHeader('tag-b tag-a tag-b tag-a')).toEqual(['tag-b', 'tag-a']);
  });

  it.each([null, undefined, '', '   '])('returns an empty array for %p', (value) => {
    expect(parseXCacheTagsResponseHeader(value)).toEqual([]);
  });
});
