import {
  clearPersistedRun,
  createPersistedRunPayload,
  defaultPersistedRunKey,
  loadPersistedRun,
  loadPersistedRunPayload,
  measurePersistedRunPayload,
  savePersistedRun,
  type PersistedRunClearResult,
  type PersistedRunInput,
  type PersistedRunLoadResult,
  type PersistedRunPayload,
  type PersistedRunSaveResult,
  type PersistenceStorage
} from "../simulation/persistence";

const indexedDbName = "petri-dish";
const indexedDbVersion = 1;
const indexedDbStoreName = "persisted-runs";
const indexedDbRecordId = "default-run";
const manifestSchema = "petri-dish.persisted-run-manifest";
const manifestVersion = 1;
const largePayloadBytes = 3_500_000;
const nearLimitPayloadBytes = 4_500_000;

export const defaultPersistedRunManifestKey = "petri-dish:persisted-run:manifest:v1";

export type BrowserRunStorageBackend = "indexeddb" | "local-storage";
export type StorageHealth = "nominal" | "large" | "near-limit";

export type BrowserPersistedRunLoadResult = PersistedRunLoadResult & {
  backend?: BrowserRunStorageBackend;
  manifestBytes?: number;
  storageHealth?: StorageHealth;
};

export type BrowserPersistedRunSaveResult = PersistedRunSaveResult & {
  backend?: BrowserRunStorageBackend;
  manifestBytes?: number;
  storageHealth?: StorageHealth;
};

export type BrowserPersistedRunClearResult = PersistedRunClearResult & {
  backend?: BrowserRunStorageBackend;
};

export interface BrowserPersistedRunStore {
  readonly preferredBackend: BrowserRunStorageBackend;
  load(): Promise<BrowserPersistedRunLoadResult>;
  save(input: PersistedRunInput): Promise<BrowserPersistedRunSaveResult>;
  clear(): Promise<BrowserPersistedRunClearResult>;
}

export interface BrowserPersistedRunStoreOptions {
  indexedDb?: IDBFactory;
  localStorage?: PersistenceStorage;
  storageKey?: string;
  manifestKey?: string;
}

interface IndexedDbPersistedRunRecord {
  id: string;
  schema: typeof manifestSchema;
  version: typeof manifestVersion;
  savedAt: string;
  bytes: number;
  payload: PersistedRunPayload;
}

export function createDefaultBrowserPersistedRunStore(): BrowserPersistedRunStore | undefined {
  if (typeof window === "undefined") return undefined;

  return createBrowserPersistedRunStore({
    indexedDb: safeIndexedDb(),
    localStorage: safeLocalStorage()
  });
}

export function createBrowserPersistedRunStore({
  indexedDb,
  localStorage,
  storageKey = defaultPersistedRunKey,
  manifestKey = defaultPersistedRunManifestKey
}: BrowserPersistedRunStoreOptions): BrowserPersistedRunStore | undefined {
  if (!indexedDb && !localStorage) return undefined;

  return {
    preferredBackend: indexedDb ? "indexeddb" : "local-storage",

    async load() {
      if (indexedDb) {
        const indexedDbResult = await loadFromIndexedDb(indexedDb, storageKey);
        if (indexedDbResult.status === "loaded") return indexedDbResult;
        if (indexedDbResult.status !== "missing" && indexedDbResult.status !== "unavailable") return indexedDbResult;
      }

      if (localStorage) {
        return withStorageHealth({ ...loadPersistedRun(localStorage, storageKey), backend: "local-storage" as const });
      }

      return { status: "unavailable", key: storageKey, reason: "browser-storage-unavailable", backend: indexedDb ? "indexeddb" : undefined };
    },

    async save(input) {
      if (indexedDb) {
        const indexedDbResult = await saveToIndexedDb(indexedDb, input, storageKey);
        if (indexedDbResult.status === "saved") {
          const manifestBytes = writeManifest(localStorage, manifestKey, indexedDbResult.payload, indexedDbResult.bytes);
          removeLegacyLocalStoragePayload(localStorage, storageKey, manifestKey);
          return withStorageHealth({
            status: "saved" as const,
            key: storageKey,
            savedAt: indexedDbResult.savedAt,
            bytes: indexedDbResult.bytes,
            backend: "indexeddb" as const,
            manifestBytes
          });
        }
      }

      if (localStorage) {
        return withStorageHealth({ ...savePersistedRun(localStorage, input, storageKey), backend: "local-storage" as const });
      }

      return { status: "error", key: storageKey, reason: "browser-storage-unavailable", backend: indexedDb ? "indexeddb" : undefined };
    },

    async clear() {
      const errors: unknown[] = [];
      if (indexedDb) {
        try {
          await deleteFromIndexedDb(indexedDb);
        } catch (error) {
          errors.push(error);
        }
      }

      if (localStorage) {
        try {
          clearPersistedRun(localStorage, storageKey);
          localStorage.removeItem(manifestKey);
        } catch (error) {
          errors.push(error);
        }
      }

      if (errors.length > 0) {
        return { status: "error", key: storageKey, reason: "storage-clear-failed", error: errors, backend: indexedDb ? "indexeddb" : "local-storage" };
      }

      return { status: "cleared", key: storageKey, backend: indexedDb ? "indexeddb" : "local-storage" };
    }
  };
}

async function loadFromIndexedDb(indexedDb: IDBFactory, key: string): Promise<BrowserPersistedRunLoadResult> {
  let database: IDBDatabase | undefined;

  try {
    database = await openDatabase(indexedDb);
    const record = await getRecord(database);
    if (record === undefined) return { status: "missing", key, backend: "indexeddb" };

    const payload = isRecord(record) && "payload" in record ? record.payload : record;
    const result = loadPersistedRunPayload(payload, key);
    return withStorageHealth({ ...result, backend: "indexeddb" as const });
  } catch (error) {
    return { status: "unavailable", key, reason: "indexeddb-read-failed", error, backend: "indexeddb" };
  } finally {
    database?.close();
  }
}

async function saveToIndexedDb(
  indexedDb: IDBFactory,
  input: PersistedRunInput,
  key: string
): Promise<(PersistedRunSaveResult & { payload: PersistedRunPayload }) | { status: "error"; key: string; reason: string; error?: unknown }> {
  let database: IDBDatabase | undefined;

  try {
    const payload = createPersistedRunPayload(input);
    const validation = loadPersistedRunPayload(payload, key);
    if (validation.status !== "loaded") {
      return { status: "error", key, reason: validation.status === "invalid" ? validation.reason : "payload-shape-invalid" };
    }

    const bytes = measurePersistedRunPayload(payload);
    const record: IndexedDbPersistedRunRecord = {
      id: indexedDbRecordId,
      schema: manifestSchema,
      version: manifestVersion,
      savedAt: payload.savedAt,
      bytes,
      payload
    };
    database = await openDatabase(indexedDb);
    await putRecord(database, record);
    return { status: "saved", key, savedAt: payload.savedAt, bytes, payload };
  } catch (error) {
    return { status: "error", key, reason: "indexeddb-write-failed", error };
  } finally {
    database?.close();
  }
}

async function deleteFromIndexedDb(indexedDb: IDBFactory): Promise<void> {
  const database = await openDatabase(indexedDb);
  try {
    await requestToPromise(database.transaction(indexedDbStoreName, "readwrite").objectStore(indexedDbStoreName).delete(indexedDbRecordId));
  } finally {
    database.close();
  }
}

function openDatabase(indexedDb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(indexedDbName, indexedDbVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(indexedDbStoreName)) {
        database.createObjectStore(indexedDbStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb-open-failed"));
    request.onblocked = () => reject(new Error("indexeddb-open-blocked"));
  });
}

function getRecord(database: IDBDatabase): Promise<unknown | undefined> {
  return requestToPromise(database.transaction(indexedDbStoreName, "readonly").objectStore(indexedDbStoreName).get(indexedDbRecordId));
}

function putRecord(database: IDBDatabase, record: IndexedDbPersistedRunRecord): Promise<IDBValidKey> {
  return requestToPromise(database.transaction(indexedDbStoreName, "readwrite").objectStore(indexedDbStoreName).put(record));
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb-request-failed"));
  });
}

function writeManifest(
  localStorage: PersistenceStorage | undefined,
  manifestKey: string,
  payload: PersistedRunPayload,
  bytes: number
): number | undefined {
  if (!localStorage) return undefined;

  try {
    const serialized = JSON.stringify({
      schema: manifestSchema,
      version: manifestVersion,
      backend: "indexeddb",
      database: indexedDbName,
      store: indexedDbStoreName,
      recordId: indexedDbRecordId,
      savedAt: payload.savedAt,
      generation: payload.metadata.generation,
      population: payload.metadata.population,
      species: payload.metadata.species,
      bytes
    });
    localStorage.setItem(manifestKey, serialized);
    return new TextEncoder().encode(serialized).length;
  } catch {
    return undefined;
  }
}

function removeLegacyLocalStoragePayload(localStorage: PersistenceStorage | undefined, storageKey: string, manifestKey: string): void {
  if (!localStorage || storageKey === manifestKey) return;
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // The IndexedDB save is still authoritative; the stale localStorage payload can be cleaned later.
  }
}

function withStorageHealth<Result extends { status: string; bytes?: number }>(result: Result): Result & { storageHealth?: StorageHealth } {
  if (result.status !== "loaded" && result.status !== "saved") return result;
  if (typeof result.bytes !== "number") return result;
  return { ...result, storageHealth: storageHealthForBytes(result.bytes) };
}

function storageHealthForBytes(bytes: number): StorageHealth {
  if (bytes >= nearLimitPayloadBytes) return "near-limit";
  if (bytes >= largePayloadBytes) return "large";
  return "nominal";
}

function safeIndexedDb(): IDBFactory | undefined {
  try {
    return window.indexedDB;
  } catch {
    return undefined;
  }
}

function safeLocalStorage(): PersistenceStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
