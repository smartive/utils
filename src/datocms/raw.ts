import { rawExecuteQuery, type ExecuteQueryOptions } from '@datocms/cda-client';

import { parseXCacheTagsResponseHeader } from '../cache-tags/header.js';
import { resolveApiToken, resolveBaseEditingUrl, resolveEnvironment } from './config.js';
import { withRateLimitRetry } from './retry.js';
import type { DatoClientConfig, TypedDocumentNode } from './types.js';

type RawExecuteTypedQuery = <TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  options: ExecuteQueryOptions<TVariables>,
) => Promise<[TResult, Response]>;

// cda-client internalizes the same TypedDocumentNode contract, the same way `query.ts`
// casts `executeQuery`.
const rawExecuteTypedQuery = rawExecuteQuery as RawExecuteTypedQuery;

export type PerformQueryOptions<TResult, TVariables> = {
  document: TypedDocumentNode<TResult, TVariables>;
  variables?: TVariables;
  includeDrafts: boolean;
};

export type PerformQueryResult<TResult> = {
  data: TResult;
  /** Parsed `X-Cache-Tags`. Always empty when querying drafts, which are never tagged. */
  cacheTags: string[];
};

/**
 * Executes a DatoCMS query and returns its data **plus** the DatoCMS cache tags.
 *
 * Deliberately contains no `next/*` import and no caching directive: it is the transport
 * layer that `./next/cached-query.ts` wraps in `'use cache'`. That split keeps this
 * fully unit-testable via an injected `fetchFn`.
 *
 * Uses `rawExecuteQuery` rather than `executeQuery` because only the former exposes the
 * `Response`, and the cache tags arrive as a response header.
 */
export const performQuery = async <TResult, TVariables>(
  { document, variables, includeDrafts }: PerformQueryOptions<TResult, TVariables>,
  config: DatoClientConfig,
): Promise<PerformQueryResult<TResult>> => {
  const { excludeInvalid = true, contentLink = 'v1', endpoint, fetchFn } = config;
  const baseEditingUrl = includeDrafts ? resolveBaseEditingUrl(config) : undefined;

  const token = resolveApiToken(config);
  const environment = resolveEnvironment(config);

  const [data, response] = await withRateLimitRetry(
    () =>
      rawExecuteTypedQuery(document, {
        token,
        variables,
        includeDrafts,
        excludeInvalid,
        environment,
        // Draft responses carry no cache tags, and asking for them would be a wasted header.
        returnCacheTags: !includeDrafts,
        // Retries are bounded by `withRateLimitRetry`; cda-client's own retry never gives up.
        autoRetry: false,
        ...(endpoint ? { graphqlEndpointUrl: endpoint } : {}),
        ...(fetchFn ? { fetchFn } : {}),
        ...(baseEditingUrl ? { contentLink, baseEditingUrl } : {}),
        // No `requestInitOptions`: under Cache Components, `cacheLife` owns the lifetime and a
        // fetch-level `next.revalidate` would be a second, conflicting source of truth.
      }),
    config,
  );

  return { data, cacheTags: parseXCacheTagsResponseHeader(response.headers.get('x-cache-tags')) };
};
