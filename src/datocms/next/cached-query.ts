import { cacheLife, cacheTag } from 'next/cache';
import { draftMode } from 'next/headers';

import { buildQueryId } from '../../cache-tags/query-id.js';
import type { CacheTagStore } from '../../cache-tags/types.js';
import { resolveEnvironment } from '../config.js';
import { performQuery } from '../raw.js';
import type { DatoClientConfig, TypedDocumentNode, WithVariables } from '../types.js';
import {
  resolveCacheMode,
  resolveCacheProfile,
  resolveCacheProfiles,
  type CacheLifeProfile,
  type CacheProfiles,
} from './policy.js';
import { getRegisteredClient, registerClient, type CacheDecision } from './registry.js';

export type { CacheDecision };

export type CachedDatoClientConfig = Omit<DatoClientConfig, 'revalidate'> & {
  /**
   * Identifies this client in the module-level registry, and forms part of the cache key.
   * Must be **stable across processes and deployments** — do not generate it. Only needs
   * setting when an app creates more than one cached client.
   */
  id?: string;
  /**
   * Persistence for the query-ID ⇄ DatoCMS cache-tag mapping.
   *
   * Without it, queries are still tagged with a deterministic `queryId`, but nothing can
   * look that tag up, so every entry falls back to the short `unstored` lifetime. Pass a
   * store in production.
   */
  store?: CacheTagStore;
  /** Overrides for the per-client `cacheLife` profiles. */
  profiles?: Partial<CacheProfiles>;
  /** Namespaces generated query IDs, for a store shared between apps or projects. */
  tagPrefix?: string;
  /** Observability hook, called once per query with the cache decision taken. */
  onCacheDecision?: (decision: CacheDecision) => void;
};

type CachedQueryOptionsBase<TResult, TVariables> = {
  document: TypedDocumentNode<TResult, TVariables>;
  /**
   * Explicitly request drafts. Bypasses the cache entirely, so the caller is guaranteed a
   * fresh read — use it for preview slug resolution and similar. Merely having draft mode
   * *enabled* does not need this: the cached path detects it and skips writing the cache.
   */
  includeDrafts?: boolean;
  /** Bypass the cache for this query. */
  skipCache?: boolean;
  /** Override the `cached` profile for this query. Ignored unless the mapping persisted. */
  cacheProfile?: CacheLifeProfile;
};

export type CachedQueryDatoCMSOptions<TResult = unknown, TVariables = unknown> = WithVariables<
  TVariables,
  CachedQueryOptionsBase<TResult, TVariables>
>;

export type CachedQueryDatoCMSFunction = <TResult = unknown, TVariables = unknown>(
  options: CachedQueryDatoCMSOptions<TResult, TVariables>,
) => Promise<TResult>;

/**
 * The cached scope.
 *
 * Declared at module level, and taking only serializable arguments, because Next binds
 * variables read from enclosing *function* scopes into the cache key — see `registry.ts`.
 * Everything non-serializable (the store, the callback, `fetchFn`) is reached through the
 * registry instead.
 */
const performCachedQuery = async <TResult, TVariables>(
  clientId: string,
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables | undefined,
  cacheProfile: CacheLifeProfile | undefined,
): Promise<TResult> => {
  'use cache';

  const { datoConfig, store, profiles, tagPrefix, onCacheDecision } = getRegisteredClient(clientId);

  // `draftMode().isEnabled` is the one request API readable inside a cached scope. While
  // draft mode is on Next re-executes this function per request and writes nothing to the
  // cache, so draft content is never persisted.
  const draftModeEnabled = (await draftMode()).isEnabled;

  const queryId = buildQueryId({
    document,
    variables,
    environment: resolveEnvironment(datoConfig),
    prefix: tagPrefix,
  });

  // A bypass never reaches this function — it is decided before entering the cached scope —
  // so the mode here is binary.
  if (draftModeEnabled) {
    const profile = resolveCacheProfile({ mode: 'draft', stored: false, profiles });
    cacheLife(profile);

    const { data } = await performQuery({ document, variables, includeDrafts: true }, datoConfig);

    onCacheDecision?.({ queryId, mode: 'draft', profile, cacheTagCount: 0, stored: false });

    return data;
  }

  cacheTag(queryId);

  const { data, cacheTags } = await performQuery({ document, variables, includeDrafts: false }, datoConfig);

  // Race: a webhook arriving between the response and this write can miss this entry
  // until its TTL expires or invalidate-all runs. Persisting before choosing the profile
  // keeps the window as small as possible.
  const stored = (await store?.storeQueryCacheTags(queryId, cacheTags)) ?? false;
  const profile = resolveCacheProfile({ mode: 'cached', stored, profiles, override: cacheProfile });

  cacheLife(profile);

  onCacheDecision?.({ queryId, mode: 'cached', profile, cacheTagCount: cacheTags.length, stored });

  return data;
};

/**
 * Creates a `queryDatoCMS` backed by Next 16 Cache Components.
 *
 * Requires `cacheComponents: true` in `next.config.ts` and Next >= 16. For projects
 * without it, use `@smartive/utils/datocms` instead.
 *
 * There is deliberately no ready-made default client: one without a `store` looks like it
 * works but can never be invalidated, which is the hardest cache failure to notice in
 * production. Naming the store is therefore a required, visible decision.
 */
export const createCachedDatoClient = (config: CachedDatoClientConfig = {}): CachedQueryDatoCMSFunction => {
  const { id = 'default', store, profiles, tagPrefix, onCacheDecision, ...datoConfig } = config;

  registerClient(id, {
    datoConfig,
    store,
    profiles: resolveCacheProfiles(profiles),
    tagPrefix,
    onCacheDecision,
  });

  return async function queryDatoCMS<TResult = unknown, TVariables = unknown>(
    options: CachedQueryDatoCMSOptions<TResult, TVariables>,
  ): Promise<TResult> {
    const { document, variables, includeDrafts, skipCache, cacheProfile } = options as CachedQueryOptionsBase<
      TResult,
      TVariables
    > & { variables?: TVariables };

    // Resolved outside the cached scope: a bypass must not enter one at all.
    if (resolveCacheMode({ includeDrafts, skipCache }) === 'bypass') {
      const { data } = await performQuery({ document, variables, includeDrafts: includeDrafts === true }, datoConfig);

      onCacheDecision?.({
        queryId: buildQueryId({ document, variables, environment: resolveEnvironment(datoConfig), prefix: tagPrefix }),
        mode: 'bypass',
        cacheTagCount: 0,
        stored: false,
      });

      return data;
    }

    return performCachedQuery(id, document, variables, cacheProfile);
  };
};
