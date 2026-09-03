import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryCacheTagStore } from '../cache-tags/memory.js';
import type { CacheTagStore } from '../cache-tags/types.js';

const revalidateTag = vi.fn();
const revalidatePath = vi.fn();
const after = vi.fn((task: () => unknown) => {
  void task();
});

vi.mock('next/cache', () => ({ revalidateTag, revalidatePath }));

// `after` lives in next/server alongside NextRequest/NextResponse, which these tests use
// for real, so spread the original module rather than stubbing the whole thing.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after,
}));

const { createCacheTagInvalidateAllHandler, createCacheTagInvalidationHandler } = await import('./cache-tags.js');
const { NextRequest } = await import('next/server');

const SECRET = 'secret-token';

const webhookRequest = (body: unknown, token: string | null = SECRET) =>
  new NextRequest('https://example.test/api/invalidate-cache-tags', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: token === null ? {} : { 'Webhook-Token': token },
  });

const getRequest = (token: string | null = SECRET) =>
  new NextRequest(`https://example.test/api/invalidate-cache-tags${token === null ? '' : `?token=${token}`}`);

const payload = (tags: string[]) => ({
  entity_type: 'cda_cache_tags',
  event_type: 'invalidate',
  entity: { attributes: { tags } },
});

const seededStore = async (): Promise<CacheTagStore> => {
  const store = createMemoryCacheTagStore();
  await store.storeQueryCacheTags('Layout-aaa', ['tag-a', 'shared']);
  await store.storeQueryCacheTags('Page-bbb', ['shared']);
  await store.storeQueryCacheTags('Other-ccc', ['tag-z']);

  return store;
};

describe('createCacheTagInvalidationHandler', () => {
  beforeEach(() => {
    revalidateTag.mockClear();
    revalidatePath.mockClear();
    after.mockClear();
    process.env.CACHE_INVALIDATION_SECRET_TOKEN = SECRET;
  });

  afterEach(() => {
    delete process.env.CACHE_INVALIDATION_SECRET_TOKEN;
  });

  describe('POST auth', () => {
    it('rejects a missing token with 401', async () => {
      const { POST } = createCacheTagInvalidationHandler({ store: createMemoryCacheTagStore() });

      expect((await POST(webhookRequest(payload(['tag-a']), null))).status).toBe(401);
    });

    it('rejects a wrong token with 401', async () => {
      const { POST } = createCacheTagInvalidationHandler({ store: createMemoryCacheTagStore() });

      expect((await POST(webhookRequest(payload(['tag-a']), 'nope'))).status).toBe(401);
    });

    it('does not revalidate anything when unauthorized', async () => {
      const { POST } = createCacheTagInvalidationHandler({ store: createMemoryCacheTagStore() });
      await POST(webhookRequest(payload(['tag-a']), 'nope'));

      expect(revalidateTag).not.toHaveBeenCalled();
    });
  });

  // A 200 no-op would let DatoCMS record a successful delivery for an invalidation that
  // never happened; 503 makes it retry.
  it('answers 503 when the store is unconfigured', async () => {
    const { POST } = createCacheTagInvalidationHandler({ store: createMemoryCacheTagStore({ configured: false }) });

    expect((await POST(webhookRequest(payload(['tag-a'])))).status).toBe(503);
  });

  // Distinguishes "lookup failed" from "nothing matched", which must be a 200.
  it('answers 503 when the lookup fails', async () => {
    const { POST } = createCacheTagInvalidationHandler({ store: createMemoryCacheTagStore({ failing: true }) });

    expect((await POST(webhookRequest(payload(['tag-a'])))).status).toBe(503);
  });

  describe('POST payload validation', () => {
    it('answers 400 for a non-JSON body', async () => {
      const { POST } = createCacheTagInvalidationHandler({ store: createMemoryCacheTagStore() });

      expect((await POST(webhookRequest('not json'))).status).toBe(400);
    });

    it('answers 400 for a foreign payload', async () => {
      const { POST } = createCacheTagInvalidationHandler({ store: createMemoryCacheTagStore() });

      expect((await POST(webhookRequest({ entity_type: 'item', entity: {} }))).status).toBe(400);
    });

    it('answers 400 for an empty tag list', async () => {
      const { POST } = createCacheTagInvalidationHandler({ store: createMemoryCacheTagStore() });

      expect((await POST(webhookRequest(payload([])))).status).toBe(400);
    });
  });

  describe('POST invalidation', () => {
    it('revalidates only the affected query IDs', async () => {
      const { POST } = createCacheTagInvalidationHandler({ store: await seededStore() });

      const response = await POST(webhookRequest(payload(['shared'])));
      const body = (await response.json()) as { revalidatedQueryIds: string[] };

      expect(response.status).toBe(200);
      expect(body.revalidatedQueryIds.sort()).toEqual(['Layout-aaa', 'Page-bbb']);
      expect(revalidateTag).toHaveBeenCalledTimes(2);
    });

    // The second argument is required in Next 16; the single-argument form is deprecated.
    it('passes an expiry profile to revalidateTag', async () => {
      const { POST } = createCacheTagInvalidationHandler({ store: await seededStore() });
      await POST(webhookRequest(payload(['tag-z'])));

      expect(revalidateTag).toHaveBeenCalledWith('Other-ccc', { expire: 0 });
    });

    it('leaves unrelated queries alone', async () => {
      const { POST } = createCacheTagInvalidationHandler({ store: await seededStore() });
      await POST(webhookRequest(payload(['tag-z'])));

      expect(revalidateTag).toHaveBeenCalledTimes(1);
    });

    it('answers 200 with no query IDs when nothing matches', async () => {
      const { POST } = createCacheTagInvalidationHandler({ store: await seededStore() });

      const response = await POST(webhookRequest(payload(['absent'])));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ revalidatedQueryIds: [], deletedMappings: 0 });
    });

    it('deletes the mappings it acted on', async () => {
      const store = await seededStore();
      const { POST } = createCacheTagInvalidationHandler({ store });
      await POST(webhookRequest(payload(['shared'])));

      await expect(store.queriesReferencingCacheTags(['shared'])).resolves.toEqual([]);
    });

    // Deleting first would lose the mapping if revalidation threw.
    it('revalidates before deleting', async () => {
      const store = await seededStore();
      const order: string[] = [];
      revalidateTag.mockImplementation(() => order.push('revalidate'));
      vi.spyOn(store, 'deleteCacheTags').mockImplementation(() => {
        order.push('delete');

        return Promise.resolve(1);
      });

      const { POST } = createCacheTagInvalidationHandler({ store });
      await POST(webhookRequest(payload(['tag-z'])));

      expect(order).toEqual(['revalidate', 'delete']);
    });

    it('schedules the orphan sweep after responding', async () => {
      const store = await seededStore();
      const spy = vi.spyOn(store, 'deleteOrphanedCacheTags');
      const { POST } = createCacheTagInvalidationHandler({ store, orphanRetentionSeconds: 3600 });

      await POST(webhookRequest(payload(['tag-z'])));

      expect(after).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(3600);
    });

    // The store owns the retention default, so the handler must not restate it.
    it('leaves the orphan window to the store by default', async () => {
      const store = await seededStore();
      const spy = vi.spyOn(store, 'deleteOrphanedCacheTags');
      const { POST } = createCacheTagInvalidationHandler({ store });

      await POST(webhookRequest(payload(['tag-z'])));

      expect(spy).toHaveBeenCalledWith(undefined);
    });

    it('skips the orphan sweep when disabled', async () => {
      const { POST } = createCacheTagInvalidationHandler({ store: await seededStore(), orphanRetentionSeconds: false });

      await POST(webhookRequest(payload(['tag-z'])));

      expect(after).not.toHaveBeenCalled();
    });

    it('reports the result through onInvalidate', async () => {
      const onInvalidate = vi.fn();
      const { POST } = createCacheTagInvalidationHandler({ store: await seededStore(), onInvalidate });

      await POST(webhookRequest(payload(['tag-z'])));

      expect(onInvalidate).toHaveBeenCalledWith(
        expect.objectContaining({ receivedCacheTags: 1, revalidatedQueryIds: ['Other-ccc'] }),
      );
    });

    it('prefers an explicit secret over the environment', async () => {
      delete process.env.CACHE_INVALIDATION_SECRET_TOKEN;
      const { POST } = createCacheTagInvalidationHandler({ store: await seededStore(), secret: 'explicit' });

      expect((await POST(webhookRequest(payload(['tag-z']), 'explicit'))).status).toBe(200);
    });
  });

  describe('GET diagnostics', () => {
    it('rejects a missing token with 401', async () => {
      const { GET } = createCacheTagInvalidationHandler({ store: createMemoryCacheTagStore() });

      expect((await GET(getRequest(null))).status).toBe(401);
    });

    it('reports configuration and stats', async () => {
      const { GET } = createCacheTagInvalidationHandler({ store: await seededStore() });

      const body: unknown = await (await GET(getRequest())).json();

      expect(body).toMatchObject({ configured: true, store: 'MemoryCacheTagStore', stats: { queries: 3 } });
    });

    it('merges extra diagnostics', async () => {
      const { GET } = createCacheTagInvalidationHandler({
        store: createMemoryCacheTagStore(),
        diagnostics: () => ({ datoEnvironment: 'main' }),
      });

      expect(await (await GET(getRequest())).json()).toMatchObject({ datoEnvironment: 'main' });
    });
  });

  it('answers CORS preflight', () => {
    const { OPTIONS } = createCacheTagInvalidationHandler({ store: createMemoryCacheTagStore() });
    const response = OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('createCacheTagInvalidateAllHandler', () => {
  beforeEach(() => {
    revalidateTag.mockClear();
    revalidatePath.mockClear();
    process.env.CACHE_INVALIDATION_SECRET_TOKEN = SECRET;
  });

  afterEach(() => {
    delete process.env.CACHE_INVALIDATION_SECRET_TOKEN;
  });

  it.each([
    ['GET', (h: ReturnType<typeof createCacheTagInvalidateAllHandler>) => h.GET(getRequest(null))],
    ['POST', (h: ReturnType<typeof createCacheTagInvalidateAllHandler>) => h.POST(webhookRequest({}, null))],
  ])('rejects an unauthorized %s with 401', async (_method, call) => {
    expect((await call(createCacheTagInvalidateAllHandler())).status).toBe(401);
  });

  it('revalidates the whole layout', async () => {
    await createCacheTagInvalidateAllHandler().GET(getRequest());

    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('revalidates extra paths', async () => {
    await createCacheTagInvalidateAllHandler({ paths: ['/sitemap.xml'] }).GET(getRequest());

    expect(revalidatePath).toHaveBeenCalledWith('/sitemap.xml');
  });

  it('empties the mapping store and reports the row count', async () => {
    const store = await seededStore();

    const body: unknown = await (await createCacheTagInvalidateAllHandler({ store }).GET(getRequest())).json();

    expect(body).toMatchObject({ success: true, deletedMappings: 4 });
    await expect(store.queriesReferencingCacheTags(['shared'])).resolves.toEqual([]);
  });

  it('works without a store', async () => {
    const response = await createCacheTagInvalidateAllHandler().POST(webhookRequest({}));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, store: null, deletedMappings: 0 });
  });
});
