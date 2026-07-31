export type WithCORSOptions = {
  origin?: string;
  methods?: string;
  headers?: string;
};

const DEFAULT_ORIGIN = '*';
const DEFAULT_METHODS = 'OPTIONS, POST, GET';
const DEFAULT_HEADERS = 'Content-Type, Authorization, Token, Webhook-Token';

/**
 * Merges CORS headers into a `ResponseInit`, preserving any existing headers
 * whether they were provided as a plain object, a `Headers` instance, or a
 * tuple array.
 */
export const withCORS = (responseInit?: ResponseInit, options: WithCORSOptions = {}): ResponseInit => {
  const { origin = DEFAULT_ORIGIN, methods = DEFAULT_METHODS, headers: allowHeaders = DEFAULT_HEADERS } = options;

  const headers = new Headers(responseInit?.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', methods);
  headers.set('Access-Control-Allow-Headers', allowHeaders);

  return {
    ...responseInit,
    headers,
  };
};
