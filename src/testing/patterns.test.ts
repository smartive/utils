import { describe, expect, it } from 'vitest';

import { matchesAnyPattern, matchesPattern } from './patterns.js';

describe('matchesPattern', () => {
  it('matches strings as substrings', () => {
    expect(matchesPattern('/arbeiten/foo', '/arbeiten/')).toBe(true);
    expect(matchesPattern('/kompetenzen/foo', '/arbeiten/')).toBe(false);
  });

  it('tests regular expressions', () => {
    expect(matchesPattern('/de/produkte/x', /^\/de\//)).toBe(true);
    expect(matchesPattern('/fr/produits/x', /^\/de\//)).toBe(false);
  });

  it('gives the same answer every time for global regular expressions', () => {
    const pattern = /foo/g;

    expect([1, 2, 3].map(() => matchesPattern('foo', pattern))).toEqual([true, true, true]);
  });
});

describe('matchesAnyPattern', () => {
  it('matches when any pattern does', () => {
    expect(matchesAnyPattern('/news/a', ['/event/', /^\/news\//])).toBe(true);
    expect(matchesAnyPattern('/about', ['/event/', /^\/news\//])).toBe(false);
    expect(matchesAnyPattern('/about', [])).toBe(false);
  });
});
