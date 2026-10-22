import { Client } from 'pg';
import { hashPassword } from '../auth/password';
import { seal } from '../common/secret-box';
import { resolveFileSecrets } from '../config/env';
import { totpContext } from './platform-auth';
import { base32Decode, newTotpSecret, otpauthUri } from './totp';

/**
 * Cria um administrador da plataforma (Super Admin). Só pela linha de comando, com a conexão
 * do dono: o painel não cria administradores.
 *
 *   DATABASE_OWNER_URL=... INTEGRATIONS_KEY=... PLATFORM_ADMIN_PASSWORD=... \
 *   node dist/platform/platform-admin-cli.js <email> "<Nome>"
 *
 * Imprime UMA vez o endereço otpauth:// do aplicativo autenticador (Google Authenticator,
 * 1Password, Authy...). Guarde-o só no aplicativo. PLATFORM_ADMIN_TOTP_SECRET (base32) fixa o
 * segredo, para testes automatizados.
 */
async function main() {
  const env = resolveFileSecrets(process.env);
  const [email, name] = process.argv.slice(2);
  const ownerUrl = env.DATABASE_OWNER_URL;
  const key = env.INTEGRATIONS_KEY;
  const password = env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !name || !ownerUrl || !key || !password) {
    console.error(
      'uso: platform-admin-cli <email> <nome>  (DATABASE_OWNER_URL, INTEGRATIONS_KEY e PLATFORM_ADMIN_PASSWORD obrigatórios)',
    );
    process.exit(2);
  }
  if (password.length < 12) throw new Error('a senha do Super Admin precisa de 12+ caracteres');
  const secret = env.PLATFORM_ADMIN_TOTP_SECRET || newTotpSecret();
  if (base32Decode(secret).length < 10) throw new Error('segredo TOTP curto demais');

  const c = new Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query<{ id: string }>(
      `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
       VALUES ($1, $2, $3, '\\x00') ON CONFLICT (email) DO NOTHING RETURNING id`,
      [email.toLowerCase(), name, await hashPassword(password)],
    );
    if (!r.rows[0]) throw new Error('já existe um administrador com este e-mail');
    const id = r.rows[0].id;
    await c.query(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
      id,
      seal(key, secret, totpContext(id)),
    ]);
    await c.query(
      `INSERT INTO platform_audit_log (admin_id, action, entity, entity_id, data)
       VALUES ($1::uuid, 'platform.admin_created', 'platform_admin', $1::text, jsonb_build_object('via', 'cli'))`,
      [id],
    );
    await c.query('COMMIT');
    console.log(`administrador criado: ${email}`);
    console.log('Cadastre no aplicativo autenticador (mostrado só agora):');
    console.log(otpauthUri(secret, email.toLowerCase()));
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
