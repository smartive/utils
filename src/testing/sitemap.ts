import type { Pattern } from './patterns.js';
import { excludeRoutes, limitRoutes, toPath, type RouteLimit } from './routes.js';

export type ParsedSitemap = {
  /** Page URLs: every `<loc>` of a `<urlset>`, plus `xhtml:link` alternates. */
  urls: string[];
  /** Child sitemap URLs of a `<sitemapindex>`. */
  sitemaps: string[];
};

export type FetchSitemapRoutesOptions = {
  /** Origin the sitemap is fetched from. Sitemap hosts are replaced by it. */
  baseURL: string;
  /** Default `'/sitemap.xml'`. */
  sitemapPath?: string;
  /** Applied after {@link FetchSitemapRoutesOptions.exclude}. */
  limits?: readonly RouteLimit[];
  /** Routes to drop entirely, e.g. pages behind auth or with live webcams. */
  exclude?: readonly Pattern[];
  /** Per sitemap request. Default 30 seconds, so a hanging sitemap fails the setup instead of stalling it. */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
};

const DEFAULT_SITEMAP_PATH = '/sitemap.xml';
const DEFAULT_TIMEOUT_MS = 30_000;
/** A sitemap index may only reference sitemaps, so one level is all the spec allows. */
const MAX_INDEX_DEPTH = 2;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decodeEntities = (value: string): string =>
  value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }

    if (name.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    }

    return ENTITIES[name.toLowerCase()] ?? entity;
  });

const unwrap = (value: string): string =>
  decodeEntities(
    value
      .trim()
      .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
      .trim(),
  );

const LOC = /<loc>([\s\S]*?)<\/loc>/g;
const ALTERNATE = /<xhtml:link\b[^>]*?\bhref=(["'])(.*?)\1/g;

/**
 * Extracts URLs from a sitemap or sitemap index. Regex-based on purpose: sitemaps are a
 * flat, machine-written format, and a real XML parser would be this package's first
 * runtime dependency.
 */
export const parseSitemap = (xml: string): ParsedSitemap => {
  const locs = [...xml.matchAll(LOC)].map(([, value]) => unwrap(value)).filter(Boolean);

  if (/<sitemapindex[\s>]/.test(xml)) {
    return { urls: [], sitemaps: locs };
  }

  if (!/<urlset[\s>]/.test(xml)) {
    throw new Error('[testing] Not a sitemap: expected a <urlset> or <sitemapindex> root element');
  }

  const alternates = [...xml.matchAll(ALTERNATE)].map(([, , value]) => unwrap(value)).filter(Boolean);

  return { urls: [...locs, ...alternates], sitemaps: [] };
};

/**
 * Fetches the sitemap (following a sitemap index) and returns deduplicated paths, so the
 * same routes can be visited against localhost, a preview, or production.
 *
 * Throws when the sitemap is unreachable or lists no pages: an empty route list would
 * otherwise turn into a green test run that checked nothing.
 */
export const fetchSitemapRoutes = async ({
  baseURL,
  sitemapPath = DEFAULT_SITEMAP_PATH,
  limits = [],
  exclude = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn = fetch,
}: FetchSitemapRoutesOptions): Promise<string[]> => {
  const visited = new Set<string>();

  const fetchXml = async (url: string): Promise<string> => {
    try {
      // The signal also covers reading the body, which is where a slow sitemap spends its time.
      const response = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });

      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      throw new Error(
        `[testing] Failed to fetch sitemap ${url}: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      );
    }
  };

  const collect = async (path: string, depth: number): Promise<string[]> => {
    const url = new URL(path, baseURL).toString();

    if (visited.has(url) || depth > MAX_INDEX_DEPTH) {
      return [];
    }

    visited.add(url);

    const { urls, sitemaps } = parseSitemap(await fetchXml(url));
    const nested = await Promise.all(sitemaps.map((sitemap) => collect(toPath(sitemap), depth + 1)));

    return [...urls.map(toPath), ...nested.flat()];
  };

  const routes = [...new Set(await collect(sitemapPath, 1))];

  if (routes.length === 0) {
    throw new Error(`[testing] No URLs found in sitemap ${new URL(sitemapPath, baseURL).toString()}`);
  }

  return limitRoutes(excludeRoutes(routes, exclude), limits);
};
