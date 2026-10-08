import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FullConfig, Page, TestInfo } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readRoutes,
  smokeFixtures,
  smokeGlobalSetup,
  writeRoutes,
  type SmokeOptions,
  type SmokeState,
} from './playwright.js';

type RouteHandler = (route: ReturnType<typeof createRoute>) => Promise<void>;

const createRoute = (url: string, { navigation = false } = {}) => ({
  request: () => ({ url: () => url, isNavigationRequest: () => navigation, frame: () => mainFrame }),
  fallback: vi.fn(() => Promise.resolve()),
  abort: vi.fn(() => Promise.resolve()),
});

const mainFrame = {};

const createPage = () => {
  const emitter = new EventEmitter();
  let handler: RouteHandler | undefined;

  const page = Object.assign(emitter, {
    url: () => 'http://localhost:3000/page',
    mainFrame: () => mainFrame,
    route: vi.fn((_pattern: string, routeHandler: RouteHandler) => {
      handler = routeHandler;

      return Promise.resolve();
    }),
  });

  return {
    page,
    request: async (url: string, options?: { navigation?: boolean }) => {
      const route = createRoute(url, options);
      await handler?.(route);

      return route;
    },
    console: (type: string, text: string, url = '') =>
      emitter.emit('console', { type: () => type, text: () => text, location: () => ({ url }) }),
  };
};

const createTestInfo = () => ({ annotations: [] as TestInfo['annotations'], attach: vi.fn(() => Promise.resolve()) });

/** Runs the `smoke` fixture with `body` as the test, returning the outcome of its teardown. */
const runSmoke = (
  body: (fake: ReturnType<typeof createPage>, state: SmokeState) => Promise<void> | void,
  {
    options = {},
    overrides = {},
    baseURL = 'http://localhost:3000',
  }: { options?: SmokeOptions; overrides?: SmokeOptions; baseURL?: string | null } = {},
) => {
  const fake = createPage();
  const testInfo = createTestInfo();
  const [fixture] = smokeFixtures(options).smoke as unknown as [
    (args: object, use: (state: SmokeState) => Promise<void>, testInfo: object) => Promise<void>,
  ];
  let state: SmokeState | undefined;

  const result = fixture(
    { page: fake.page as unknown as Page, baseURL: baseURL ?? undefined, smokeOptions: overrides },
    async (smokeState) => {
      state = smokeState;
      await body(fake, smokeState);
    },
    testInfo,
  );

  return { result, testInfo, getState: () => state! };
};

describe('smokeFixtures', () => {
  it('exposes an overridable option fixture that starts empty', () => {
    expect(smokeFixtures({ ignore: ['noise'] }).smokeOptions).toEqual([{}, { option: true }]);
  });

  it('adds overridden ignore rules and allowed hosts to the base options', async () => {
    const { result, getState } = runSmoke(
      async ({ request, console }) => {
        expect((await request('https://www.datocms-assets.com/1/a.jpg')).fallback).toHaveBeenCalled();
        expect((await request('https://stream.mux.com/x/high.mp4')).fallback).toHaveBeenCalled();
        console('error', 'base noise');
        console('error', 'file noise');
        console('error', 'boom');
      },
      {
        options: { allowHosts: ['*.datocms-assets.com'], ignore: ['base noise'] },
        overrides: { allowHosts: ['stream.mux.com'], ignore: ['file noise'] },
      },
    );

    await expect(result).rejects.toThrow('1 issue(s)');
    expect(getState().issues).toEqual([{ type: 'console-error', text: 'boom', location: undefined }]);
    expect([...getState().blockedUrls]).toEqual([]);
  });

  it('lets overrides replace failOn and checkFirstPartyRequests', async () => {
    const { result } = runSmoke(
      ({ page, console }) => {
        console('warning', 'Deprecated thing');
        page.emit('response', { url: () => 'http://localhost:3000/missing.png', status: () => 404 });
      },
      { options: { failOn: ['warning'] }, overrides: { failOn: ['error'], checkFirstPartyRequests: false } },
    );

    await expect(result).resolves.toBeUndefined();
  });

  it('allows first-party, allowlisted and non-http requests and blocks the rest', async () => {
    const { result, testInfo, getState } = runSmoke(
      async ({ request }) => {
        expect((await request('http://localhost:3000/_next/app.js')).fallback).toHaveBeenCalled();
        expect((await request('https://www.datocms-assets.com/1/a.jpg')).fallback).toHaveBeenCalled();
        expect((await request('https://stream.mux.com/x/high.mp4')).fallback).toHaveBeenCalled();
        expect((await request('data:image/png;base64,AAAA')).fallback).toHaveBeenCalled();

        const tracker = await request('https://www.googletagmanager.com/gtm.js?id=GTM-1');
        expect(tracker.abort).toHaveBeenCalledWith('blockedbyclient');
        expect(tracker.fallback).not.toHaveBeenCalled();

        await request('http://localhost:4000/other-port.js');
        await request('https://datocms-assets.com.evil.example/x.js');
      },
      { options: { allowHosts: ['*.datocms-assets.com', /^stream\.mux\.com$/] } },
    );

    await expect(result).resolves.toBeUndefined();
    expect([...getState().blockedUrls]).toHaveLength(3);
    expect(testInfo.annotations).toEqual([
      {
        type: 'blocked hosts',
        description: 'datocms-assets.com.evil.example, localhost:4000, www.googletagmanager.com',
      },
    ]);
  });

  it('passes without issues and attaches nothing', async () => {
    const { result, testInfo } = runSmoke(({ console }) => {
      console('log', 'hello');
      console('info', 'hello');
    });

    await expect(result).resolves.toBeUndefined();
    expect(testInfo.attach).not.toHaveBeenCalled();
  });

  it('fails on console errors and warnings by default', async () => {
    const { result, testInfo } = runSmoke(({ console }) => {
      console('error', 'Hydration failed', 'http://localhost:3000/_next/app.js');
      console('warning', 'Deprecated thing');
    });

    await expect(result).rejects.toThrow(
      /2 issue\(s\) on http:\/\/localhost:3000\/page:\n {2}\[console-error\] Hydration failed \(http:\/\/localhost:3000\/_next\/app\.js\)\n {2}\[console-warning\] Deprecated thing/,
    );
    expect(testInfo.attach).toHaveBeenCalledWith(
      'smoke-issues.json',
      expect.objectContaining({ contentType: 'application/json' }),
    );
  });

  it('only fails on the configured console types', async () => {
    const { result, getState } = runSmoke(
      ({ console }) => {
        console('warning', 'Deprecated thing');
      },
      { options: { failOn: ['error'] } },
    );

    await expect(result).resolves.toBeUndefined();
    expect(getState().issues).toEqual([]);
  });

  it('skips ignored and duplicate messages', async () => {
    const { result, getState } = runSmoke(
      ({ console }) => {
        console('warning', "Please ensure that the container has a non-static position, like 'relative'");
        console('error', 'from a script', 'https://plausible.io/js/script.js');
        console('error', 'boom');
        console('error', 'boom');
      },
      { options: { ignore: ['non-static position', { location: 'plausible.io' }] } },
    );

    await expect(result).rejects.toThrow('1 issue(s)');
    expect(getState().issues).toEqual([{ type: 'console-error', text: 'boom', location: undefined }]);
  });

  it('skips console errors caused by blocked requests', async () => {
    const { result } = runSmoke(async ({ request, console }) => {
      await request('https://connect.facebook.net/en_US/fbevents.js');
      console(
        'error',
        'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT',
        'https://connect.facebook.net/en_US/fbevents.js',
      );
    });

    await expect(result).resolves.toBeUndefined();
  });

  it('reports failed first-party responses once, with their status', async () => {
    const { result, getState } = runSmoke(({ page, console }) => {
      page.emit('response', { url: () => 'http://localhost:3000/missing.png', status: () => 404 });
      page.emit('response', { url: () => 'http://localhost:3000/ok.png', status: () => 200 });
      page.emit('response', { url: () => 'https://www.datocms-assets.com/gone.png', status: () => 404 });
      console(
        'error',
        'Failed to load resource: the server responded with a status of 404 (Not Found)',
        'http://localhost:3000/missing.png',
      );
    });

    await expect(result).rejects.toThrow('1 issue(s)');
    expect(getState().issues).toEqual([
      {
        type: 'response',
        text: 'HTTP 404 http://localhost:3000/missing.png',
        location: 'http://localhost:3000/missing.png',
      },
    ]);
  });

  it('reports failed first-party requests except expected aborts', async () => {
    const failed = (url: string, errorText: string) => ({ url: () => url, failure: () => ({ errorText }) });

    const { result, getState } = runSmoke(({ page }) => {
      page.emit('requestfailed', failed('http://localhost:3000/video.mp4', 'net::ERR_ABORTED'));
      page.emit('requestfailed', failed('https://www.googletagmanager.com/gtm.js', 'net::ERR_BLOCKED_BY_CLIENT'));
      page.emit('requestfailed', failed('https://third.example/x.js', 'net::ERR_NAME_NOT_RESOLVED'));
      page.emit('requestfailed', failed('http://localhost:3000/api/data', 'net::ERR_EMPTY_RESPONSE'));
    });

    await expect(result).rejects.toThrow('1 issue(s)');
    expect(getState().issues).toEqual([
      {
        type: 'requestfailed',
        text: 'net::ERR_EMPTY_RESPONSE http://localhost:3000/api/data',
        location: 'http://localhost:3000/api/data',
      },
    ]);
  });

  it('does not check first-party requests when disabled, including their console errors', async () => {
    const { result } = runSmoke(
      ({ page, console }) => {
        page.emit('response', { url: () => 'http://localhost:3000/missing.png', status: () => 404 });
        console(
          'error',
          'Failed to load resource: the server responded with a status of 404 (Not Found)',
          'http://localhost:3000/missing.png',
        );
      },
      { options: { checkFirstPartyRequests: false } },
    );

    await expect(result).resolves.toBeUndefined();
  });

  it('reports uncaught exceptions with the script location', async () => {
    const error = new Error('Minified React error #418');
    error.stack = 'Error: Minified React error #418\n    at x (http://localhost:3000/_next/static/chunks/app.js:1:2345)';

    const { result, getState } = runSmoke(({ page }) => {
      page.emit('pageerror', error);
    });

    await expect(result).rejects.toThrow('[pageerror] Minified React error #418');
    expect(getState().issues[0].location).toBe('http://localhost:3000/_next/static/chunks/app.js');
  });

  it('passes when the test consumed the issues it expected', async () => {
    const { result } = runSmoke(({ console }, state) => {
      console('error', 'expected');
      expect(state.issues).toHaveLength(1);
      state.issues.length = 0;
    });

    await expect(result).resolves.toBeUndefined();
  });

  it('takes the first party from the first navigation without a baseURL', async () => {
    const { result, getState } = runSmoke(
      async ({ request }) => {
        expect((await request('https://example.com/', { navigation: true })).fallback).toHaveBeenCalled();
        expect((await request('https://example.com/app.js')).fallback).toHaveBeenCalled();
        expect((await request('https://other.example/app.js')).abort).toHaveBeenCalled();
      },
      { baseURL: null },
    );

    await expect(result).resolves.toBeUndefined();
    expect([...getState().blockedUrls]).toEqual(['https://other.example/app.js']);
  });
});

describe('writeRoutes / readRoutes', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'smoke-routes-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips routes, creating missing directories', () => {
    const file = join(dir, 'nested', 'routes.json');
    writeRoutes(['/', '/a'], file);

    expect(readRoutes(file)).toEqual(['/', '/a']);
  });

  it('returns no routes when the file is missing', () => {
    expect(readRoutes(join(dir, 'missing.json'))).toEqual([]);
  });

  it('ignores anything that is not a list of strings', () => {
    const file = join(dir, 'routes.json');
    writeFileSync(file, JSON.stringify(['/', 1, null]));

    expect(readRoutes(file)).toEqual(['/']);
  });
});

describe('smokeGlobalSetup', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'smoke-setup-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const config = (baseURL?: string) => ({ projects: [{ use: {} }, { use: { baseURL } }] }) as unknown as FullConfig;
  const sitemap = () =>
    new Response(
      '<urlset><url><loc>https://prod.example.com/</loc></url><url><loc>https://prod.example.com/a</loc></url></urlset>',
    );

  it('writes the sitemap routes of the configured baseURL', async () => {
    const file = join(dir, 'routes.json');
    const fetchFn = vi.fn(() => Promise.resolve(sitemap()));

    await smokeGlobalSetup({ file, fetchFn })(config('http://localhost:3333'));

    expect(fetchFn).toHaveBeenCalledWith('http://localhost:3333/sitemap.xml');
    expect(readRoutes(file)).toEqual(['/', '/a']);
  });

  it('prefers an explicit baseURL', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(sitemap()));

    await smokeGlobalSetup({ baseURL: 'https://prod.example.com', file: join(dir, 'r.json'), fetchFn })(config());

    expect(fetchFn).toHaveBeenCalledWith('https://prod.example.com/sitemap.xml');
  });

  it('throws without a baseURL', async () => {
    await expect(smokeGlobalSetup({ file: join(dir, 'r.json') })(config())).rejects.toThrow('needs a baseURL');
  });
});
