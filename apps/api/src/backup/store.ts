import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

/**
 * Onde os arquivos de backup ficam: no bucket (Backblaze B2 / S3) ou numa pasta do próprio
 * servidor (volume do Docker), quando o bucket não está configurado. Mesmas chaves e pastas
 * nos dois: <prefixo>/plataforma/AAAA/MM/... e <prefixo>/restaurantes/<endereço>/...
 */
export interface BackupStore {
  readonly kind: 'b2' | 'local';
  putFile(key: string, file: string, meta?: Record<string, string>): Promise<void>;
  putBuffer(key: string, data: Buffer): Promise<void>;
  head(key: string): Promise<{ size: number; meta: Record<string, string> } | null>;
  getToFile(key: string, file: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<{ key: string; size: number; lastModified: Date }[]>;
}

/** Pasta padrão do backup local (volume comandou_backups na stack). */
export const DEFAULT_LOCAL_DIR = '/backups';

const PART = '.parcial';

/** Pasta do servidor com o mesmo formato de chaves do bucket. Só o serviço de backup lê e grava. */
export class LocalStore implements BackupStore {
  readonly kind = 'local' as const;

  constructor(readonly root: string) {}

  /** Caminho do arquivo; recusa chaves que saiam da pasta (.., barra no começo). */
  private path(key: string) {
    if (!key || key.startsWith('/') || key.split('/').some((p) => p === '..' || p === '.' || !p))
      throw new Error(`chave de backup inválida: ${key}`);
    return join(this.root, ...key.split('/'));
  }

  async putFile(key: string, file: string) {
    const dest = this.path(key);
    await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
    // Copia para um nome temporário e renomeia: um arquivo pela metade nunca vira backup.
    await copyFile(file, dest + PART);
    await rename(dest + PART, dest);
  }

  async putBuffer(key: string, data: Buffer) {
    const dest = this.path(key);
    await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
    await writeFile(dest + PART, data, { mode: 0o600 });
    await rename(dest + PART, dest);
  }

  async head(key: string) {
    const s = await stat(this.path(key)).catch(() => null);
    return s?.isFile() ? { size: s.size, meta: {} } : null;
  }

  async getToFile(key: string, file: string) {
    const src = this.path(key);
    if (!(await this.head(key))) throw new Error(`Arquivo não encontrado na pasta local: ${key}`);
    await copyFile(src, file);
  }

  /** Apaga o arquivo e as pastas que ficaram vazias (até a raiz). */
  async delete(key: string) {
    const p = this.path(key);
    await rm(p, { force: true });
    for (let d = dirname(p); d.startsWith(this.root + sep) && d !== this.root; d = dirname(d)) {
      const ok = await rmdir(d).then(
        () => true,
        () => false,
      );
      if (!ok) break;
    }
  }

  async list(prefix: string) {
    // Começa pela pasta do prefixo (ex.: "comandou/" → <raiz>/comandou).
    const dir = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
    const start = dir ? this.path(dir) : this.root;
    const out: { key: string; size: number; lastModified: Date }[] = [];
    const walk = async (d: string) => {
      const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const full = join(d, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.isFile() && !e.name.endsWith(PART)) {
          const key = relative(this.root, full).split(sep).join('/');
          if (!key.startsWith(prefix)) continue;
          const s = await stat(full);
          out.push({ key, size: s.size, lastModified: s.mtime });
        }
      }
    };
    await walk(start);
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }
}

/** Espaço da pasta local (para o painel avisar antes de o disco encher). */
export async function localSpace(dir: string) {
  try {
    const s = await statfs(dir);
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

/** Tamanho ocupado pelos backups na pasta local. */
export async function localUsage(store: LocalStore, prefix: string) {
  const all = await store.list(`${prefix}/`);
  return { files: all.length, bytes: all.reduce((n, o) => n + o.size, 0) };
}
