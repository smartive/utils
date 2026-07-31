import { describe, expect, it } from 'vitest';

import { withCORS } from './cors.js';

const getHeaders = (responseInit: ResponseInit): Headers => new Headers(responseInit.headers);

describe('withCORS', () => {
  it('injects default CORS headers', () => {
    const result = withCORS({ status: 401 });
    const headers = getHeaders(result);

    expect(result.status).toBe(401);
    expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(headers.get('Access-Control-Allow-Methods')).toBe('OPTIONS, POST, GET');
    expect(headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization, Token, Webhook-Token');
  });

  it('preserves plain object headers and lets CORS override conflicting keys', () => {
    const result = withCORS({
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://evil.example',
      },
    });
    const headers = getHeaders(result);

    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('preserves Headers instances', () => {
    const headers = new Headers({ 'X-Custom': 'yes' });
    const result = withCORS({ headers });
    const resultHeaders = getHeaders(result);

    expect(resultHeaders.get('X-Custom')).toBe('yes');
    expect(resultHeaders.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('preserves tuple-array headers', () => {
    const result = withCORS({
      headers: [
        ['X-Custom', 'a'],
        ['X-Other', 'b'],
      ],
    });
    const headers = getHeaders(result);

    expect(headers.get('X-Custom')).toBe('a');
    expect(headers.get('X-Other')).toBe('b');
    expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('preserves multiple Set-Cookie headers', () => {
    const headers = new Headers();
    headers.append('Set-Cookie', 'first=value');
    headers.append('Set-Cookie', 'second=value');

    const result = withCORS({ headers });

    expect(result.headers).toBeInstanceOf(Headers);
    if (!(result.headers instanceof Headers)) {
      throw new TypeError('Expected Headers');
    }
    expect(result.headers.getSetCookie()).toEqual(['first=value', 'second=value']);
  });

  it('accepts origin, methods, and headers overrides', () => {
    const result = withCORS(undefined, {
      origin: 'https://example.com',
      methods: 'GET',
      headers: 'X-Custom',
    });
    const headers = getHeaders(result);

    expect(headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    expect(headers.get('Access-Control-Allow-Methods')).toBe('GET');
    expect(headers.get('Access-Control-Allow-Headers')).toBe('X-Custom');
  });
});
