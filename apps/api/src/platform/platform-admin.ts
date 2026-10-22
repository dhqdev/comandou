import { Client } from 'pg';
import { hashPassword } from '../auth/password';
import { seal } from '../common/secret-box';
import { totpContext } from './platform-auth';
import { base32Decode } from './totp';

export interface PlatformAdminInput {
  ownerUrl: string;
  key: string;
  email: string;
  name: string;
  password: string;
  totpSecret: string;
}

function check(i: PlatformAdminInput) {
  if (!i.email.includes('@')) throw new Error('e-mail do Super Admin inválido');
  if (i.password.length < 12) throw new Error('a senha do Super Admin precisa de 12+ caracteres');
  if (base32Decode(i.totpSecret).length < 10) throw new Error('segredo TOTP curto demais');
}

/** Abre uma conexão do dono, uma transação, e confirma (ou desfaz) o que `fn` fizer. */
async function inTransaction<T>(ownerUrl: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

/**
 * Cria o primeiro Super Admin só se a plataforma ainda não tem nenhum. Nunca altera um
 * administrador existente, então pode rodar a cada deploy. Retorna se criou.
 */
export const bootstrapPlatformAdmin = (i: PlatformAdminInput) =>
  inTransaction(i.ownerUrl, (c) => bootstrapIn(c, i));

/** Cria mais um administrador (uso manual). Falha se o e-mail já existe. */
export const createPlatformAdmin = (i: PlatformAdminInput) =>
  inTransaction(i.ownerUrl, (c) => insertAdmin(c, i, 'cli'));

/** Troca senha e 2º fator de um administrador (esqueci a senha) e encerra as sessões dele. */
export const resetPlatformAdmin = (i: PlatformAdminInput) =>
  inTransaction(i.ownerUrl, (c) => resetIn(c, i));

/** As três operações abaixo rodam dentro de uma transação já aberta em `c`. */
export async function bootstrapIn(c: Client, i: PlatformAdminInput): Promise<boolean> {
  check(i);
  // Trava para duas execuções simultâneas não criarem dois administradores.
  await c.query(`SELECT pg_advisory_xact_lock(hashtext('pedemais.platform_admin_bootstrap'))`);
  const n = await c.query<{ n: string }>(`SELECT count(*) AS n FROM platform_admins`);
  if (Number(n.rows[0].n) > 0) return false;
  await insertAdmin(c, i, 'bootstrap');
  return true;
}

export async function resetIn(c: Client, i: PlatformAdminInput): Promise<void> {
  check(i);
  const r = await c.query<{ id: string }>(
    `UPDATE platform_admins
        SET password_hash = $2, totp_secret_enc = '\\x00', totp_last_step = 0
      WHERE email = $1 RETURNING id`,
    [i.email.toLowerCase(), await hashPassword(i.password)],
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error('administrador não encontrado');
  await c.query(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
    id,
    seal(i.key, i.totpSecret, totpContext(id)),
  ]);
  await c.query(
    `UPDATE platform_sessions SET revoked_at = now() WHERE admin_id = $1 AND revoked_at IS NULL`,
    [id],
  );
  await audit(c, id, 'platform.admin_reset', 'cli');
}

async function insertAdmin(c: Client, i: PlatformAdminInput, via: string) {
  check(i);
  const r = await c.query<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ($1, $2, $3, '\\x00') ON CONFLICT (email) DO NOTHING RETURNING id`,
    [i.email.toLowerCase(), i.name, await hashPassword(i.password)],
  );
  if (!r.rows[0]) throw new Error('já existe um administrador com este e-mail');
  const id = r.rows[0].id;
  await c.query(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
    id,
    seal(i.key, i.totpSecret, totpContext(id)),
  ]);
  await audit(c, id, 'platform.admin_created', via);
}

const audit = (c: Client, id: string, action: string, via: string) =>
  c.query(
    `INSERT INTO platform_audit_log (admin_id, action, entity, entity_id, data)
     VALUES ($1::uuid, $2, 'platform_admin', $1::text, jsonb_build_object('via', $3::text))`,
    [id, action, via],
  );
