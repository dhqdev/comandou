import { Client } from 'pg';
import { validateTenantSlug } from '@comandou/shared';
import { hashPassword } from '../auth/password';

export interface ProvisionInput {
  slug: string;
  name: string;
  adminEmail: string;
  adminName: string;
  /** Usada apenas se o usuário ainda não existir. Nunca é registrada em log. */
  adminPassword: string;
  /** Plano da assinatura inicial. Sem ele, usa o plano padrão (se houver). */
  planCode?: string;
}

export interface ProvisionResult {
  tenantId: string;
  status: string;
  stepsRun: string[];
}

const STEPS = [
  'tenant',
  'admin_user',
  'admin_membership',
  'defaults',
  'subscription',
  'activate',
] as const;

/**
 * Provisionamento idempotente e retomável (banco compartilhado: NÃO cria banco por tenant).
 * Executa com a conexão do dono (CLI) ou do papel da plataforma (painel Super Admin), pois é
 * uma operação global. Cada etapa é registrada em
 * tenant_provisioning_steps; reexecutar após falha retoma do ponto pendente sem duplicar recursos.
 * O acesso administrativo só é liberado na etapa final (status = provisioned).
 */
export async function provisionTenant(
  ownerUrl: string,
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const v = validateTenantSlug(input.slug);
  if (!v.ok) throw new Error(`slug inválido: ${v.reason}`);
  if (input.adminPassword.length < 10)
    throw new Error('senha do administrador deve ter ao menos 10 caracteres');

  const c = new Client({ connectionString: ownerUrl });
  await c.connect();
  const stepsRun: string[] = [];
  try {
    await c.query('SELECT pg_advisory_lock(hashtext($1))', [`provision:${input.slug}`]);

    // Plano informado precisa existir ANTES de criar qualquer coisa (erro de digitação não
    // deixa um restaurante pela metade).
    if (input.planCode) {
      const p = await c.query(`SELECT 1 FROM plans WHERE code = $1 AND active`, [input.planCode]);
      if (!p.rowCount) throw new Error(`plano não encontrado ou inativo: ${input.planCode}`);
    }

    // Etapa: tenant (cria ou reaproveita)
    const existing = await c.query<{ id: string; status: string }>(
      'SELECT id, status FROM tenants WHERE slug = $1',
      [input.slug],
    );
    let tenantId: string;
    if (existing.rows[0]) {
      tenantId = existing.rows[0].id;
      if (existing.rows[0].status === 'suspended')
        throw new Error('tenant suspenso: reative explicitamente');
      if (existing.rows[0].status === 'provisioned') {
        return { tenantId, status: 'provisioned', stepsRun };
      }
      await c.query(
        `UPDATE tenants SET status = 'recovering' WHERE id = $1 AND status = 'failed'`,
        [tenantId],
      );
    } else {
      const r = await c.query<{ id: string }>(
        `INSERT INTO tenants (slug, name, status) VALUES ($1, $2, 'provisioning') RETURNING id`,
        [input.slug, input.name],
      );
      tenantId = r.rows[0].id;
    }

    const done = new Set(
      (
        await c.query<{ step: string }>(
          `SELECT step FROM tenant_provisioning_steps WHERE tenant_id = $1 AND status = 'done'`,
          [tenantId],
        )
      ).rows.map((r) => r.step),
    );

    for (const step of STEPS) {
      if (done.has(step)) continue;
      try {
        await c.query('BEGIN');
        await runStep(c, step, tenantId, input);
        await c.query(
          `INSERT INTO tenant_provisioning_steps (tenant_id, step, status, attempts)
           VALUES ($1, $2, 'done', 1)
           ON CONFLICT (tenant_id, step) DO UPDATE
             SET status = 'done', attempts = tenant_provisioning_steps.attempts + 1, last_error = NULL, updated_at = now()`,
          [tenantId, step],
        );
        await c.query('COMMIT');
        stepsRun.push(step);
      } catch (err) {
        await c.query('ROLLBACK');
        const msg = (err as Error).message.slice(0, 500);
        await c.query(
          `INSERT INTO tenant_provisioning_steps (tenant_id, step, status, attempts, last_error)
           VALUES ($1, $2, 'failed', 1, $3)
           ON CONFLICT (tenant_id, step) DO UPDATE
             SET status = 'failed', attempts = tenant_provisioning_steps.attempts + 1, last_error = $3, updated_at = now()`,
          [tenantId, step, msg],
        );
        await c.query(`UPDATE tenants SET status = 'failed' WHERE id = $1`, [tenantId]);
        throw new Error(`provisionamento falhou na etapa ${step}: ${msg}`);
      }
    }
    return { tenantId, status: 'provisioned', stepsRun };
  } finally {
    await c
      .query('SELECT pg_advisory_unlock(hashtext($1))', [`provision:${input.slug}`])
      .catch(() => undefined);
    await c.end();
  }
}

async function runStep(
  c: Client,
  step: (typeof STEPS)[number],
  tenantId: string,
  input: ProvisionInput,
) {
  switch (step) {
    case 'tenant':
      return; // já garantido acima
    case 'admin_user': {
      const hash = await hashPassword(input.adminPassword);
      await c.query(
        `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
        [input.adminEmail.toLowerCase(), input.adminName, hash],
      );
      return;
    }
    case 'admin_membership':
      await c.query(
        `INSERT INTO memberships (tenant_id, user_id, role)
         SELECT $1, id, 'owner' FROM users WHERE email = $2
         ON CONFLICT (tenant_id, user_id) DO NOTHING`,
        [tenantId, input.adminEmail.toLowerCase()],
      );
      return;
    case 'defaults':
      await c.query(
        `INSERT INTO categories (tenant_id, name, position)
         SELECT $1, 'Mais pedidos', 0
         WHERE NOT EXISTS (SELECT 1 FROM categories WHERE tenant_id = $1)`,
        [tenantId],
      );
      return;
    case 'subscription': {
      const plan = (
        await c.query<{ id: string; trial_days: number }>(
          input.planCode
            ? `SELECT id, trial_days FROM plans WHERE code = $1 AND active`
            : `SELECT id, trial_days FROM plans WHERE is_default AND $1::text IS NULL`,
          [input.planCode ?? null],
        )
      ).rows[0];
      if (!plan) return; // sem plano padrão: restaurante sem limites de plano
      await c.query(
        `INSERT INTO subscriptions (tenant_id, plan_id, status, trial_ends_at)
         SELECT $1, $2,
                CASE WHEN $3::int > 0 THEN 'trialing' ELSE 'active' END,
                CASE WHEN $3::int > 0 THEN now() + make_interval(days => $3::int) END
          WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE tenant_id = $1 AND status <> 'cancelled')`,
        [tenantId, plan.id, plan.trial_days],
      );
      return;
    }
    case 'activate':
      await c.query(`UPDATE tenants SET status = 'provisioned' WHERE id = $1`, [tenantId]);
      await c.query(
        `INSERT INTO audit_log (tenant_id, action, entity, entity_id, data)
         VALUES ($1, 'tenant.provisioned', 'tenant', $2, jsonb_build_object('slug', $3::text))`,
        [tenantId, tenantId, input.slug],
      );
      return;
  }
}
