import { print, type DocumentNode } from 'graphql';
import { createHash } from 'node:crypto';

type HeadersInit = NonNullable<ConstructorParameters<typeof Headers>[0]>;

/**
 * Generates a unique query ID based on the query document, its variables, and optional HTTP headers.
 *
 * Uses Node.js `crypto.createHash` and therefore cannot run in the Next.js Edge runtime or middleware.
 *
 * @param {DocumentNode} document Query document
 * @param {TVariables} variables Optional query variables
 * @param {HeadersInit} headers Optional HTTP headers that might affect the query result (e.g., for authentication)
 * @returns Unique query ID
 */
export const generateQueryId = <TVariables = unknown>(
  document: DocumentNode,
  variables?: TVariables,
  headers?: HeadersInit,
): string => {
  return createHash('sha1')
    .update('document:')
    .update(print(document))
    .update('\0variables:')
    .update(stableStringify(variables))
    .update('\0headers:')
    .update(normalizeHeaders(headers))
    .digest('hex');
};

const stableStringify = (value: unknown): string => {
  if (value === undefined) {
    return '';
  }

  return JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      const record = nestedValue as Record<string, unknown>;

      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]]),
      );
    }

    return nestedValue;
  });
};

const normalizeHeaders = (headers?: HeadersInit): string => {
  if (headers === undefined) {
    return '';
  }

  return JSON.stringify([...new Headers(headers).entries()].sort(([a], [b]) => a.localeCompare(b)));
};
