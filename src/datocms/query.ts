import { executeQuery, type ExecuteQueryOptions } from '@datocms/cda-client';

import type { DatoClientConfig, QueryDatoCMSFunction, QueryDatoCMSOptions, TypedDocumentNode } from './types.js';

const PRODUCTION_REVALIDATE_SECONDS = 24 * 60 * 60;

type ExecuteTypedQuery = <TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  options: ExecuteQueryOptions<TVariables>,
) => Promise<TResult>;

// cda-client internalizes the same TypedDocumentNode contract.
const executeTypedQuery = executeQuery as ExecuteTypedQuery;

const resolveApiToken = (config: DatoClientConfig): string => {
  const token = config.apiToken ?? process.env.DATOCMS_API_TOKEN;

  if (!token) {
    throw new Error('[datocms] Missing DATOCMS_API_TOKEN');
  }

  return token;
};

const resolveBaseEditingUrl = (config: DatoClientConfig): string | undefined => {
  const value = (config.baseEditingUrl ?? process.env.NEXT_DATOCMS_BASE_EDITING_URL)?.trim();

  if (value === undefined || value === '') {
    return undefined;
  }

  return value;
};

const getFetchCacheOptions = (
  options: Pick<QueryDatoCMSOptions, 'includeDrafts' | 'skipCache' | 'revalidate'>,
  config: DatoClientConfig,
): { revalidate: number; cache: 'no-store' | 'force-cache' } => {
  if (options.includeDrafts === true || options.skipCache === true || process.env.NODE_ENV === 'development') {
    return { revalidate: 0, cache: 'no-store' };
  }

  return {
    revalidate: options.revalidate ?? config.revalidate ?? PRODUCTION_REVALIDATE_SECONDS,
    cache: 'force-cache',
  };
};

/**
 * Creates a typed `queryDatoCMS` function backed by `@datocms/cda-client`.
 */
export function createDatoClient(config: DatoClientConfig = {}): QueryDatoCMSFunction {
  const { excludeInvalid = true, autoRetry, contentLink = 'v1', endpoint, fetchFn } = config;

  return async function queryDatoCMS<TResult = unknown, TVariables = unknown>(
    options: QueryDatoCMSOptions<TResult, TVariables>,
  ): Promise<TResult> {
    const { document, variables, includeDrafts } = options;
    const { revalidate, cache } = getFetchCacheOptions(options, config);
    const baseEditingUrl = includeDrafts ? resolveBaseEditingUrl(config) : undefined;
    const environment = config.environment ?? process.env.DATOCMS_ENVIRONMENT;
    const requestInitOptions: RequestInit & { next: { revalidate: number } } = {
      cache,
      next: { revalidate },
    };

    return executeTypedQuery(document, {
      token: resolveApiToken(config),
      variables,
      includeDrafts,
      excludeInvalid,
      environment,
      ...(autoRetry === undefined ? {} : { autoRetry }),
      ...(endpoint ? { graphqlEndpointUrl: endpoint } : {}),
      ...(fetchFn ? { fetchFn } : {}),
      ...(baseEditingUrl ? { contentLink, baseEditingUrl } : {}),
      requestInitOptions,
    });
  };
}

/** Default client that resolves configuration from environment variables. */
export const queryDatoCMS = createDatoClient();
