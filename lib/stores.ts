import { localGet, localSet } from './ext.ts';

const CONFIG_KEY = 'chrome-friend.fx-config';
const SESSION_KEY = 'chrome-friend.fx-sessions';
const OAUTH_KEY = 'chrome-friend.fx-oauth';
const HISTORY_KEY = 'chrome-friend.fx-history';

interface SessionRecord {
  bytes: string;
  revision: string;
  updatedAtMs: number;
}

interface SessionStoreShape {
  nextRevision: number;
  records: Record<string, SessionRecord>;
}

interface OAuthStoreShape {
  nextRevision: number;
  record: { bytes: string; revision: string } | null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function revisionConflict(code: string): Error {
  const error = new Error(code);
  (error as Error & { code: string }).code = code;
  return error;
}

async function readJson<T>(key: string, fallback: T, guard?: (value: unknown) => value is T): Promise<T> {
  try {
    const stored = await localGet(key);
    const value = stored[key];
    if (guard) return guard(value) ? value : fallback;
    return (value as T | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}

function isSessionStore(value: unknown): value is SessionStoreShape {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as SessionStoreShape).nextRevision === 'number'
    && (value as SessionStoreShape).records
    && typeof (value as SessionStoreShape).records === 'object',
  );
}

function isOAuthStore(value: unknown): value is OAuthStoreShape {
  if (!value || typeof value !== 'object') return false;
  const store = value as OAuthStoreShape;
  if (typeof store.nextRevision !== 'number') return false;
  if (store.record === null) return true;
  return Boolean(
    store.record
    && typeof store.record.bytes === 'string'
    && typeof store.record.revision === 'string',
  );
}

function isStringMap(value: unknown): value is Record<string, string> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isHistoryMap(value: unknown): value is Record<string, string[]> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function createConfigStore() {
  return {
    async get(id: string): Promise<string | null> {
      const values = await readJson<Record<string, string>>(CONFIG_KEY, {}, isStringMap);
      return typeof values[id] === 'string' ? values[id] : null;
    },
    async set(id: string, value: string): Promise<void> {
      const values = await readJson<Record<string, string>>(CONFIG_KEY, {}, isStringMap);
      values[id] = value;
      await localSet({ [CONFIG_KEY]: values });
    },
  };
}

export function createSessionStore() {
  const empty: SessionStoreShape = { nextRevision: 1, records: {} };
  return {
    async load(id: string) {
      const store = await readJson<SessionStoreShape>(SESSION_KEY, empty, isSessionStore);
      const record = store.records[id];
      if (!record || typeof record.bytes !== 'string') return null;
      try {
        return { bytes: base64ToBytes(record.bytes), revision: record.revision };
      } catch {
        return null;
      }
    },
    async commit(id: string, bytes: Uint8Array, expectedRevision: string | undefined) {
      const store = await readJson<SessionStoreShape>(SESSION_KEY, empty, isSessionStore);
      const current = store.records[id];
      if ((current?.revision) !== expectedRevision) {
        throw revisionConflict('FX_SESSION_REVISION_CONFLICT');
      }
      const revision = String(store.nextRevision);
      store.nextRevision += 1;
      store.records[id] = {
        bytes: bytesToBase64(bytes),
        revision,
        updatedAtMs: Date.now(),
      };
      await localSet({ [SESSION_KEY]: store });
      return { revision };
    },
    async list() {
      const store = await readJson<SessionStoreShape>(SESSION_KEY, empty, isSessionStore);
      return Object.entries(store.records)
        .map(([id, record]) => ({ id, updatedAtMs: record.updatedAtMs }))
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    },
    async remove(id: string) {
      const store = await readJson<SessionStoreShape>(SESSION_KEY, empty, isSessionStore);
      delete store.records[id];
      await localSet({ [SESSION_KEY]: store });
    },
  };
}

export function createOAuthSessionStore() {
  const empty: OAuthStoreShape = { nextRevision: 1, record: null };
  return {
    async load() {
      const store = await readJson<OAuthStoreShape>(OAUTH_KEY, empty, isOAuthStore);
      if (!store.record) return null;
      try {
        return { bytes: base64ToBytes(store.record.bytes), revision: store.record.revision };
      } catch {
        return null;
      }
    },
    async commit(bytes: Uint8Array, expectedRevision: string | undefined) {
      const store = await readJson<OAuthStoreShape>(OAUTH_KEY, empty, isOAuthStore);
      if ((store.record?.revision) !== expectedRevision) {
        throw revisionConflict('FX_OAUTH_SESSION_REVISION_CONFLICT');
      }
      const revision = String(store.nextRevision);
      store.nextRevision += 1;
      store.record = { bytes: bytesToBase64(bytes), revision };
      await localSet({ [OAUTH_KEY]: store });
      return { revision };
    },
    async remove(expectedRevision: string | undefined) {
      const store = await readJson<OAuthStoreShape>(OAUTH_KEY, empty, isOAuthStore);
      if (!store.record) return 'missing' as const;
      if (store.record.revision !== expectedRevision) {
        throw revisionConflict('FX_OAUTH_SESSION_REVISION_CONFLICT');
      }
      store.record = null;
      await localSet({ [OAUTH_KEY]: store });
    },
  };
}

export function createPromptHistoryStore() {
  return {
    async load(workspaceRoot: string, limit: number): Promise<string[]> {
      const values = await readJson<Record<string, string[]>>(HISTORY_KEY, {}, isHistoryMap);
      const entries = values[workspaceRoot];
      return Array.isArray(entries) ? entries.filter((item) => typeof item === 'string').slice(-limit) : [];
    },
    async append(workspaceRoot: string, value: string, _timestampMs: number) {
      const values = await readJson<Record<string, string[]>>(HISTORY_KEY, {}, isHistoryMap);
      const entries = Array.isArray(values[workspaceRoot])
        ? values[workspaceRoot].filter((item) => typeof item === 'string')
        : [];
      if (entries.at(-1) === value) return 'duplicate' as const;
      if (new TextEncoder().encode(value).length > 16 * 1024) return 'record_too_large' as const;
      values[workspaceRoot] = [...entries, value].slice(-100);
      await localSet({ [HISTORY_KEY]: values });
    },
    async clear(workspaceRoot: string) {
      const values = await readJson<Record<string, string[]>>(HISTORY_KEY, {}, isHistoryMap);
      delete values[workspaceRoot];
      await localSet({ [HISTORY_KEY]: values });
    },
  };
}
