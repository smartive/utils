import { describe, expect, it } from 'vitest';

import { isSafeRelativePath } from './urls.js';

describe('isSafeRelativePath', () => {
  it.each(['/produkt/foo', '/news/bar?preview=1', '/path#section', '/a/b/c?x=1&y=2#hash', '/'])('accepts %s', (url) => {
    expect(isSafeRelativePath(url)).toBe(true);
  });

  it.each([
    null,
    undefined,
    '',
    'https://evil.example',
    'http://evil.example/path',
    '//evil.com',
    '//evil.example/path',
    '/\\evil.com',
    '/\\evil.example',
    '\\evil.example',
    'produkt/foo',
    '/path\n/evil',
    '/path\u0000',
    '/path\t//evil.com',
    '/%2F%2Fevil.com',
    '/%2F%2Fevil.example',
    '/%5Cevil.com',
    '/%00//evil.example',
    '/%09//evil.example',
    'javascript:alert(1)',
  ])('rejects %s', (url) => {
    expect(isSafeRelativePath(url)).toBe(false);
  });
});
