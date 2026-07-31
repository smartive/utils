import { createHash, timingSafeEqual } from 'node:crypto';

const hash = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Compares a token to a secret in constant time.
 *
 * Both values are hashed before comparison so a length mismatch cannot leak
 * the secret's length via an early return.
 */
export const isValidToken = (token: string | null | undefined, secret: string | undefined): boolean => {
  if (!token || !secret) {
    return false;
  }

  return timingSafeEqual(hash(token), hash(secret));
};
