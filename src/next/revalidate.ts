import { revalidatePath } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';

import { withCORS } from '../http/cors.js';
import { isValidToken } from '../http/tokens.js';

export type RevalidateHandlerConfig = {
  /** Secret expected in the `Webhook-Token` header. Falls back to `CACHE_INVALIDATION_SECRET_TOKEN`. */
  secret?: string;
  /**
   * Extra paths to revalidate in addition to `'/'` with `'layout'`.
   * Use for non-layout targets such as `/sitemap.xml` or `/stations.pdf`.
   */
  paths?: string[];
};

/**
 * Creates a Next.js App Router POST handler for DatoCMS cache-invalidation webhooks.
 */
export function createRevalidateHandler(config: RevalidateHandlerConfig = {}) {
  const getSecret = () => config.secret ?? process.env.CACHE_INVALIDATION_SECRET_TOKEN;
  const paths = config.paths ?? [];

  return function POST(request: NextRequest): NextResponse {
    if (!isValidToken(request.headers.get('Webhook-Token'), getSecret())) {
      return NextResponse.json({ error: 'Invalid Token' }, withCORS({ status: 401 }));
    }

    try {
      revalidatePath('/', 'layout');

      for (const path of paths) {
        revalidatePath(path);
      }
    } catch (error: unknown) {
      console.error('Error revalidating the path:', error);

      return NextResponse.json({ error: 'Failed to revalidate the path' }, withCORS({ status: 500 }));
    }

    return NextResponse.json({ success: true }, withCORS());
  };
}
