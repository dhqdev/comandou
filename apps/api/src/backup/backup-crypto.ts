import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

/**
 * Cifra dos arquivos de backup (AES-256-GCM em fluxo, sem carregar o arquivo na memória).
 *
 * Formato: "CMBK1\n" (6) | sal (16) | iv (12) | dados cifrados | tag (16).
 * A chave de cada arquivo sai da INTEGRATIONS_KEY por HKDF-SHA256 com o sal do próprio arquivo.
 * Sem a INTEGRATIONS_KEY o backup não abre: guarde-a fora do servidor (ela está na stack).
 */
const MAGIC = Buffer.from('CMBK1\n');
const HEADER = MAGIC.length + 16 + 12;
const TAG = 16;

function fileKey(keyB64: string, salt: Buffer): Buffer {
  const master = Buffer.from(keyB64, 'base64');
  if (master.length !== 32) throw new Error('INTEGRATIONS_KEY precisa ter 32 bytes em base64');
  return Buffer.from(hkdfSync('sha256', master, salt, 'comandou-backup-v1', 32));
}

export async function encryptFile(keyB64: string, input: string, output: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', fileKey(keyB64, salt), iv);
  const out = createWriteStream(output, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(createReadStream(input), c, out, { end: false });
  await new Promise<void>((resolve, reject) =>
    out.end(c.getAuthTag(), (e?: Error | null) => (e ? reject(e) : resolve())),
  );
}

export async function decryptFile(keyB64: string, input: string, output: string) {
  const { size } = await stat(input);
  if (size < HEADER + TAG) throw new Error('Arquivo de backup incompleto');
  const fh = await open(input, 'r');
  const head = Buffer.alloc(HEADER);
  const tag = Buffer.alloc(TAG);
  try {
    await fh.read(head, 0, HEADER, 0);
    await fh.read(tag, 0, TAG, size - TAG);
  } finally {
    await fh.close();
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error('Não é um backup do Comandou (formato desconhecido)');
  const salt = head.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = head.subarray(MAGIC.length + 16, HEADER);
  const d = createDecipheriv('aes-256-gcm', fileKey(keyB64, salt), iv);
  d.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(input, { start: HEADER, end: size - TAG - 1 }),
      d,
      createWriteStream(output, { mode: 0o600 }),
    );
  } catch (e) {
    throw new Error(
      /auth/i.test((e as Error).message)
        ? 'Backup não confere: chave errada (INTEGRATIONS_KEY) ou arquivo adulterado'
        : (e as Error).message,
    );
  }
}
