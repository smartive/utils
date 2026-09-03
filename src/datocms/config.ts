import type { DatoClientConfig } from './types.js';

/**
 * Resolvers shared by the fetch-cached client (`./datocms`) and the Cache Components
 * client (`./datocms/next`), so both derive the token, environment, and Content Link
 * settings identically.
 *
 * Environment variables are read lazily on every call, never captured at import, so
 * build-time and runtime configuration can differ.
 */

export const resolveApiToken = (config: DatoClientConfig): string => {
  const token = config.apiToken ?? process.env.DATOCMS_API_TOKEN;

  if (!token) {
    throw new Error('[datocms] Missing DATOCMS_API_TOKEN');
  }

  return token;
};

export const resolveBaseEditingUrl = (config: DatoClientConfig): string | undefined => {
  const value = (config.baseEditingUrl ?? process.env.NEXT_DATOCMS_BASE_EDITING_URL)?.trim();

  if (value === undefined || value === '') {
    return undefined;
  }

  return value;
};

/**
 * The resolved environment is also hashed into the query ID by `./cache-tags`, so both
 * clients must agree on it. Only the value enters the hash, never the variable name.
 */
export const resolveEnvironment = (config: DatoClientConfig): string | undefined =>
  config.environment ?? process.env.DATOCMS_ENVIRONMENT;
