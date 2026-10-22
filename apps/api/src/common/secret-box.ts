import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifra credenciais de integrações com AES-256-GCM. Formato: iv(12) | tag(16) | dados.
 * O "contexto" (ex.: id do restaurante) entra como dado autenticado: um valor cifrado de um
 * restaurante não decifra se for copiado para outro.
 */
export function seal(keyB64: string, plain: string, context: string): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(context));
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]);
}

export function open(keyB64: string, sealed: Buffer, context: string): string {
  const key = Buffer.from(keyB64, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  d.setAAD(Buffer.from(context));
  d.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([d.update(sealed.subarray(28)), d.final()]).toString('utf8');
}
