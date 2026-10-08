import { matchesAnyPattern, matchesPattern, type Pattern } from './patterns.js';

/** Caps how many routes matching `pattern` are kept, e.g. three of hundreds of case studies. */
export type RouteLimit = {
  pattern: Pattern;
  max: number;
};

/**
 * Reduces an absolute or relative URL to its path and query, so routes taken from a
 * sitemap (which lists the production host) can be visited against any base URL.
 */
export const toPath = (url: string): string => {
  const { pathname, search } = new URL(url, 'http://localhost');

  return `${pathname}${search}`;
};

/**
 * Keeps the first `max` routes matching each limit, in their original order. A route that
 * matches several limits counts only against the first one, so overlapping patterns never
 * drop a route twice.
 */
export const limitRoutes = (routes: readonly string[], limits: readonly RouteLimit[]): string[] => {
  const counts = limits.map(() => 0);

  return routes.filter((route) => {
    const index = limits.findIndex(({ pattern }) => matchesPattern(route, pattern));

    if (index === -1) {
      return true;
    }

    counts[index] += 1;

    return counts[index] <= limits[index].max;
  });
};

/** Drops routes matching any of `exclude`. */
export const excludeRoutes = (routes: readonly string[], exclude: readonly Pattern[]): string[] =>
  routes.filter((route) => !matchesAnyPattern(route, exclude));
