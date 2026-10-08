import { describe, expect, it, vi } from 'vitest';

import { fetchSitemapRoutes, parseSitemap } from './sitemap.js';

const urlset = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${body}
</urlset>`;

const sitemapIndex = (locs: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`).join('\n')}
</sitemapindex>`;

const xmlResponse = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'application/xml' } });

describe('parseSitemap', () => {
  it('reads <loc> values of a urlset', () => {
    expect(
      parseSitemap(
        urlset(`
<url><loc>https://example.com/</loc><lastmod>2026-01-01</lastmod></url>
<url><loc>
  https://example.com/kontakt
</loc></url>`),
      ),
    ).toEqual({ urls: ['https://example.com/', 'https://example.com/kontakt'], sitemaps: [] });
  });

  it('includes xhtml:link alternates', () => {
    const { urls } = parseSitemap(
      urlset(`<url>
  <loc>https://example.com/de</loc>
  <xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr"/>
  <xhtml:link rel='alternate' hreflang='it' href='https://example.com/it' />
</url>`),
    );

    expect(urls).toEqual(['https://example.com/de', 'https://example.com/fr', 'https://example.com/it']);
  });

  it('decodes entities and CDATA', () => {
    const { urls } = parseSitemap(
      urlset(`
<url><loc>https://example.com/?a=1&amp;b=2</loc></url>
<url><loc><![CDATA[https://example.com/caf&eacute;]]></loc></url>
<url><loc>https://example.com/caf&#xE9;&#33;</loc></url>`),
    );

    expect(urls).toEqual(['https://example.com/?a=1&b=2', 'https://example.com/caf&eacute;', 'https://example.com/café!']);
  });

  it('returns child sitemaps of an index', () => {
    expect(parseSitemap(sitemapIndex(['https://example.com/a.xml', 'https://example.com/b.xml']))).toEqual({
      urls: [],
      sitemaps: ['https://example.com/a.xml', 'https://example.com/b.xml'],
    });
  });

  it('returns no URLs for an empty urlset', () => {
    expect(parseSitemap(urlset(''))).toEqual({ urls: [], sitemaps: [] });
  });

  it('throws for documents that are not sitemaps', () => {
    expect(() => parseSitemap('<!doctype html><html><body>Not found</body></html>')).toThrow('Not a sitemap');
  });
});

describe('fetchSitemapRoutes', () => {
  it('fetches /sitemap.xml from the base URL and returns paths', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        xmlResponse(
          urlset('<url><loc>https://prod.example.com/</loc></url><url><loc>https://prod.example.com/a</loc></url>'),
        ),
      );

    await expect(fetchSitemapRoutes({ baseURL: 'http://localhost:3000', fetchFn })).resolves.toEqual(['/', '/a']);
    expect(fetchFn).toHaveBeenCalledWith('http://localhost:3000/sitemap.xml', expect.anything());
  });

  it('follows a sitemap index against the base URL host', async () => {
    const responses: Record<string, string> = {
      'http://localhost:3000/sitemap.xml': sitemapIndex([
        'https://prod.example.com/pages.xml',
        'https://prod.example.com/news.xml',
      ]),
      'http://localhost:3000/pages.xml': urlset('<url><loc>https://prod.example.com/</loc></url>'),
      'http://localhost:3000/news.xml': urlset('<url><loc>https://prod.example.com/news/a</loc></url>'),
    };
    const fetchFn = vi.fn((input: RequestInfo | URL) => {
      const body = responses[input as string];

      return Promise.resolve(xmlResponse(body ?? '', body ? 200 : 404));
    });

    await expect(fetchSitemapRoutes({ baseURL: 'http://localhost:3000', fetchFn })).resolves.toEqual(['/', '/news/a']);
  });

  it('does not loop on a self-referencing index', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        xmlResponse(sitemapIndex(['https://prod.example.com/sitemap.xml', 'https://prod.example.com/pages.xml'])),
      ),
    );

    await expect(fetchSitemapRoutes({ baseURL: 'http://localhost:3000', fetchFn })).rejects.toThrow('No URLs found');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('deduplicates, excludes and limits routes', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        xmlResponse(
          urlset(
            ['/', '/arbeiten/a', '/arbeiten/b', '/arbeiten/c', '/arbeiten/d', '/livebilder', '/']
              .map((path) => `<url><loc>https://prod.example.com${path}</loc></url>`)
              .join(''),
          ),
        ),
      );

    await expect(
      fetchSitemapRoutes({
        baseURL: 'http://localhost:3000',
        sitemapPath: '/custom-sitemap.xml',
        exclude: ['/livebilder'],
        limits: [{ pattern: '/arbeiten/', max: 3 }],
        fetchFn,
      }),
    ).resolves.toEqual(['/', '/arbeiten/a', '/arbeiten/b', '/arbeiten/c']);
    expect(fetchFn).toHaveBeenCalledWith('http://localhost:3000/custom-sitemap.xml', expect.anything());
  });

  it('throws on a non-200 sitemap', async () => {
    const fetchFn = vi.fn().mockResolvedValue(xmlResponse('nope', 503));

    await expect(fetchSitemapRoutes({ baseURL: 'http://localhost:3000', fetchFn })).rejects.toThrow(
      'Failed to fetch sitemap http://localhost:3000/sitemap.xml: HTTP 503',
    );
  });

  it('times out a hanging sitemap request', async () => {
    const fetchFn = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
        }),
    );

    await expect(fetchSitemapRoutes({ baseURL: 'http://localhost:3000', timeoutMs: 10, fetchFn })).rejects.toThrow(
      /^\[testing\] Failed to fetch sitemap http:\/\/localhost:3000\/sitemap\.xml: .*timeout/,
    );
  });

  it('adds the sitemap URL to network errors', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    await expect(fetchSitemapRoutes({ baseURL: 'http://localhost:3000', fetchFn })).rejects.toThrow(
      'Failed to fetch sitemap http://localhost:3000/sitemap.xml: fetch failed',
    );
  });

  it('throws when the sitemap lists no pages', async () => {
    const fetchFn = vi.fn().mockResolvedValue(xmlResponse(urlset('')));

    await expect(fetchSitemapRoutes({ baseURL: 'http://localhost:3000', fetchFn })).rejects.toThrow('No URLs found');
  });
});
