/**
 * A GraphQL `DocumentNode` with attached generics for its result data and variables.
 *
 * Internalized from `@graphql-typed-document-node/core` for compatibility reasons,
 * the same way `@datocms/cda-client` does, so consumers do not need that package as
 * a runtime or type dependency of `@smartive/utils`.
 *
 * @see https://github.com/dotansimha/graphql-typed-document-node
 */
export type TypedDocumentNode<Result = Record<string, unknown>, Variables = Record<string, unknown>> = {
  kind: string;
  definitions: readonly unknown[];
  /** Type to support `@graphql-typed-document-node/core` */
  __apiType?: (variables: Variables) => Result;
  /** Type to support `TypedQueryDocumentNode` from `graphql` */
  __ensureTypesOfVariablesAndResultMatching?: (variables: Variables) => Result;
};

export type DatoClientConfig = {
  /** API token. Falls back to `DATOCMS_API_TOKEN`. */
  apiToken?: string;
  /** DatoCMS environment. Falls back to `DATOCMS_ENVIRONMENT`. */
  environment?: string;
  /**
   * Base editing URL for Content Link (e.g. `https://project.admin.datocms.com`).
   * Falls back to `NEXT_DATOCMS_BASE_EDITING_URL`. Enabled only when querying drafts.
   */
  baseEditingUrl?: string;
  /** Content Link version. Defaults to `'v1'` when a base editing URL is set. */
  contentLink?: 'v1' | 'vercel-v1';
  /** GraphQL endpoint. Defaults to the DatoCMS CDA endpoint. */
  endpoint?: string;
  /** Filter out invalid records. Defaults to `true`. */
  excludeInvalid?: boolean;
  /** Auto-retry on 429. Defaults to `true` (cda-client default). */
  autoRetry?: boolean;
  /** Published revalidate TTL in seconds. Defaults to 86400 (24 hours). */
  revalidate?: number;
  /** Custom fetch implementation (useful for tests). */
  fetchFn?: typeof fetch;
};

type QueryOptionsBase<TResult, TVariables> = {
  document: TypedDocumentNode<TResult, TVariables>;
  includeDrafts?: boolean;
  /** Force cache bypass even for published content. */
  skipCache?: boolean;
  /** Override the published revalidate TTL for this query (seconds). */
  revalidate?: number;
};

/**
 * Adds `variables` to `TOptions`, required when the GraphQL document has required
 * variables and optional otherwise.
 */
export type WithVariables<TVariables, TOptions> =
  Record<string, never> extends TVariables ? TOptions & { variables?: TVariables } : TOptions & { variables: TVariables };

/**
 * Makes `variables` required when the GraphQL document has required variables,
 * optional otherwise.
 */
export type QueryDatoCMSOptions<TResult = unknown, TVariables = unknown> = WithVariables<
  TVariables,
  QueryOptionsBase<TResult, TVariables>
>;

export type QueryDatoCMSFunction = <TResult = unknown, TVariables = unknown>(
  options: QueryDatoCMSOptions<TResult, TVariables>,
) => Promise<TResult>;
