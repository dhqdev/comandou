import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM. Formato: iv(12) | tag(16) | dados. O contexto (restaurante + arquivo) entra como
 * dado autenticado: um arquivo de sessão copiado para outro restaurante não decifra.
 */
export function seal(key: Buffer, plain: Buffer, context: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(context));
  const data = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]);
}

export function open(key: Buffer, sealed: Buffer, context: string): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  d.setAAD(Buffer.from(context));
  d.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([d.update(sealed.subarray(28)), d.final()]);
}

/** Nome de arquivo que não revela o conteúdo (ids de contatos/chaves viram hash). */
export const hashName = (name: string) => createHash('sha256').update(name).digest('hex');
