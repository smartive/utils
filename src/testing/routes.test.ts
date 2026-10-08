import { describe, expect, it } from 'vitest';

import { excludeRoutes, limitRoutes, toPath } from './routes.js';

describe('toPath', () => {
  it('strips the origin and keeps the query', () => {
    expect(toPath('https://robnicolas.ch/arbeiten/foo?x=1#top')).toBe('/arbeiten/foo?x=1');
  });

  it('keeps the root and trailing slashes', () => {
    expect(toPath('https://robnicolas.ch')).toBe('/');
    expect(toPath('https://robnicolas.ch/news/')).toBe('/news/');
  });

  it('accepts paths and host-less values', () => {
    expect(toPath('/kontakt')).toBe('/kontakt');
    expect(toPath('kontakt')).toBe('/kontakt');
  });
});

describe('limitRoutes', () => {
  const routes = ['/', '/arbeiten/a', '/kontakt', '/arbeiten/b', '/arbeiten/c', '/arbeiten/d', '/news/a', '/news/b'];

  it('keeps the first matches of each limit in their original order', () => {
    expect(limitRoutes(routes, [{ pattern: '/arbeiten/', max: 2 }])).toEqual([
      '/',
      '/arbeiten/a',
      '/kontakt',
      '/arbeiten/b',
      '/news/a',
      '/news/b',
    ]);
  });

  it('applies several limits independently', () => {
    expect(
      limitRoutes(routes, [
        { pattern: '/arbeiten/', max: 1 },
        { pattern: /^\/news\//, max: 1 },
      ]),
    ).toEqual(['/', '/arbeiten/a', '/kontakt', '/news/a']);
  });

  it('counts a route only against the first matching limit', () => {
    expect(
      limitRoutes(
        ['/a/x', '/a/y', '/b/z'],
        [
          { pattern: '/a/', max: 1 },
          { pattern: '/', max: 1 },
        ],
      ),
    ).toEqual(['/a/x', '/b/z']);
  });

  it('drops every match with max 0', () => {
    expect(limitRoutes(routes, [{ pattern: '/arbeiten/', max: 0 }])).not.toContain('/arbeiten/a');
  });

  it('returns all routes without limits', () => {
    expect(limitRoutes(routes, [])).toEqual(routes);
  });
});

describe('excludeRoutes', () => {
  it('drops matching routes', () => {
    expect(excludeRoutes(['/', '/ueber-uns/livebilder', '/fr/x', '/fr'], ['/livebilder', /^\/fr\/.+/])).toEqual([
      '/',
      '/fr',
    ]);
  });
});
