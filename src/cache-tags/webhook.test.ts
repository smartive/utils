import { describe, expect, it } from 'vitest';

import { isCacheTagsInvalidateWebhook } from './webhook.js';

const valid = {
  entity_type: 'cda_cache_tags',
  event_type: 'invalidate',
  entity: { attributes: { tags: ['tag-a', 'tag-b'] } },
};

describe('isCacheTagsInvalidateWebhook', () => {
  it('accepts a well-formed payload', () => {
    expect(isCacheTagsInvalidateWebhook(valid)).toBe(true);
  });

  it('accepts a payload without event_type', () => {
    expect(isCacheTagsInvalidateWebhook({ entity_type: 'cda_cache_tags', entity: { attributes: { tags: [] } } })).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'cda_cache_tags'],
    ['a number', 42],
    ['an array', []],
    ['an empty object', {}],
    ['a missing entity', { entity_type: 'cda_cache_tags' }],
    ['a null entity', { entity_type: 'cda_cache_tags', entity: null }],
    ['a different entity_type', { entity_type: 'item', entity: { attributes: { tags: [] } } }],
    ['a missing attributes', { entity_type: 'cda_cache_tags', entity: {} }],
    ['a null attributes', { entity_type: 'cda_cache_tags', entity: { attributes: null } }],
    ['a missing tags', { entity_type: 'cda_cache_tags', entity: { attributes: {} } }],
    ['a non-array tags', { entity_type: 'cda_cache_tags', entity: { attributes: { tags: 'tag-a' } } }],
    ['non-string tag members', { entity_type: 'cda_cache_tags', entity: { attributes: { tags: ['ok', 7] } } }],
  ])('rejects %s', (_label, payload) => {
    expect(isCacheTagsInvalidateWebhook(payload)).toBe(false);
  });
});
