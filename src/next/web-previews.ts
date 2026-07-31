import { type NextRequest, NextResponse } from 'next/server';

import { withCORS } from '../http/cors.js';
import { isValidToken } from '../http/tokens.js';
import { isSafeRelativePath } from '../http/urls.js';

/** Minimal structural types so `@datocms/cma-client` is not a dependency. */
export type WebPreviewItem = {
  id: string;
  meta: {
    status: string;
  };
  attributes: Record<string, unknown>;
};

export type WebPreviewItemType = {
  attributes: {
    api_key: string;
  };
};

export type WebPreviewRequest = {
  item: WebPreviewItem;
  itemType: WebPreviewItemType;
  locale?: string;
};

export type PreviewLink = {
  label: string;
  url: string;
  reloadPreviewOnRecordUpdate?: boolean | { delayInMs: number };
};

export type WebPreviewsLabels = {
  published: string;
  draft: string;
};

export type WebPreviewsHandlerConfig = {
  /** Resolves a relative preview path for the given DatoCMS item, or `null` when unsupported. */
  resolvePreviewUrl: (request: WebPreviewRequest) => Promise<string | null> | string | null;
  /**
   * Absolute base URL of the draft API routes, e.g. `https://example.com/api/draft`.
   * May be a string or a lazy resolver.
   */
  baseUrl: string | (() => string);
  /** Secret used to authorize the request. Falls back to `DRAFT_SECRET_TOKEN`. */
  secret?: string;
  /** Optional label resolver (async-capable for i18n). */
  resolveLabels?: (request: WebPreviewRequest) => Promise<WebPreviewsLabels> | WebPreviewsLabels;
  /** Passed through to the draft preview link when present. */
  reloadPreviewOnRecordUpdate?: boolean | { delayInMs: number };
};

const DEFAULT_LABELS: WebPreviewsLabels = {
  published: 'Published version',
  draft: 'Draft',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isWebPreviewRequest = (value: unknown): value is WebPreviewRequest => {
  if (!isRecord(value) || !isRecord(value.item) || !isRecord(value.itemType)) {
    return false;
  }

  const { item, itemType, locale } = value;
  const { attributes, meta } = item;
  const status = isRecord(meta) ? meta.status : undefined;
  const itemTypeAttributes = itemType.attributes;

  return (
    typeof item.id === 'string' &&
    isRecord(attributes) &&
    (status === 'draft' || status === 'published' || status === 'updated') &&
    isRecord(itemTypeAttributes) &&
    typeof itemTypeAttributes.api_key === 'string' &&
    (locale === undefined || typeof locale === 'string')
  );
};

const parsePreviewRequestBody = async (request: NextRequest): Promise<WebPreviewRequest | null> => {
  const body = await request.text();

  if (!body.trim()) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(body);

    return isWebPreviewRequest(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const createDraftModeUrl = (baseUrl: string, action: 'enable' | 'disable', params: Record<string, string>): string => {
  const url = new URL(baseUrl);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('baseUrl must use HTTP or HTTPS');
  }

  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${action}`;
  url.search = '';
  url.hash = '';

  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  return url.toString();
};

/**
 * Creates Next.js App Router handlers for the DatoCMS Web Previews plugin.
 */
export function createWebPreviewsHandler(config: WebPreviewsHandlerConfig) {
  const getSecret = () => config.secret ?? process.env.DRAFT_SECRET_TOKEN;

  function OPTIONS(): Response {
    return new Response('OK', withCORS());
  }

  async function POST(request: NextRequest): Promise<NextResponse> {
    try {
      const token = request.headers.get('Token') ?? request.nextUrl.searchParams.get('token');

      if (!token || !isValidToken(token, getSecret())) {
        return NextResponse.json({ error: 'Invalid Token' }, withCORS({ status: 401 }));
      }

      const parsedRequest = await parsePreviewRequestBody(request);

      if (!parsedRequest) {
        return NextResponse.json({ error: 'Invalid request data' }, withCORS({ status: 400 }));
      }

      const url = await config.resolvePreviewUrl(parsedRequest);

      if (!url) {
        return NextResponse.json({ previewLinks: [] }, withCORS({ status: 200 }));
      }

      if (!isSafeRelativePath(url)) {
        throw new TypeError('resolvePreviewUrl must return a safe relative path');
      }

      const baseUrl = typeof config.baseUrl === 'function' ? config.baseUrl() : config.baseUrl;
      const labels = (await config.resolveLabels?.(parsedRequest)) ?? DEFAULT_LABELS;
      const previewLinks: PreviewLink[] = [];

      if (parsedRequest.item.meta.status !== 'draft') {
        previewLinks.push({
          label: labels.published,
          url: createDraftModeUrl(baseUrl, 'disable', { url }),
        });
      }

      if (parsedRequest.item.meta.status !== 'published') {
        previewLinks.push({
          label: labels.draft,
          url: createDraftModeUrl(baseUrl, 'enable', { url, token }),
          ...(config.reloadPreviewOnRecordUpdate !== undefined
            ? { reloadPreviewOnRecordUpdate: config.reloadPreviewOnRecordUpdate }
            : {}),
        });
      }

      return NextResponse.json({ previewLinks }, withCORS({ status: 200 }));
    } catch (error: unknown) {
      console.error('Error handling web previews request:', error);

      return NextResponse.json({ error: 'An error occurred creating the preview links' }, withCORS({ status: 500 }));
    }
  }

  return { OPTIONS, POST };
}
