/**
 * Armazenamento do modo offline: um banco IndexedDB no aparelho com duas "gavetas":
 *  - `cache`: últimas respostas de leitura (GET) da API, para as telas abrirem sem internet;
 *  - `outbox`: alterações feitas sem internet, esperando para subir para a nuvem.
 * Sobrevive a fechar a aba, recarregar e reiniciar o aparelho. Sem IndexedDB (navegação
 * privada antiga, testes), cai para a memória: funciona enquanto a página estiver aberta.
 */

export type StoreName = 'cache' | 'outbox';

export interface KvStore {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put<T>(store: StoreName, key: string, value: T): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  /** Todos os valores, na ordem das chaves. */
  all<T>(store: StoreName): Promise<T[]>;
  keys(store: StoreName): Promise<string[]>;
  clear(store: StoreName): Promise<void>;
}

const DB_NAME = 'comandou-offline';
const DB_VERSION = 1;

export function memoryStore(): KvStore {
  const data: Record<StoreName, Map<string, unknown>> = { cache: new Map(), outbox: new Map() };
  const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
  return {
    async get<T>(s: StoreName, k: string) {
      return clone(data[s].get(k) as T | undefined);
    },
    async put<T>(s: StoreName, k: string, v: T) {
      data[s].set(k, clone(v));
    },
    async delete(s: StoreName, k: string) {
      data[s].delete(k);
    },
    async all<T>(s: StoreName) {
      return [...data[s].entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, v]) => clone(v as T));
    },
    async keys(s: StoreName) {
      return [...data[s].keys()].sort();
    },
    async clear(s: StoreName) {
      data[s].clear();
    },
  };
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function idbStore(): KvStore {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => {
        opening = null;
        reject(r.error);
      };
    }));
  const tx = async (s: StoreName, mode: IDBTransactionMode) =>
    (await open()).transaction(s, mode).objectStore(s);
  return {
    async get<T>(s: StoreName, k: string) {
      return (await req((await tx(s, 'readonly')).get(k))) as T | undefined;
    },
    async put<T>(s: StoreName, k: string, v: T) {
      await req((await tx(s, 'readwrite')).put(v, k));
    },
    async delete(s: StoreName, k: string) {
      await req((await tx(s, 'readwrite')).delete(k));
    },
    async all<T>(s: StoreName) {
      return (await req((await tx(s, 'readonly')).getAll())) as T[];
    },
    async keys(s: StoreName) {
      return (await req((await tx(s, 'readonly')).getAllKeys())).map(String);
    },
    async clear(s: StoreName) {
      await req((await tx(s, 'readwrite')).clear());
    },
  };
}

/** Falha do IndexedDB (cota cheia, bloqueado) não pode derrubar a tela: cai para a memória. */
function resilient(primary: KvStore): KvStore {
  const fallback = memoryStore();
  let broken = false;
  const run = async <R>(fn: (s: KvStore) => Promise<R>): Promise<R> => {
    if (!broken) {
      try {
        return await fn(primary);
      } catch {
        broken = true;
      }
    }
    return fn(fallback);
  };
  return {
    get: (s, k) => run((x) => x.get(s, k)),
    put: (s, k, v) => run((x) => x.put(s, k, v)),
    delete: (s, k) => run((x) => x.delete(s, k)),
    all: (s) => run((x) => x.all(s)),
    keys: (s) => run((x) => x.keys(s)),
    clear: (s) => run((x) => x.clear(s)),
  };
}

let current: KvStore | null = null;

export function offlineStore(): KvStore {
  current ??= typeof indexedDB === 'undefined' ? memoryStore() : resilient(idbStore());
  return current;
}

/** Testes: troca o armazenamento. */
export function setOfflineStore(s: KvStore | null) {
  current = s;
}
