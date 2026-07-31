import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebPreviewsHandler } from './web-previews.js';
import type { PreviewLink, WebPreviewRequest } from './web-previews.js';

const previewRequest = (status: string): WebPreviewRequest => ({
  item: {
    id: 'item-1',
    meta: { status },
    attributes: { slug: 'hello' },
  },
  itemType: {
    attributes: { api_key: 'page' },
  },
});

const request = (init?: RequestInit & { token?: string | null; search?: string }) => {
  const headers = new Headers(init?.headers);
  if (init?.token) {
    headers.set('Token', init.token);
  }

  return new NextRequest(`https://example.com/api/draft/preview-links${init?.search ?? ''}`, {
    method: 'POST',
    headers,
    body: init?.body,
  });
};

type WebPreviewsBody = {
  previewLinks: PreviewLink[];
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createWebPreviewsHandler', () => {
  const handlers = createWebPreviewsHandler({
    secret: 'draft-secret',
    baseUrl: 'https://example.com/api/draft',
    resolvePreviewUrl: () => '/page',
  });

  it('returns CORS headers on OPTIONS', () => {
    const response = handlers.OPTIONS();

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns 401 for an invalid token', async () => {
    const response = await handlers.POST(request({ token: 'wrong', body: JSON.stringify(previewRequest('published')) }));

    expect(response.status).toBe(401);
  });

  it('accepts a token from the query string', async () => {
    const response = await handlers.POST(
      request({
        search: '?token=draft-secret',
        body: JSON.stringify(previewRequest('draft')),
      }),
    );

    expect(response.status).toBe(200);
  });

  it('returns 400 for invalid request data', async () => {
    const response = await handlers.POST(request({ token: 'draft-secret', body: JSON.stringify({ item: { id: 'x' } }) }));

    expect(response.status).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const response = await handlers.POST(request({ token: 'draft-secret', body: '{' }));

    expect(response.status).toBe(400);
  });

  it('returns 400 when item metadata is missing', async () => {
    const invalidRequest = previewRequest('draft');
    Reflect.deleteProperty(invalidRequest.item, 'meta');

    const response = await handlers.POST(request({ token: 'draft-secret', body: JSON.stringify(invalidRequest) }));

    expect(response.status).toBe(400);
  });

  it('returns an empty previewLinks array when the resolver returns null', async () => {
    const emptyHandlers = createWebPreviewsHandler({
      secret: 'draft-secret',
      baseUrl: 'https://example.com/api/draft',
      resolvePreviewUrl: () => null,
    });

    const response = await emptyHandlers.POST(
      request({ token: 'draft-secret', body: JSON.stringify(previewRequest('published')) }),
    );
    const body = (await response.json()) as WebPreviewsBody;

    expect(response.status).toBe(200);
    expect(body).toEqual({ previewLinks: [] });
  });

  it('rejects unsafe paths returned by the resolver', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unsafeHandlers = createWebPreviewsHandler({
      secret: 'draft-secret',
      baseUrl: 'https://example.com/api/draft',
      resolvePreviewUrl: () => '//evil.example',
    });

    const response = await unsafeHandlers.POST(
      request({ token: 'draft-secret', body: JSON.stringify(previewRequest('draft')) }),
    );

    expect(response.status).toBe(500);
  });

  it('returns only the draft link for draft records', async () => {
    const response = await handlers.POST(request({ token: 'draft-secret', body: JSON.stringify(previewRequest('draft')) }));
    const body = (await response.json()) as WebPreviewsBody;

    expect(body.previewLinks).toHaveLength(1);
    expect(body.previewLinks[0]).toEqual({
      label: 'Draft',
      url: 'https://example.com/api/draft/enable?url=%2Fpage&token=draft-secret',
    });
  });

  it('returns only the published link for published records', async () => {
    const response = await handlers.POST(
      request({ token: 'draft-secret', body: JSON.stringify(previewRequest('published')) }),
    );
    const body = (await response.json()) as WebPreviewsBody;

    expect(body.previewLinks).toHaveLength(1);
    expect(body.previewLinks[0]).toEqual({
      label: 'Published version',
      url: 'https://example.com/api/draft/disable?url=%2Fpage',
    });
  });

  it('returns both links for updated records and supports async labels', async () => {
    const resolveLabels = vi.fn(() =>
      Promise.resolve({
        published: 'Veröffentlicht',
        draft: 'Entwurf',
      }),
    );

    const labeledHandlers = createWebPreviewsHandler({
      secret: 'draft-secret',
      baseUrl: () => 'https://example.com/api/draft',
      reloadPreviewOnRecordUpdate: { delayInMs: 100 },
      resolvePreviewUrl: () => '/page',
      resolveLabels,
    });

    const response = await labeledHandlers.POST(
      request({ token: 'draft-secret', body: JSON.stringify(previewRequest('updated')) }),
    );
    const body = (await response.json()) as WebPreviewsBody;

    expect(resolveLabels).toHaveBeenCalled();
    expect(body.previewLinks).toEqual([
      {
        label: 'Veröffentlicht',
        url: 'https://example.com/api/draft/disable?url=%2Fpage',
      },
      {
        label: 'Entwurf',
        url: 'https://example.com/api/draft/enable?url=%2Fpage&token=draft-secret',
        reloadPreviewOnRecordUpdate: { delayInMs: 100 },
      },
    ]);
  });

  it('encodes redirect paths and tokens as query parameters', async () => {
    const secret = 'draft&secret=#value';
    const encodedHandlers = createWebPreviewsHandler({
      secret,
      baseUrl: 'https://example.com/api/draft/',
      resolvePreviewUrl: () => '/page?first=one&second=two',
    });

    const response = await encodedHandlers.POST(request({ token: secret, body: JSON.stringify(previewRequest('draft')) }));
    const body = (await response.json()) as WebPreviewsBody;
    const previewUrl = new URL(body.previewLinks[0]?.url ?? '');

    expect(previewUrl.pathname).toBe('/api/draft/enable');
    expect(previewUrl.searchParams.get('url')).toBe('/page?first=one&second=two');
    expect(previewUrl.searchParams.get('token')).toBe(secret);
  });
});
