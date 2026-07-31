import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDatoClient } from './query.js';
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

const getRequestHeaders = (fetchFn: ReturnType<typeof vi.fn>, callIndex: number): Headers => {
  const init = fetchFn.mock.calls[callIndex]?.[1] as RequestInit | undefined;

  return new Headers(init?.headers);
};

describe('createDatoClient / queryDatoCMS', () => {
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

  it('throws when no API token is configured', async () => {
    const queryDatoCMS = createDatoClient({
      fetchFn: vi.fn(),
    });

    await expect(queryDatoCMS({ document })).rejects.toThrow('Missing DATOCMS_API_TOKEN');
  });

  it('prefers config.apiToken over DATOCMS_API_TOKEN', async () => {
    process.env.DATOCMS_API_TOKEN = 'env-token';

    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
    const queryDatoCMS = createDatoClient({ apiToken: 'config-token', fetchFn });

    await queryDatoCMS({ document });

    expect(getRequestHeaders(fetchFn, 0).get('Authorization')).toBe('Bearer config-token');
  });

  it('falls back to DATOCMS_API_TOKEN', async () => {
    process.env.DATOCMS_API_TOKEN = 'env-token';

    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
    const queryDatoCMS = createDatoClient({ fetchFn });

    await queryDatoCMS({ document });

    expect(getRequestHeaders(fetchFn, 0).get('Authorization')).toBe('Bearer env-token');
  });

  it('uses no-store for drafts', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
    const queryDatoCMS = createDatoClient({ apiToken: 'token', fetchFn });

    await queryDatoCMS({ document, includeDrafts: true });

    expect(fetchFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        cache: 'no-store',
        next: { revalidate: 0 },
      }),
    );

    expect(getRequestHeaders(fetchFn, 0).get('X-Include-Drafts')).toBe('true');
  });

  it('uses no-store for skipCache', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
    const queryDatoCMS = createDatoClient({ apiToken: 'token', fetchFn });

    await queryDatoCMS({ document, skipCache: true });

    expect(fetchFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        cache: 'no-store',
        next: { revalidate: 0 },
      }),
    );
  });

  it('bypasses the Next.js data cache in development', async () => {
    process.env.NODE_ENV = 'development';

    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
    const queryDatoCMS = createDatoClient({ apiToken: 'token', fetchFn });

    await queryDatoCMS({ document });

    expect(fetchFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        cache: 'no-store',
        next: { revalidate: 0 },
      }),
    );
  });

  it('uses force-cache with a 24h revalidate for published production queries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
    const queryDatoCMS = createDatoClient({ apiToken: 'token', fetchFn });

    await queryDatoCMS({ document });

    expect(fetchFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        cache: 'force-cache',
        next: { revalidate: 24 * 60 * 60 },
      }),
    );
  });

  it('preserves cda-client auto-retry defaults', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'X-RateLimit-Reset': '0' }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }));
    const queryDatoCMS = createDatoClient({ apiToken: 'token', fetchFn });

    await expect(queryDatoCMS({ document })).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('sets X-Environment when configured', async () => {
    process.env.DATOCMS_ENVIRONMENT = 'main';

    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
    const queryDatoCMS = createDatoClient({ apiToken: 'token', fetchFn });

    await queryDatoCMS({ document });

    expect(getRequestHeaders(fetchFn, 0).get('X-Environment')).toBe('main');
  });

  it('sets Content Link headers only for drafts with a base editing URL', async () => {
    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, { data: { ok: true } })));
    const queryDatoCMS = createDatoClient({
      apiToken: 'token',
      baseEditingUrl: 'https://project.admin.datocms.com',
      fetchFn,
    });

    await queryDatoCMS({ document });
    expect(getRequestHeaders(fetchFn, 0).get('X-Visual-Editing')).toBeNull();
    expect(getRequestHeaders(fetchFn, 0).get('X-Base-Editing-Url')).toBeNull();

    await queryDatoCMS({ document, includeDrafts: true });
    expect(getRequestHeaders(fetchFn, 1).get('X-Visual-Editing')).toBe('v1');
    expect(getRequestHeaders(fetchFn, 1).get('X-Base-Editing-Url')).toBe('https://project.admin.datocms.com');
  });

  it('trims the configured base editing URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
    const queryDatoCMS = createDatoClient({
      apiToken: 'token',
      baseEditingUrl: '  https://project.admin.datocms.com  ',
      fetchFn,
    });

    await queryDatoCMS({ document, includeDrafts: true });

    expect(getRequestHeaders(fetchFn, 0).get('X-Base-Editing-Url')).toBe('https://project.admin.datocms.com');
  });

  it('returns query data', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
    const queryDatoCMS = createDatoClient({ apiToken: 'token', fetchFn });

    await expect(queryDatoCMS({ document })).resolves.toEqual({ ok: true });
  });
});
