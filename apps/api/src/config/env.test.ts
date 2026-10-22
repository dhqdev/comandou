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
  it('ignora *_FILE que não são segredos da aplicação', () => {
    const out = resolveFileSecrets({
      SSL_CERT_FILE: '/nao/existe',
      PIP_CONFIG_FILE: '/nao/existe',
    });
    expect(out.SSL).toBeUndefined();
    expect(out.PIP_CONFIG).toBeUndefined();
  });
  it('INTEGRATIONS_KEY: vazia = ausente; precisa ter 32 bytes', () => {
    const base = { DATABASE_URL: 'postgres://u:p@h/db' };
    expect(loadEnv({ ...base, INTEGRATIONS_KEY: '' }).INTEGRATIONS_KEY).toBeUndefined();
    expect(() => loadEnv({ ...base, INTEGRATIONS_KEY: 'curta' })).toThrow(/INTEGRATIONS_KEY/);
    const key = Buffer.alloc(32, 7).toString('base64');
    expect(loadEnv({ ...base, INTEGRATIONS_KEY: key }).INTEGRATIONS_KEY).toBe(key);
    const e = loadEnv({ ...base, WHATSAPP_GATEWAY_URL: '', WHATSAPP_GATEWAY_TOKEN: '' });
    expect(e.WHATSAPP_GATEWAY_URL).toBeUndefined();
    expect(() => loadEnv({ ...base, WHATSAPP_GATEWAY_TOKEN: 'curto' })).toThrow(
      /WHATSAPP_GATEWAY_TOKEN/,
    );
  });
});
