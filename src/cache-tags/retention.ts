/**
 * Default retention for a store's `deleteOrphanedCacheTags`.
 *
 * Shared by every store implementation so the orphan sweep behaves the same regardless of
 * backend. Long enough that a query which only runs rarely — a seasonal landing page, say —
 * keeps its mapping between runs.
 */
export const DEFAULT_ORPHAN_RETENTION_SECONDS = 30 * 24 * 60 * 60;
