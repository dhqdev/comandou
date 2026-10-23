import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/auth/password';
import { open as unseal } from '../src/common/secret-box';
import { seedDefaultPlans } from '../src/platform/default-plans';
import { bootstrapIn, resetIn } from '../src/platform/platform-admin';
import { totpContext } from '../src/platform/platform-auth';
import { newTotpSecret } from '../src/platform/totp';
import { OWNER_URL } from './env';

/**
 * Tudo roda numa transação que é desfeita no fim, depois de esvaziar os administradores dentro
 * dela: o banco de teste é compartilhado com outros arquivos e não pode ser alterado.
 */
const key = randomBytes(32).toString('base64');
const secret = newTotpSecret();
const base = (over: Partial<Parameters<typeof bootstrapIn>[1]> = {}) => ({
  ownerUrl: OWNER_URL,
  key,
  email: 'Dono@Plataforma.Test',
  name: 'Dono',
  password: 'senha-bootstrap-123',
  totpSecret: secret,
  ...over,
});

let c: Client;
const admins = async () =>
  (
    await c.query<{ id: string; email: string; password_hash: string; totp_secret_enc: Buffer }>(
      `SELECT id, email, password_hash, totp_secret_enc FROM platform_admins`,
    )
  ).rows;

beforeAll(async () => {
  c = new Client({ connectionString: OWNER_URL });
  await c.connect();
  await c.query('BEGIN');
  await c.query('DELETE FROM support_access_tokens');
  await c.query('DELETE FROM platform_sessions');
  await c.query('DELETE FROM platform_audit_log');
  await c.query('DELETE FROM platform_admins');
});
afterAll(async () => {
  await c.query('ROLLBACK');
  await c.end();
});

describe('Super Admin criado na instalação', () => {
  it('cria o primeiro com o segredo do autenticador cifrado e auditado', async () => {
    expect(await bootstrapIn(c, base())).toBe(true);
    const [a] = await admins();
    expect(a.email).toBe('dono@plataforma.test');
    expect(await verifyPassword('senha-bootstrap-123', a.password_hash)).toBe(true);
    expect(unseal(key, a.totp_secret_enc, totpContext(a.id))).toBe(secret);
    const log = await c.query(
      `SELECT 1 FROM platform_audit_log WHERE action = 'platform.admin_created'`,
    );
    expect(log.rowCount).toBe(1);
  });

  it('num novo deploy não muda nada, mesmo com outra senha no ambiente', async () => {
    expect(await bootstrapIn(c, base({ password: 'outra-senha-456789' }))).toBe(false);
    expect(await bootstrapIn(c, base({ email: 'outro@plataforma.test' }))).toBe(false);
    const all = await admins();
    expect(all).toHaveLength(1);
    expect(await verifyPassword('senha-bootstrap-123', all[0].password_hash)).toBe(true);
  });

  it('redefine senha e autenticador só quando pedido, e encerra as sessões', async () => {
    const [a] = await admins();
    await c.query(
      `INSERT INTO platform_sessions (admin_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 day')`,
      [a.id, randomBytes(32)],
    );
    const novo = newTotpSecret();
    await resetIn(c, base({ password: 'nova-senha-456789', totpSecret: novo }));
    const [b] = await admins();
    expect(await verifyPassword('nova-senha-456789', b.password_hash)).toBe(true);
    expect(unseal(key, b.totp_secret_enc, totpContext(b.id))).toBe(novo);
    const open = await c.query(`SELECT 1 FROM platform_sessions WHERE revoked_at IS NULL`);
    expect(open.rowCount).toBe(0);
    await expect(resetIn(c, base({ email: 'ninguem@x.test' }))).rejects.toThrow(/não encontrado/);
  });

  it('recusa senha curta e e-mail inválido', async () => {
    await expect(bootstrapIn(c, base({ password: 'curta' }))).rejects.toThrow(/12\+/);
    await expect(bootstrapIn(c, base({ email: 'sem-arroba' }))).rejects.toThrow(/e-mail/);
  });
});

describe('Planos padrão na instalação', () => {
  it('cria Essencial (padrão), Profissional e Premium só quando não há nenhum plano', async () => {
    await c.query('SAVEPOINT planos');
    try {
      await c.query('DELETE FROM subscriptions');
      await c.query('DELETE FROM plans');
      expect(await seedDefaultPlans(c)).toBe(3);
      const { rows } = await c.query<{ code: string; is_default: boolean; trial_days: number }>(
        `SELECT code, is_default, trial_days FROM plans ORDER BY price_monthly`,
      );
      expect(rows.map((r) => r.code)).toEqual(['essencial', 'profissional', 'premium']);
      expect(rows.filter((r) => r.is_default).map((r) => r.code)).toEqual(['essencial']);
      // Já existem planos: um novo deploy não cria nem altera nada.
      await c.query(`UPDATE plans SET price_monthly = 1 WHERE code = 'essencial'`);
      expect(await seedDefaultPlans(c)).toBe(0);
      const p = await c.query(
        `SELECT price_monthly::text AS p FROM plans WHERE code = 'essencial'`,
      );
      expect(p.rows[0].p).toBe('1.00');
    } finally {
      await c.query('ROLLBACK TO SAVEPOINT planos');
    }
  });
});
