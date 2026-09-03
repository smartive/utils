import type { CacheTagStore } from '../../cache-tags/types.js';
import type { DatoClientConfig } from '../types.js';
import type { CacheLifeProfile, CacheMode, CacheProfiles } from './policy.js';

export type CacheDecision = {
  queryId: string;
  mode: CacheMode;
  /** Absent on the `bypass` path, which sets no `cacheLife`. */
  profile?: CacheLifeProfile;
  cacheTagCount: number;
  stored: boolean;
};

export type RegisteredClient = {
  datoConfig: DatoClientConfig;
  store?: CacheTagStore;
  profiles: CacheProfiles;
  tagPrefix?: string;
  onCacheDecision?: (decision: CacheDecision) => void;
};

/**
 * Module-level registry of cached-client configurations, addressed by a string id.
 *
 * This indirection is not incidental — it is required by how `'use cache'` works. Next
 * captures every variable a cached function reads from an **enclosing function scope**
 * and binds it as an argument, and arguments must be RSC-serializable: functions and
 * class instances are not. A cached function closing over an injected `store` (whose
 * methods are functions) or an `onCacheDecision` callback would therefore fail to
 * serialize.
 *
 * Module-level bindings are not captured that way, so the cached function takes only the
 * serializable `clientId` and looks its configuration up here.
 *
 * The id is caller-controlled and defaults to `'default'` precisely because it becomes
 * part of the cache key: it must be **stable across processes and deployments**, so it
 * cannot be randomly generated.
 */
const clients = new Map<string, RegisteredClient>();

export const registerClient = (id: string, client: RegisteredClient): void => {
  clients.set(id, client);
};

export const getRegisteredClient = (id: string): RegisteredClient => {
  const client = clients.get(id);

  if (!client) {
    throw new Error(
      `[datocms/next] No cached DatoCMS client registered as "${id}". Create it with createCachedDatoClient({ id: "${id}" }) in a module that is imported before the query runs.`,
    );
  }

  return client;
};

/** Test seam. */
export const clearRegisteredClients = (): void => {
  clients.clear();
};
