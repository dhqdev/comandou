import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from 'baileys';
import { hashName, open, seal } from './crypto.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function tenantDir(dataDir: string, tenantId: string) {
  if (!UUID_RE.test(tenantId)) throw new Error('tenantId inválido');
  return join(dataDir, tenantId.toLowerCase());
}

/**
 * Estado de autenticação do Baileys guardado CIFRADO em disco, uma pasta por restaurante.
 * Cada item (credenciais, chaves Signal) é um arquivo selado com AES-256-GCM; o nome do arquivo
 * é um hash, e o contexto autenticado é "<tenant>:<item>".
 */
export async function useEncryptedAuthState(
  dataDir: string,
  tenantId: string,
  key: Buffer,
): Promise<{ state: AuthenticationState; saveCreds(): Promise<void> }> {
  const dir = tenantDir(dataDir, tenantId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const locks = new Map<string, Promise<unknown>>();
  const locked = <T>(file: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(file) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(
      file,
      next.catch(() => undefined),
    );
    return next;
  };
  const pathOf = (item: string) => join(dir, `${hashName(item)}.bin`);
  const ctx = (item: string) => `${tenantId}:${item}`;

  const write = (item: string, value: unknown) =>
    locked(item, async () => {
      const plain = Buffer.from(JSON.stringify(value, BufferJSON.replacer));
      const tmp = `${pathOf(item)}.tmp`;
      await writeFile(tmp, seal(key, plain, ctx(item)), { mode: 0o600 });
      await rename(tmp, pathOf(item));
    });
  const read = (item: string) =>
    locked(item, async () => {
      let raw: Buffer;
      try {
        raw = await readFile(pathOf(item));
      } catch {
        return null;
      }
      // Arquivo adulterado ou de outro restaurante: falha alto (não usa sessão inválida).
      return JSON.parse(open(key, raw, ctx(item)).toString('utf8'), BufferJSON.reviver);
    });
  const remove = (item: string) => locked(item, () => rm(pathOf(item), { force: true }));

  const creds: AuthenticationCreds = (await read('creds')) ?? initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const out: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let v = await read(`${type}-${id}`);
              if (type === 'app-state-sync-key' && v)
                v = proto.Message.AppStateSyncKeyData.fromObject(v);
              out[id] = v;
            }),
          );
          return out;
        },
        set: async (data) => {
          const tasks: Promise<unknown>[] = [];
          for (const category in data) {
            const items = data[category as keyof SignalDataTypeMap] ?? {};
            for (const id in items) {
              const value = items[id];
              const item = `${category}-${id}`;
              tasks.push(value ? write(item, value) : remove(item));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write('creds', creds),
  };
}

/** Apaga a sessão do restaurante (logout). */
export async function removeAuthState(dataDir: string, tenantId: string) {
  await rm(tenantDir(dataDir, tenantId), { recursive: true, force: true });
}

/** Restaurantes com sessão salva (para reconectar ao iniciar). */
export async function savedTenants(dataDir: string): Promise<string[]> {
  try {
    return (await readdir(dataDir)).filter((d) => UUID_RE.test(d));
  } catch {
    return [];
  }
}
