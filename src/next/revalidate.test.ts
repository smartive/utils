import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.fn<(...args: unknown[]) => void>();

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => {
    revalidatePath(...args);
  },
}));

const { createRevalidateHandler } = await import('./revalidate.js');

const request = (token: string | null) => {
  const headers = new Headers();
  if (token !== null) {
    headers.set('Webhook-Token', token);
  }

  return new NextRequest('https://example.com/api/revalidate-path', {
    method: 'POST',
    headers,
  });
};

describe('createRevalidateHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 for an invalid token', () => {
    const handler = createRevalidateHandler({ secret: 'cache-secret' });
    const response = handler(request('wrong'));

    expect(response.status).toBe(401);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('revalidates the root layout and extra paths', async () => {
    const handler = createRevalidateHandler({
      secret: 'cache-secret',
      paths: ['/sitemap.xml', '/stations.pdf'],
    });

    const response = handler(request('cache-secret'));
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(revalidatePath).toHaveBeenCalledWith('/sitemap.xml');
    expect(revalidatePath).toHaveBeenCalledWith('/stations.pdf');
  });

  it('returns 500 when revalidation throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    revalidatePath.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const handler = createRevalidateHandler({ secret: 'cache-secret' });
    const response = handler(request('cache-secret'));

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
