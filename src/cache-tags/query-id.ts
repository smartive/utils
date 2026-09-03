import { createHash } from 'node:crypto';

/**
 * The structural subset of a GraphQL `DocumentNode` needed to derive a query ID.
 *
 * Declared structurally so this module needs neither `graphql` nor `@0no-co/graphql.web`
 * as a dependency — `@datocms/cda-client` uses the latter, and pulling in the former
 * alongside it would put two incompatible AST implementations in the tree.
 */
export type QueryDocumentLike = {
  /**
   * Left as `unknown[]` so the package's own `TypedDocumentNode` — which declares
   * `readonly unknown[]` — is assignable. Definitions are narrowed where they are read.
   */
  readonly definitions: readonly unknown[];
};

type OperationDefinitionLike = {
  readonly kind: string;
  readonly name?: { readonly value?: unknown };
};

const isOperationDefinition = (definition: unknown): definition is OperationDefinitionLike =>
  typeof definition === 'object' && definition !== null && 'kind' in definition && definition.kind === 'OperationDefinition';

export type BuildQueryIdInput = {
  document: QueryDocumentLike;
  variables?: unknown;
  /**
   * Resolved DatoCMS environment. Included because a preview deployment and local
   * development may share one store, and the same query against `main` and a sandbox
   * must not collide.
   */
  environment?: string;
  /** Namespace for stores shared between several apps or projects. */
  prefix?: string;
};

/**
 * Documents produced by GraphQL codegen are module-level singletons, so hashing each one
 * once per process gives a ~100% hit rate.
 */
const documentHashes = new WeakMap<object, string>();

/**
 * `graphql-tag` and some codegen configurations attach `loc` to every AST node, carrying
 * absolute offsets into the source document. Those offsets shift when unrelated
 * operations in the same file move, which would change the hash without changing the
 * query. Dropping `loc` makes the hash depend only on query structure.
 */
const stripLoc = (_key: string, value: unknown): unknown => {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'loc' in value) {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'loc'));
  }

  return value;
};

const hashDocument = (document: QueryDocumentLike): string => {
  const memoized = documentHashes.get(document);

  if (memoized) {
    return memoized;
  }

  const hash = createHash('sha1').update(JSON.stringify(document, stripLoc)).digest('hex');
  documentHashes.set(document, hash);

  return hash;
};

/**
 * Variables are built fresh at each call site, so key order genuinely varies and has to
 * be normalized. (Documents do not need this — they are stable module-level values.)
 */
const stableStringify = (value: unknown): string => {
  if (value === undefined) {
    return '';
  }

  return JSON.stringify(value, (_key, nested: unknown) => {
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const record = nested as Record<string, unknown>;

      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]]),
      );
    }

    return nested;
  });
};

const getOperationName = (document: QueryDocumentLike): string => {
  const name = document.definitions.find(isOperationDefinition)?.name?.value;

  return typeof name === 'string' && name !== '' ? name : 'anonymous';
};

/**
 * Builds the deterministic Next.js cache tag that also joins to the cache-tag store.
 *
 * Format: `[prefix:]<operationName|anonymous>-<sha1(...).slice(0, 16)>`. The operation
 * name is kept readable because query IDs surface in webhook responses, `revalidateTag`
 * logs, and database rows, where `PageBySlug-a3f1…` is far easier to act on than a bare
 * hash. The result stays well under the 256-character limit Next.js places on cache tags.
 *
 * The API token is deliberately **not** part of the input: rotating it must not orphan
 * every stored mapping.
 *
 * Uses `node:crypto`, so it cannot run in the Edge runtime or middleware.
 */
export const buildQueryId = ({ document, variables, environment, prefix }: BuildQueryIdInput): string => {
  const hash = createHash('sha1')
    .update(JSON.stringify([hashDocument(document), environment ?? null, stableStringify(variables)]))
    .digest('hex')
    .slice(0, 16);

  const id = `${getOperationName(document)}-${hash}`;

  return prefix ? `${prefix}:${id}` : id;
};
