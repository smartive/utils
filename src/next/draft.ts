import { cookies, draftMode } from 'next/headers';
import { redirect } from 'next/navigation';
import { type NextRequest, NextResponse } from 'next/server';

import { withCORS } from '../http/cors.js';
import { isValidToken } from '../http/tokens.js';
import { isSafeRelativePath } from '../http/urls.js';

export type DraftHandlersConfig = {
  /** Secret used to authorize enable/disable. Falls back to `DRAFT_SECRET_TOKEN`. */
  secret?: string;
};

/**
 * Re-sets the `__prerender_bypass` cookie with `SameSite=None; Secure; Partitioned`
 * so draft mode survives inside a cross-origin iframe (e.g. the DatoCMS preview).
 */
export async function makeDraftModeWorkWithinIframes(): Promise<void> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get('__prerender_bypass');

  if (!cookie) {
    return;
  }

  cookieStore.set({
    name: '__prerender_bypass',
    value: cookie.value,
    httpOnly: true,
    path: '/',
    secure: true,
    sameSite: 'none',
    partitioned: true,
  });
}

/**
 * Creates Next.js App Router handlers for enabling and disabling draft mode.
 *
 * Redirect targets are read from the `url` query parameter.
 */
export function createDraftHandlers(config: DraftHandlersConfig = {}) {
  const getSecret = () => config.secret ?? process.env.DRAFT_SECRET_TOKEN;

  async function enable(request: NextRequest): Promise<NextResponse> {
    const token = request.nextUrl.searchParams.get('token');
    const redirectTo = request.nextUrl.searchParams.get('url') ?? '/';

    if (!isValidToken(token, getSecret())) {
      return NextResponse.json({ error: 'Invalid Token' }, withCORS({ status: 401 }));
    }

    if (!isSafeRelativePath(redirectTo)) {
      return NextResponse.json({ error: 'URL must be relative' }, withCORS({ status: 422 }));
    }

    (await draftMode()).enable();
    await makeDraftModeWorkWithinIframes();

    redirect(redirectTo);
  }

  async function disable(request: NextRequest): Promise<NextResponse> {
    const token = request.nextUrl.searchParams.get('token');
    const redirectTo = request.nextUrl.searchParams.get('url');

    // Token is optional on disable so published-version preview links that omit
    // it still work. When present, it must match the secret.
    if (token && !isValidToken(token, getSecret())) {
      return NextResponse.json({ error: 'Invalid Token' }, withCORS({ status: 401 }));
    }

    if (redirectTo && !isSafeRelativePath(redirectTo)) {
      return NextResponse.json({ error: 'URL must be relative' }, withCORS({ status: 422 }));
    }

    (await draftMode()).disable();

    if (!redirectTo) {
      return NextResponse.json({ success: true }, withCORS());
    }

    await makeDraftModeWorkWithinIframes();

    redirect(redirectTo);
  }

  return { enable, disable };
}
