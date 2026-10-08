import { createServer } from 'node:http';

/**
 * Fixture site for the e2e tests. `127.0.0.1` stands in for an allowlisted CMS host
 * (same server, different origin than `localhost`), and `tracker.invalid` for a tracker
 * that must be blocked before it is ever resolved.
 */
const PORT = Number(process.env.PORT ?? 4173);
const ORIGIN = `http://localhost:${PORT}`;

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><title>fixture</title></head><body>${body}</body></html>`;

const urlset = (paths: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${paths.map((path) => `<url><loc>https://prod.example.com${path}</loc></url>`).join('\n')}
<url><loc>https://prod.example.com/de</loc><xhtml:link rel="alternate" hreflang="fr" href="https://prod.example.com/fr"/></url>
</urlset>`;

type Route = { status?: number; type?: string; location?: string; delayMs?: number; body: string };

const routes: Record<string, Route> = {
  '/sitemap.xml': {
    type: 'application/xml',
    body: `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<sitemap><loc>https://prod.example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`,
  },
  '/sitemap-pages.xml': { type: 'application/xml', body: urlset(['/', '/blog/a', '/blog/b', '/blog/c']) },
  '/': { body: page('<h1>Home</h1>') },
  '/blog/a': { body: page('<h1>A</h1>') },
  '/blog/b': { body: page('<h1>B</h1>') },
  '/blog/c': { body: page('<h1>C</h1>') },
  '/de': { body: page('<h1>DE</h1>') },
  '/fr': { body: page('<h1>FR</h1>') },
  '/console-error': { body: page('<script>console.error("client boom")</script>') },
  '/console-warning': { body: page('<script>console.warn("careful")</script>') },
  '/page-error': { body: page('<script>setTimeout(() => { throw new Error("uncaught boom") }, 0)</script>') },
  '/rejection': { body: page('<script>Promise.reject(new Error("unhandled rejection"))</script>') },
  '/missing-asset': { body: page('<img src="/missing.png" alt="">') },
  '/third-party': {
    body: page(
      `<script src="http://tracker.invalid/t.js"></script><script src="http://127.0.0.1:${PORT}/allowed.js"></script>`,
    ),
  },
  '/allowed.js': { type: 'text/javascript', body: 'window.allowedLoaded = true;' },
  '/aborted': {
    body: page(
      '<script>const c = new AbortController(); fetch("/slow", { signal: c.signal }).catch(() => {}); c.abort();</script>',
    ),
  },
  '/slow': { type: 'text/plain', delayMs: 2000, body: 'slow' },
  '/broken-request': { body: page('<script>fetch("/drop").catch(() => {})</script>') },
  '/redirect': { status: 308, location: '/', body: '' },
};

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', ORIGIN);

  if (pathname === '/drop') {
    request.socket.destroy();

    return;
  }

  const route = routes[pathname];

  if (!route) {
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');

    return;
  }

  const { status = 200, type = 'text/html; charset=utf-8', location, delayMs = 0, body } = route;
  const headers = { 'Content-Type': type, ...(location && { Location: location }) };

  setTimeout(() => response.writeHead(status, headers).end(body), delayMs);
}).listen(PORT, () => {
  console.info(`fixture server on ${ORIGIN}`);
});
