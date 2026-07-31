import { describe, expect, it } from 'vitest';

import { isValidToken } from './tokens.js';

describe('isValidToken', () => {
  it('accepts an exact match', () => {
    expect(isValidToken('secret-token', 'secret-token')).toBe(true);
  });

  it('rejects mismatches', () => {
    expect(isValidToken('wrong', 'secret-token')).toBe(false);
  });

  it('rejects differing lengths without leaking via early return semantics', () => {
    expect(isValidToken('short', 'much-longer-secret')).toBe(false);
    expect(isValidToken('much-longer-token', 'short')).toBe(false);
  });

  it('rejects null, undefined, or missing secret', () => {
    expect(isValidToken(null, 'secret-token')).toBe(false);
    expect(isValidToken(undefined, 'secret-token')).toBe(false);
    expect(isValidToken('secret-token', undefined)).toBe(false);
    expect(isValidToken(null, undefined)).toBe(false);
    expect(isValidToken('', 'secret-token')).toBe(false);
  });
});
