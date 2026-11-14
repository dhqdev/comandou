import type { Pool, PoolClient } from 'pg';
import type { Env } from '../config/env';
import { TenantDatabaseUnavailable } from '../database/tenant-database';
import { seedDefaultPlans } from '../platform/default-plans';
import { ContractsService } from '../platform/contracts/contracts.service';
import type { PlatformDb } from '../platform/platform-db.service';
import type { DemoCatalog } from './types';

const DAY = 86_400_000;

/**
 * Lado da plataforma (banco central) de uma demonstração que tem `platform`: cadastro do cliente,
 * assinatura paga, faturas, limite do assistente e um contrato já assinado pelo cliente,
 * esperando a assinatura da contratada no Super Admin. Nada aqui manda e-mail ou webhook.
 * Erros viram aviso no log: a demonstração continua de pé sem esta parte.
 */
export async function seedDemoPlatform(
  pool: Pool,
  tenantId: string,
  catalog: DemoCatalog,
  o: { baseDomain: string; slug: string; ownerEmail: string; log: (m: string) => void },
) {
  const p = catalog.platform;
  if (!p) return;
  const now = Date.now();
  const tx = async <T>(fn: (c: PoolClient) => Promise<T>) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  };

  // ------------------------------------------------------------------ cadastro, assinatura e faturas
  await tx(async (c) => {
    await seedDefaultPlans(c);
    await c.query(
      `INSERT INTO tenant_profiles (tenant_id, legal_name, document, contact_name, phone, billing_email, city, state, notes)
       VALUES ($1,$2,$3,$4,$5,$6,'São Paulo','SP',$7)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [
        tenantId,
        p.legalName,
        p.document,
        p.contactName,
        p.phone,
        o.ownerEmail,
        'Restaurante de demonstração (criado na subida da stack).',
      ],
    );
    const plan = (
      await c.query<{ id: string; price: string }>(
        `SELECT id, price_monthly::text AS price FROM plans
          WHERE active ORDER BY (code = $1) DESC, price_monthly DESC LIMIT 1`,
        [p.planCode],
      )
    ).rows[0];
    if (!plan) return;
    const has = await c.query(
      `SELECT 1 FROM subscriptions WHERE tenant_id = $1 AND status <> 'cancelled'`,
      [tenantId],
    );
    if (has.rowCount) return;
    const months = p.monthsActive ?? 2;
    const started = now - (months * 30 + 15) * DAY;
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, started_at, current_period_end, notes, billing_mode, created_at)
       VALUES ($1,$2,'active',$3,$4,$5,'manual',$3) RETURNING id`,
      [
        tenantId,
        plan.id,
        new Date(started),
        new Date(now + 15 * DAY),
        'Demonstração: assinatura paga por fora (sem cobrança automática).',
      ],
    );
    const sub = rows[0]!.id;
    // Mensalidades pagas desde o começo e a próxima em aberto.
    for (let i = 0; i <= months; i++) {
      const back = (months - i) * 30;
      const period = now - back * DAY - 15 * DAY;
      const paid = i < months;
      await c.query(
        `INSERT INTO billing_invoices (tenant_id, subscription_id, kind, plan_id, description, amount, period_start,
            due_date, status, billing_type, paid_at, net_amount, applied_at, created_at)
         VALUES ($1,$2,'monthly',$3,$4,$5,$6,$7,$8,'PIX',$9,$10,$9,$6)`,
        [
          tenantId,
          sub,
          plan.id,
          `Mensalidade ${new Date(period + 15 * DAY).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`,
          plan.price,
          new Date(period),
          new Date(period + 15 * DAY).toISOString().slice(0, 10),
          paid ? 'paid' : 'pending',
          paid ? new Date(period + 14 * DAY) : null,
          paid ? (Number(plan.price) * 0.9901).toFixed(2) : null,
        ],
      );
    }
    await c.query(
      `INSERT INTO tenant_ai_settings (tenant_id, enabled, monthly_tokens) VALUES ($1, true, 300000)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId],
    );
    await c.query(
      `INSERT INTO ai_usage (tenant_id, user_id, model, prompt_tokens, completion_tokens, cost_usd, created_at)
       SELECT $1, NULL, 'openrouter/auto', 2400 + g * 37, 700 + g * 11, 0.0031, now() - (g || ' hours')::interval
         FROM generate_series(1, 18) g`,
      [tenantId],
    );
  });

  // ------------------------------------------------------------------ suporte e chamados
  if (p.support?.length || p.tickets?.length)
    await tx(async (c) => {
      const owner = catalog.users.find((u) => u.role === 'owner')!;
      if (p.support?.length) {
        const [lastWho, lastDays, lastBody] = p.support[p.support.length - 1]!;
        const lastAt = new Date(now - lastDays * DAY);
        await c.query(
          `INSERT INTO platform_support_chats (tenant_id, status, last_message_at, last_preview, last_sender,
              tenant_read_at, admin_read_at, created_at)
           VALUES ($1,'open',$2,$3,$4,$2,$2,$5) ON CONFLICT (tenant_id) DO NOTHING`,
          [
            tenantId,
            lastAt,
            lastBody.slice(0, 140),
            lastWho,
            new Date(now - p.support[0]![1] * DAY),
          ],
        );
        for (const [who, daysAgo, body] of p.support)
          await c.query(
            `INSERT INTO platform_support_messages (tenant_id, sender, author_name, body, created_at)
             VALUES ($1,$2,$3,$4,$5)`,
            [
              tenantId,
              who,
              who === 'tenant' ? owner.name : 'Suporte Comandou',
              body,
              new Date(now - daysAgo * DAY),
            ],
          );
      }
      // Só chamados encerrados: a esteira dos agentes nunca pega um chamado da demonstração.
      for (const [title, kind, urgency, daysAgo, description, answer] of p.tickets ?? []) {
        const opened = new Date(now - daysAgo * DAY);
        const closed = new Date(now - daysAgo * DAY + 2 * DAY);
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO platform_tickets (tenant_id, opened_by_name, opened_by_email, source, title, description,
              kind, urgency, stage, state, priority, auto_advance, created_at, updated_at, closed_at,
              stage_started_at, run_after)
           VALUES ($1,$2,$3,'client',$4,$5,$6,$7,'concluido','done',$7,false,$8,$9,$9,$9,$9) RETURNING id`,
          [tenantId, owner.name, o.ownerEmail, title, description, kind, urgency, opened, closed],
        );
        const t = rows[0]!.id;
        for (const [kindEv, actor, name, body, at] of [
          ['message', 'client', owner.name, description, opened],
          ['message', 'admin', 'Suporte Comandou', answer, new Date(opened.getTime() + DAY)],
          ['status', 'system', '', 'Chamado concluído', closed],
        ] as const)
          await c.query(
            `INSERT INTO platform_ticket_events (ticket_id, kind, actor, actor_name, body, public, created_at)
             VALUES ($1,$2,$3,$4,$5,true,$6)`,
            [t, kindEv, actor, name, body, at],
          );
      }
    });

  // ------------------------------------------------------------------ contrato
  // Só com os dados da contratada preenchidos (Contrato › Configurar) e um super admin.
  try {
    const [settings] = (
      await pool.query<{ ok: boolean }>(
        `SELECT (provider_name <> '' AND provider_document <> '') AS ok FROM platform_contract_settings`,
      )
    ).rows;
    const [admin] = (
      await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM platform_admins WHERE disabled_at IS NULL ORDER BY created_at LIMIT 1`,
      )
    ).rows;
    const exists = await pool.query(`SELECT 1 FROM tenant_contracts WHERE tenant_id = $1`, [
      tenantId,
    ]);
    if (!settings?.ok || !admin || exists.rowCount) {
      if (!exists.rowCount)
        o.log(
          'demonstração: contrato não criado (preencha os dados da contratada em Super Admin › Contrato)',
        );
      return;
    }
    const db = {
      query: async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows,
      tx,
      // O e-mail de quem assina já vai no pedido; não precisa ler o banco do restaurante.
      tenantDb: async () => {
        throw new TenantDatabaseUnavailable();
      },
    } as unknown as PlatformDb;
    const env = { COMANDOU_BASE_DOMAIN: o.baseDomain } as Env;
    const svc = new ContractsService(env, db, {} as never);
    // Demonstração não avisa ninguém: sem e-mail para a contratada nem webhook do n8n.
    (svc as unknown as { notifyClientSigned: () => Promise<void> }).notifyClientSigned = async () =>
      undefined;
    const actor = { admin: { id: admin.id, name: admin.name } as never, ip: '127.0.0.1' };
    const origin = `https://admin.${o.baseDomain}`;
    const created = (await svc.create(tenantId, { signerEmail: o.ownerEmail }, actor)) as {
      id: string;
      contentHash?: string;
    };
    const { url } = await svc.link(created.id, actor, origin);
    const token = url.split('/assinar/')[1]!;
    const meta = {
      ip: '177.92.10.24',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    };
    await svc.open(token, meta);
    await svc.markRead(token, meta);
    const [row] = (
      await pool.query<{ content_hash: string }>(
        `SELECT content_hash FROM tenant_contracts WHERE id = $1`,
        [created.id],
      )
    ).rows;
    await svc.sign(
      token,
      {
        name: p.contactName,
        document: p.signerCpf,
        email: o.ownerEmail,
        accept: true,
        contentHash: row!.content_hash,
        signature: { kind: 'typed', text: p.contactName },
        geo: { lat: catalog.location.lat, lng: catalog.location.lng, accuracy: 25 },
      },
      { ...meta, origin },
    );
    o.log('demonstração: contrato assinado pelo cliente, aguardando a contratada no Super Admin');
  } catch (e) {
    o.log(`demonstração: contrato não criado (${(e as Error).message})`);
  }
}
