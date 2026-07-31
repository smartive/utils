import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const draftModeState = {
  enable: vi.fn(),
  disable: vi.fn(),
};

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
};

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock('next/headers', () => ({
  draftMode: vi.fn(() => Promise.resolve(draftModeState)),
  cookies: vi.fn(() => Promise.resolve(cookieStore)),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

const { createDraftHandlers, makeDraftModeWorkWithinIframes } = await import('./draft.js');

const request = (path: string) => new NextRequest(`https://example.com${path}`);

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.get.mockReturnValue({ value: 'bypass-cookie' });
});

describe('createDraftHandlers', () => {
  const handlers = createDraftHandlers({ secret: 'draft-secret' });

  it('does not rewrite the draft cookie when it is absent', async () => {
    cookieStore.get.mockReturnValue(undefined);

    await makeDraftModeWorkWithinIframes();

    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('returns 401 for enable with an invalid token', async () => {
    const response = await handlers.enable(request('/api/draft/enable?token=wrong&url=/page'));

    expect(response.status).toBe(401);
    expect(draftModeState.enable).not.toHaveBeenCalled();
  });

  it('returns 422 for an unsafe redirect target on enable', async () => {
    const response = await handlers.enable(request('/api/draft/enable?token=draft-secret&url=//evil.com'));

    expect(response.status).toBe(422);
    expect(draftModeState.enable).not.toHaveBeenCalled();
  });

  it('enables draft mode, rewrites the bypass cookie, and redirects', async () => {
    await expect(handlers.enable(request('/api/draft/enable?token=draft-secret&url=/page'))).rejects.toThrow(
      'REDIRECT:/page',
    );

    expect(draftModeState.enable).toHaveBeenCalled();
    expect(cookieStore.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '__prerender_bypass',
        value: 'bypass-cookie',
        sameSite: 'none',
        secure: true,
        partitioned: true,
      }),
    );
  });

  it('redirects to the root path when enable has no URL', async () => {
    await expect(handlers.enable(request('/api/draft/enable?token=draft-secret'))).rejects.toThrow('REDIRECT:/');
  });

  it('allows disable without a token', async () => {
    await expect(handlers.disable(request('/api/draft/disable?url=/page'))).rejects.toThrow('REDIRECT:/page');

    expect(draftModeState.disable).toHaveBeenCalled();
  });

  it('rejects disable when a wrong token is provided', async () => {
    const response = await handlers.disable(request('/api/draft/disable?token=wrong&url=/page'));

    expect(response.status).toBe(401);
    expect(draftModeState.disable).not.toHaveBeenCalled();
  });

  it('rejects an unsafe disable redirect before changing draft mode', async () => {
    const response = await handlers.disable(request('/api/draft/disable?url=//evil.com'));

    expect(response.status).toBe(422);
    expect(draftModeState.disable).not.toHaveBeenCalled();
  });

  it('returns JSON success when disable has no redirect target', async () => {
    const response = await handlers.disable(request('/api/draft/disable'));
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });
});
