import type { CacheTagsInvalidateWebhook } from './types.js';

/**
 * Narrows an untrusted request body to the DatoCMS `cda_cache_tags` invalidation payload.
 *
 * Deliberately strict: the handler turns these tags into `revalidateTag` calls, so a
 * malformed or unexpected payload must be rejected with a 400 rather than silently
 * invalidating nothing (which DatoCMS would record as a successful delivery).
 */
export const isCacheTagsInvalidateWebhook = (payload: unknown): payload is CacheTagsInvalidateWebhook => {
  if (typeof payload !== 'object' || payload === null || !('entity_type' in payload) || !('entity' in payload)) {
    return false;
  }

  const { entity, entity_type: entityType } = payload;

  if (entityType !== 'cda_cache_tags' || typeof entity !== 'object' || entity === null || !('attributes' in entity)) {
    return false;
  }

  const { attributes } = entity;

  return (
    typeof attributes === 'object' &&
    attributes !== null &&
    'tags' in attributes &&
    Array.isArray(attributes.tags) &&
    attributes.tags.every((tag) => typeof tag === 'string')
  );
};
