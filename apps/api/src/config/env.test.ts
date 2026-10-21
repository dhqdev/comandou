import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnv, resolveFileSecrets } from './env';

describe('env', () => {
  it('falha com mensagem clara quando falta DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
  it('lê segredos de arquivos *_FILE sem sobrescrever valores explícitos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-'));
    const f = join(dir, 'db');
    writeFileSync(f, 'postgres://u:p@h/db\n');
    expect(resolveFileSecrets({ DATABASE_URL_FILE: f }).DATABASE_URL).toBe('postgres://u:p@h/db');
    expect(resolveFileSecrets({ DATABASE_URL_FILE: f, DATABASE_URL: 'x' }).DATABASE_URL).toBe('x');
  });
});
