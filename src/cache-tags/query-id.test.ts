import { describe, expect, it } from 'vitest';

import { buildQueryId, type QueryDocumentLike } from './query-id.js';

const makeDocument = (name?: string, extra: Record<string, unknown> = {}): QueryDocumentLike => ({
  definitions: [
    {
      kind: 'OperationDefinition',
      ...(name ? { name: { kind: 'Name', value: name } } : {}),
      operation: 'query',
      selectionSet: { kind: 'SelectionSet', selections: [] },
      ...extra,
    },
  ],
});

describe('buildQueryId', () => {
  it('is deterministic across calls', () => {
    const document = makeDocument('PageBySlug');

    expect(buildQueryId({ document, variables: { slug: 'a' } })).toBe(buildQueryId({ document, variables: { slug: 'a' } }));
  });

  it('prefixes the readable operation name', () => {
    expect(buildQueryId({ document: makeDocument('PageBySlug') })).toMatch(/^PageBySlug-[0-9a-f]{16}$/);
  });

  it('falls back to `anonymous` for an unnamed operation', () => {
    expect(buildQueryId({ document: makeDocument() })).toMatch(/^anonymous-[0-9a-f]{16}$/);
  });

  it('stays well under the 256-character cache-tag limit', () => {
    const id = buildQueryId({ document: makeDocument('A'.repeat(64)), prefix: 'flimslaax' });

    expect(id.length).toBeLessThan(256);
  });

  it('applies a prefix for stores shared between projects', () => {
    const document = makeDocument('Layout');

    expect(buildQueryId({ document, prefix: 'flf' })).toBe(`flf:${buildQueryId({ document })}`);
  });

  it('separates identical queries across DatoCMS environments', () => {
    const document = makeDocument('Layout');

    expect(buildQueryId({ document, environment: 'main' })).not.toBe(buildQueryId({ document, environment: 'sandbox' }));
  });

  it('treats a missing environment as distinct from a named one', () => {
    const document = makeDocument('Layout');

    expect(buildQueryId({ document })).not.toBe(buildQueryId({ document, environment: 'main' }));
  });

  it('is insensitive to variable key order', () => {
    const document = makeDocument('Search');

    expect(buildQueryId({ document, variables: { a: 1, b: 2 } })).toBe(
      buildQueryId({ document, variables: { b: 2, a: 1 } }),
    );
  });

  it('is insensitive to nested variable key order', () => {
    const document = makeDocument('Search');

    expect(buildQueryId({ document, variables: { filter: { x: 1, y: 2 } } })).toBe(
      buildQueryId({ document, variables: { filter: { y: 2, x: 1 } } }),
    );
  });

  it('distinguishes different variable values', () => {
    const document = makeDocument('PageBySlug');

    expect(buildQueryId({ document, variables: { slug: 'a' } })).not.toBe(
      buildQueryId({ document, variables: { slug: 'b' } }),
    );
  });

  it('distinguishes no variables from empty variables', () => {
    const document = makeDocument('Layout');

    expect(buildQueryId({ document })).not.toBe(buildQueryId({ document, variables: {} }));
  });

  it('preserves array order in variables', () => {
    const document = makeDocument('ByIds');

    expect(buildQueryId({ document, variables: { ids: ['a', 'b'] } })).not.toBe(
      buildQueryId({ document, variables: { ids: ['b', 'a'] } }),
    );
  });

  it('distinguishes documents with different structure', () => {
    expect(buildQueryId({ document: makeDocument('A') })).not.toBe(buildQueryId({ document: makeDocument('B') }));
  });

  // `graphql-tag` attaches `loc` with absolute source offsets, which shift when unrelated
  // operations in the same file move. The hash must not follow those shifts.
  it('ignores `loc` on document nodes', () => {
    const withLoc = makeDocument('Layout', { loc: { start: 0, end: 120 } });
    const withOtherLoc = makeDocument('Layout', { loc: { start: 400, end: 520 } });

    expect(buildQueryId({ document: withLoc })).toBe(buildQueryId({ document: withOtherLoc }));
  });

  it('ignores `loc` at the document root', () => {
    const bare = makeDocument('Layout');
    const withRootLoc: QueryDocumentLike = { ...bare, loc: { start: 0, end: 9 } } as QueryDocumentLike;

    expect(buildQueryId({ document: withRootLoc })).toBe(buildQueryId({ document: bare }));
  });

  it('memoizes the document hash per document object', () => {
    const document = makeDocument('Layout');
    const first = buildQueryId({ document, variables: { a: 1 } });
    const second = buildQueryId({ document, variables: { a: 2 } });

    // Same document, different variables: both resolve, and the memoized document hash
    // keeps the operation-name prefix identical.
    expect(first.startsWith('Layout-')).toBe(true);
    expect(second.startsWith('Layout-')).toBe(true);
    expect(first).not.toBe(second);
  });

  it('never includes the API token', () => {
    const document = makeDocument('Layout');
    process.env.DATOCMS_API_TOKEN = 'super-secret-token';

    try {
      expect(buildQueryId({ document })).not.toContain('super-secret');
    } finally {
      delete process.env.DATOCMS_API_TOKEN;
    }
  });
});
