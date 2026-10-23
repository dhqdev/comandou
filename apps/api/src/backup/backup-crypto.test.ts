import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decryptFile, encryptFile } from './backup-crypto';

const KEY = randomBytes(32).toString('base64');

describe('cifra dos backups', () => {
  it('cifra e decifra arquivos grandes sem mudar nada', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cm-crypto-'));
    const data = randomBytes(3 * 1024 * 1024 + 17);
    await writeFile(join(dir, 'in'), data);
    await encryptFile(KEY, join(dir, 'in'), join(dir, 'enc'));
    const enc = await readFile(join(dir, 'enc'));
    expect(enc.subarray(0, 6).toString()).toBe('CMBK1\n');
    expect(enc.includes(data.subarray(0, 64))).toBe(false);
    await decryptFile(KEY, join(dir, 'enc'), join(dir, 'out'));
    expect((await readFile(join(dir, 'out'))).equals(data)).toBe(true);
  });

  it('chave errada ou arquivo adulterado não abrem', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cm-crypto-'));
    await writeFile(join(dir, 'in'), 'pedidos do restaurante');
    await encryptFile(KEY, join(dir, 'in'), join(dir, 'enc'));
    await expect(
      decryptFile(randomBytes(32).toString('base64'), join(dir, 'enc'), join(dir, 'out')),
    ).rejects.toThrow(/chave errada/);
    const enc = await readFile(join(dir, 'enc'));
    enc[40] ^= 1;
    await writeFile(join(dir, 'bad'), enc);
    await expect(decryptFile(KEY, join(dir, 'bad'), join(dir, 'out'))).rejects.toThrow(
      /adulterado/,
    );
    await writeFile(join(dir, 'other'), 'não é backup nenhum, só texto comprido o bastante');
    await expect(decryptFile(KEY, join(dir, 'other'), join(dir, 'out'))).rejects.toThrow(
      /formato desconhecido/,
    );
  });
});
