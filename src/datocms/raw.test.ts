import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { performQuery } from './raw.js';
import type { TypedDocumentNode } from './types.js';

const document = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      selectionSet: { kind: 'SelectionSet', selections: [] },
    },
  ],
} as TypedDocumentNode<{ ok: boolean }, Record<string, never>>;

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const getRequestHeaders = (fetchFn: ReturnType<typeof vi.fn>, callIndex = 0): Headers => {
  const init = fetchFn.mock.calls[callIndex]?.[1] as RequestInit | undefined;

  return new Headers(init?.headers);
};

describe('performQuery', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATOCMS_API_TOKEN;
    delete process.env.DATOCMS_ENVIRONMENT;
    delete process.env.NEXT_DATOCMS_BASE_EDITING_URL;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.DATOCMS_API_TOKEN;
    delete process.env.DATOCMS_ENVIRONMENT;
    delete process.env.NEXT_DATOCMS_BASE_EDITING_URL;
  });

  it('returns the query data', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse(200, { data: { ok: true } })));

    await expect(performQuery({ document, includeDrafts: false }, { apiToken: 'token', fetchFn })).resolves.toMatchObject({
      data: { ok: true },
    });
  });

  it('parses the x-cache-tags response header', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { data: { ok: true } }, { 'x-cache-tags': 'tag-a tag-b tag-a' }));

    const { cacheTags } = await performQuery({ document, includeDrafts: false }, { apiToken: 'token', fetchFn });

    expect(cacheTags).toEqual(['tag-a', 'tag-b']);
  });

  it('returns no cache tags when the header is absent', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse(200, { data: { ok: true } })));

    const { cacheTags } = await performQuery({ document, includeDrafts: false }, { apiToken: 'token', fetchFn });

    expect(cacheTags).toEqual([]);
  });

  it('requests cache tags for published queries', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse(200, { data: { ok: true } })));

    await performQuery({ document, includeDrafts: false }, { apiToken: 'token', fetchFn });

    expect(getRequestHeaders(fetchFn).get('X-Cache-Tags')).toBe('true');
  });

  // Draft responses are never tagged, so asking for them would just add a wasted header.
  it('does not request cache tags for draft queries', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse(200, { data: { ok: true } })));

    await performQuery({ document, includeDrafts: true }, { apiToken: 'token', fetchFn });

    const headers = getRequestHeaders(fetchFn);
    expect(headers.get('X-Cache-Tags')).toBeNull();
    expect(headers.get('X-Include-Drafts')).toBe('true');
  });

  // Under Cache Components `cacheLife` owns the lifetime; a fetch-level `next.revalidate`
  // would be a second, conflicting source of truth.
  it('sets no fetch cache options', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse(200, { data: { ok: true } })));

    await performQuery({ document, includeDrafts: false }, { apiToken: 'token', fetchFn });

    const init = fetchFn.mock.calls[0]?.[1] as (RequestInit & { next?: unknown }) | undefined;
    expect(init?.cache).toBeUndefined();
    expect(init?.next).toBeUndefined();
  });

  it('throws when no API token is configured', async () => {
    await expect(performQuery({ document, includeDrafts: false }, { fetchFn: vi.fn() })).rejects.toThrow(
      'Missing DATOCMS_API_TOKEN',
    );
  });

  it('resolves the environment through the shared resolver', async () => {
    process.env.DATOCMS_ENVIRONMENT = 'sandbox';
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse(200, { data: { ok: true } })));

    await performQuery({ document, includeDrafts: false }, { apiToken: 'token', fetchFn });

    expect(getRequestHeaders(fetchFn).get('X-Environment')).toBe('sandbox');
  });

  it('enables Content Link only for drafts with a base editing URL', async () => {
    process.env.NEXT_DATOCMS_BASE_EDITING_URL = 'https://project.admin.datocms.com';
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse(200, { data: { ok: true } })));

    await performQuery({ document, includeDrafts: false }, { apiToken: 'token', fetchFn });
    await performQuery({ document, includeDrafts: true }, { apiToken: 'token', fetchFn });

    expect(getRequestHeaders(fetchFn, 0).get('X-Visual-Editing')).toBeNull();
    expect(getRequestHeaders(fetchFn, 1).get('X-Visual-Editing')).toBe('v1');
    expect(getRequestHeaders(fetchFn, 1).get('X-Base-Editing-Url')).toBe('https://project.admin.datocms.com');
  });

  it('preserves cda-client auto-retry behaviour', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'X-RateLimit-Reset': '0' }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }));

    await expect(performQuery({ document, includeDrafts: false }, { apiToken: 'token', fetchFn })).resolves.toMatchObject({
      data: { ok: true },
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
