import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryCacheTagStore } from '../../cache-tags/memory.js';
import type { TypedDocumentNode } from '../types.js';
import type { CacheDecision } from './registry.js';

const cacheTag = vi.fn();
const cacheLife = vi.fn();
let draftEnabled = false;

vi.mock('next/cache', () => ({ cacheTag, cacheLife }));
vi.mock('next/headers', () => ({ draftMode: () => Promise.resolve({ isEnabled: draftEnabled }) }));

const { createCachedDatoClient } = await import('./cached-query.js');
const { clearRegisteredClients } = await import('./registry.js');

const document = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      name: { kind: 'Name', value: 'Layout' },
      operation: 'query',
      selectionSet: { kind: 'SelectionSet', selections: [] },
    },
  ],
} as TypedDocumentNode<{ ok: boolean }, Record<string, never>>;

const response = (headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ data: { ok: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const taggedFetch = (tags = 'tag-a tag-b') => vi.fn(() => Promise.resolve(response({ 'x-cache-tags': tags })));

/** `vi.fn()` mock args are `any`; read the recorded decision through a typed view. */
const decisionAt = (mock: ReturnType<typeof vi.fn>, index = 0): CacheDecision =>
  mock.mock.calls[index]?.[0] as CacheDecision;

describe('createCachedDatoClient', () => {
  beforeEach(() => {
    cacheTag.mockClear();
    cacheLife.mockClear();
    clearRegisteredClients();
    draftEnabled = false;
    process.env.DATOCMS_API_TOKEN = 'token';
  });

  afterEach(() => {
    delete process.env.DATOCMS_API_TOKEN;
    delete process.env.DATOCMS_ENVIRONMENT;
  });

  it('returns the query data', async () => {
    const query = createCachedDatoClient({ fetchFn: taggedFetch() });

    await expect(query({ document })).resolves.toEqual({ ok: true });
  });

  describe('cached path', () => {
    it('tags the entry with the deterministic query ID', async () => {
      const onCacheDecision = vi.fn();
      const query = createCachedDatoClient({ fetchFn: taggedFetch(), store: createMemoryCacheTagStore(), onCacheDecision });

      await query({ document });

      const { queryId } = decisionAt(onCacheDecision);
      expect(queryId).toMatch(/^Layout-[0-9a-f]{16}$/);
      expect(cacheTag).toHaveBeenCalledWith(queryId);
    });

    it('persists the parsed cache tags against the query ID', async () => {
      const store = createMemoryCacheTagStore();
      const spy = vi.spyOn(store, 'storeQueryCacheTags');
      const query = createCachedDatoClient({ fetchFn: taggedFetch('tag-a tag-b tag-a'), store });

      await query({ document });

      expect(spy).toHaveBeenCalledWith(expect.stringMatching(/^Layout-/), ['tag-a', 'tag-b']);
    });

    it('uses the long profile when the mapping persisted', async () => {
      const query = createCachedDatoClient({ fetchFn: taggedFetch(), store: createMemoryCacheTagStore() });

      await query({ document });

      expect(cacheLife).toHaveBeenCalledWith('days');
    });

    // Without a mapping the webhook cannot reach the entry, so it must expire on its own.
    it('falls back to the short profile when the store cannot persist', async () => {
      const query = createCachedDatoClient({ fetchFn: taggedFetch(), store: createMemoryCacheTagStore({ failing: true }) });

      await query({ document });

      expect(cacheLife).toHaveBeenCalledWith('minutes');
    });

    it('falls back to the short profile when no store is configured', async () => {
      const query = createCachedDatoClient({ fetchFn: taggedFetch() });

      await query({ document });

      expect(cacheLife).toHaveBeenCalledWith('minutes');
    });

    it('honours a per-query profile override', async () => {
      const query = createCachedDatoClient({ fetchFn: taggedFetch(), store: createMemoryCacheTagStore() });

      await query({ document, cacheProfile: 'weeks' });

      expect(cacheLife).toHaveBeenCalledWith('weeks');
    });

    it('honours per-client profile overrides', async () => {
      const query = createCachedDatoClient({
        fetchFn: taggedFetch(),
        store: createMemoryCacheTagStore(),
        profiles: { cached: 'hours' },
      });

      await query({ document });

      expect(cacheLife).toHaveBeenCalledWith('hours');
    });

    it('requests cache tags from DatoCMS', async () => {
      const fetchFn = taggedFetch();
      await createCachedDatoClient({ fetchFn, store: createMemoryCacheTagStore() })({ document });

      const init = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(new Headers(init?.headers).get('X-Cache-Tags')).toBe('true');
    });
  });

  describe('draft mode enabled', () => {
    beforeEach(() => {
      draftEnabled = true;
    });

    it('uses the draft profile', async () => {
      const query = createCachedDatoClient({ fetchFn: taggedFetch(), store: createMemoryCacheTagStore() });

      await query({ document });

      expect(cacheLife).toHaveBeenCalledWith('seconds');
    });

    it('does not tag the entry, since nothing is written to the cache', async () => {
      const query = createCachedDatoClient({ fetchFn: taggedFetch(), store: createMemoryCacheTagStore() });

      await query({ document });

      expect(cacheTag).not.toHaveBeenCalled();
    });

    it('requests drafts from DatoCMS', async () => {
      const fetchFn = taggedFetch();
      await createCachedDatoClient({ fetchFn, store: createMemoryCacheTagStore() })({ document });

      const init = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(new Headers(init?.headers).get('X-Include-Drafts')).toBe('true');
    });

    it('stores nothing', async () => {
      const store = createMemoryCacheTagStore();
      const spy = vi.spyOn(store, 'storeQueryCacheTags');

      await createCachedDatoClient({ fetchFn: taggedFetch(), store })({ document });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('bypass path', () => {
    it.each([
      ['includeDrafts', { includeDrafts: true }],
      ['skipCache', { skipCache: true }],
    ])('never enters a cached scope for %s', async (_label, extra) => {
      const query = createCachedDatoClient({ fetchFn: taggedFetch(), store: createMemoryCacheTagStore() });

      await expect(query({ document, ...extra })).resolves.toEqual({ ok: true });

      expect(cacheTag).not.toHaveBeenCalled();
      expect(cacheLife).not.toHaveBeenCalled();
    });

    it('requests drafts when includeDrafts is set', async () => {
      const fetchFn = taggedFetch();
      await createCachedDatoClient({ fetchFn })({ document, includeDrafts: true });

      const init = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(new Headers(init?.headers).get('X-Include-Drafts')).toBe('true');
    });

    it('reports the bypass through onCacheDecision', async () => {
      const onCacheDecision = vi.fn();
      await createCachedDatoClient({ fetchFn: taggedFetch(), onCacheDecision })({ document, skipCache: true });

      expect(onCacheDecision).toHaveBeenCalledWith(expect.objectContaining({ mode: 'bypass', stored: false }));
    });
  });

  describe('registry', () => {
    it('keeps two clients separate', async () => {
      const first = vi.fn();
      const second = vi.fn();
      const queryA = createCachedDatoClient({ id: 'a', fetchFn: taggedFetch(), onCacheDecision: first });
      const queryB = createCachedDatoClient({ id: 'b', fetchFn: taggedFetch(), onCacheDecision: second });

      await queryA({ document });
      await queryB({ document });

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('separates query IDs across DatoCMS environments', async () => {
      const decisions: string[] = [];
      const record = (decision: { queryId: string }) => decisions.push(decision.queryId);

      process.env.DATOCMS_ENVIRONMENT = 'main';
      await createCachedDatoClient({ id: 'main', fetchFn: taggedFetch(), onCacheDecision: record })({ document });

      process.env.DATOCMS_ENVIRONMENT = 'sandbox';
      await createCachedDatoClient({ id: 'sandbox', fetchFn: taggedFetch(), onCacheDecision: record })({ document });

      expect(decisions[0]).not.toBe(decisions[1]);
    });

    it('namespaces query IDs with a tag prefix', async () => {
      const onCacheDecision = vi.fn();
      await createCachedDatoClient({ fetchFn: taggedFetch(), tagPrefix: 'flf', onCacheDecision })({ document });

      expect(decisionAt(onCacheDecision).queryId).toMatch(/^flf:Layout-/);
    });

    it('explains itself when no client is registered', async () => {
      const query = createCachedDatoClient({ id: 'gone', fetchFn: taggedFetch() });
      clearRegisteredClients();

      await expect(query({ document })).rejects.toThrow('No cached DatoCMS client registered as "gone"');
    });
  });
});
