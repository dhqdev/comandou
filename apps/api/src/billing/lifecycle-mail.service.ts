import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { formatBRL, spDate, toCents } from '@comandou/shared';
import type { PoolClient } from 'pg';
import { ENV, Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import {
  Mail,
  paymentDueEmail,
  paymentOverdueEmail,
  paymentReceivedEmail,
  trialEndedEmail,
  trialEndingEmail,
} from '../mail/templates/emails';
import { siteUrlOf, tenantUrlOf } from '../mail/templates/urls';
import { PlatformDb } from '../platform/platform-db.service';

/** Avisos que saem sozinhos (um por restaurante, assunto e referência). */
export type LifecycleKind =
  | 'trial.ending'
  | 'trial.ended'
  | 'payment.due'
  | 'payment.overdue'
  | 'payment.blocked'
  | 'payment.received';

/** Mensalidade: lembrete a partir de 3 dias antes do vencimento. */
export const DUE_REMINDER_DAYS = 3;
const DAY = 86_400_000;

interface Target {
  tenant_id: string;
  slug: string;
  name: string;
}

interface Pending {
  t: Target;
  kind: LifecycleKind;
  ref: string;
  build: (who: { name: string | null }) => Mail;
}

/**
 * E-mails automáticos do ciclo de vida do restaurante, pelo envio do Comandou (Resend):
 * o teste grátis acaba amanhã, o teste acabou, a mensalidade vence em breve, venceu, o sistema foi
 * pausado e o pagamento foi recebido. Roda a cada 30 minutos (uma réplica por vez) e cada aviso
 * sai uma vez só: `platform_lifecycle_mails` guarda o que já foi (restaurante + assunto + fatura
 * ou dia). Desliga em Super Admin › E-mail › Modelos. Janelas curtas (o que passou há dias não
 * sai), para uma instalação nova não mandar avisos velhos.
 */
@Injectable()
export class LifecycleMailService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Avisos');
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly mail: MailService,
  ) {}

  onApplicationBootstrap() {
    if (!this.db.enabled || this.env.NODE_ENV === 'test') return;
    this.first = setTimeout(() => void this.runSafely(), 90_000);
    this.timer = setInterval(() => void this.runSafely(), 30 * 60_000);
    this.first.unref();
    this.timer.unref();
  }

  onModuleDestroy() {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  private async runSafely() {
    try {
      const n = await this.run();
      if (n) this.logger.log(`${n} aviso(s) de teste e cobrança enviado(s)`);
    } catch (e) {
      this.logger.warn(`avisos de teste e cobrança falharam: ${(e as Error).message}`);
    }
  }

  /** Uma passada: devolve quantos avisos entraram na fila. */
  async run(now = new Date()): Promise<number> {
    if (!this.db.enabled) return 0;
    const [m] = await this.db.query<{ enabled: boolean }>(
      `SELECT lifecycle_enabled AS enabled FROM mail_settings WHERE id`,
    );
    if (!m?.enabled || !(await this.mail.ready())) return 0;
    const lock = await this.db.pool!.connect();
    try {
      const got = (
        await lock.query<{ ok: boolean }>(
          `SELECT pg_try_advisory_lock(hashtext('comandou.lifecycle_mails')) AS ok`,
        )
      ).rows[0]!.ok;
      if (!got) return 0;
      try {
        return await this.pass(now);
      } finally {
        await lock.query(`SELECT pg_advisory_unlock(hashtext('comandou.lifecycle_mails'))`);
      }
    } finally {
      lock.release();
    }
  }

  private async pass(now: Date): Promise<number> {
    const [b] = await this.db.query<{ block_after_days: number; sales_contact: string }>(
      `SELECT block_after_days, sales_contact FROM platform_billing_settings WHERE id`,
    );
    const assets = siteUrlOf(this.env);
    const contact = b?.sales_contact || null;
    const blockAfter = b?.block_after_days ?? 0;
    const today = spDate(now);
    const base = (t: Target, name: string | null) => ({
      name,
      restaurant: t.name,
      planUrl: `${tenantUrlOf(this.env, t.slug)}/plano`,
      assets,
      contact,
    });
    const money = (v: string) => formatBRL(toCents(v));
    const todo: Pending[] = [];

    // Teste grátis: fim efetivo (assinatura em teste, ou cadastro do site sem assinatura).
    const trials = await this.db.query<
      Target & { ends: Date; paid: boolean; price: string | null }
    >(
      `SELECT t.id AS tenant_id, t.slug, t.name,
              COALESCE(s.trial_ends_at, ts.trial_ends_at) AS ends,
              s.current_period_end IS NOT NULL AS paid, p.price_monthly::text AS price
         FROM tenants t
         LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status <> 'cancelled'
         LEFT JOIN plans p ON p.id = s.plan_id
         LEFT JOIN trial_signups ts ON ts.tenant_id = t.id
        WHERE t.status IN ('provisioned', 'suspended')
          AND (s.status IN ('trialing', 'past_due') OR (s.id IS NULL AND ts.id IS NOT NULL))
          AND COALESCE(s.trial_ends_at, ts.trial_ends_at)
              BETWEEN $1::timestamptz - interval '3 days' AND $1::timestamptz + interval '26 hours'`,
      [now],
    );
    for (const r of trials) {
      const ends = new Date(r.ends);
      const ref = ends.toISOString().slice(0, 10);
      const left = ends.getTime() - now.getTime();
      if (left > 2 * 3600_000 && left <= 26 * 3600_000)
        todo.push({
          t: r,
          kind: 'trial.ending',
          ref,
          build: (w) =>
            trialEndingEmail({
              ...base(r, w.name),
              endsAt: ends,
              price: r.price && toCents(r.price) > 0 ? money(r.price) : null,
            }),
        });
      else if (left <= 0 && !r.paid)
        todo.push({
          t: r,
          kind: 'trial.ended',
          ref,
          build: (w) => trialEndedEmail(base(r, w.name)),
        });
    }

    // Faturas: vencendo, vencidas (ou com o sistema pausado) e pagas.
    const inv = await this.db.query<
      Target & {
        id: string;
        status: string;
        amount: string;
        due: string;
        url: string | null;
        description: string;
        paid_at: Date | null;
        blocked: boolean;
        until: Date | null;
      }
    >(
      `SELECT t.id AS tenant_id, t.slug, t.name, i.id, i.status, i.amount::text AS amount,
              i.due_date::text AS due, COALESCE(i.invoice_url, i.bank_slip_url) AS url,
              i.description, i.paid_at, s.block_reason = 'payment' AS blocked,
              s.current_period_end AS until
         FROM billing_invoices i
         JOIN subscriptions s ON s.id = i.subscription_id
         JOIN tenants t ON t.id = i.tenant_id
        WHERE t.status IN ('provisioned', 'suspended') AND s.status <> 'cancelled'
          AND ((i.status = 'pending' AND i.due_date BETWEEN $1::date AND $1::date + $2::int)
            OR (i.status = 'overdue' AND i.due_date BETWEEN $1::date - 7 AND $1::date - 1)
            OR (i.status = 'paid' AND i.paid_at > $3::timestamptz - interval '2 days'))`,
      [today, DUE_REMINDER_DAYS, now],
    );
    for (const r of inv) {
      const amount = money(r.amount);
      if (r.status === 'pending') {
        const daysLeft = Math.round(
          (Date.parse(`${r.due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / DAY,
        );
        todo.push({
          t: r,
          kind: 'payment.due',
          ref: r.id,
          build: (w) =>
            paymentDueEmail({
              ...base(r, w.name),
              amount,
              dueDate: r.due,
              daysLeft,
              payUrl: r.url,
              description: r.description,
            }),
        });
      } else if (r.status === 'overdue') {
        const blockOn = blockAfter
          ? new Date(Date.parse(`${r.due}T12:00:00Z`) + blockAfter * DAY).toISOString().slice(0, 10)
          : null;
        todo.push({
          t: r,
          kind: r.blocked ? 'payment.blocked' : 'payment.overdue',
          ref: r.id,
          build: (w) =>
            paymentOverdueEmail({
              ...base(r, w.name),
              amount,
              dueDate: r.due,
              payUrl: r.url,
              blocked: r.blocked,
              blockOn: blockOn && blockOn > today ? blockOn : null,
            }),
        });
      } else if (r.status === 'paid' && r.paid_at) {
        todo.push({
          t: r,
          kind: 'payment.received',
          ref: r.id,
          build: (w) =>
            paymentReceivedEmail({
              ...base(r, w.name),
              amount,
              paidOn: spDate(r.paid_at!),
              until: r.until,
            }),
        });
      }
    }

    let sent = 0;
    for (const p of todo) {
      try {
        const id = await this.db.tx(async (c) => {
          const claim = await c.query(
            `INSERT INTO platform_lifecycle_mails (tenant_id, kind, ref) VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, kind, ref) DO NOTHING RETURNING id`,
            [p.t.tenant_id, p.kind, p.ref],
          );
          if (!claim.rowCount) return null;
          const who = await this.recipient(c, p.t.tenant_id);
          if (!who) return null;
          const outbox = await this.mail.enqueue(c, {
            kind: p.kind,
            tenantId: p.t.tenant_id,
            to: [{ email: who.email, name: who.name ?? undefined }],
            ...p.build(who),
          });
          await c.query(`UPDATE platform_lifecycle_mails SET outbox_id = $2 WHERE id = $1`, [
            claim.rows[0].id,
            outbox,
          ]);
          return outbox;
        });
        if (id) {
          sent++;
          await this.mail.deliver(id);
        }
      } catch (e) {
        this.logger.warn(`aviso ${p.kind} (${p.t.slug}): ${(e as Error).message}`);
      }
    }
    return sent;
  }

  /**
   * Para quem vai: o e-mail de cobrança do cadastro (Super Admin › Restaurante), senão o de quem
   * criou o teste pelo site, senão o do administrador do restaurante.
   */
  private async recipient(
    c: PoolClient,
    tenantId: string,
  ): Promise<{ email: string; name: string | null } | null> {
    const { rows } = await c.query<{ email: string; name: string | null }>(
      `SELECT email, name FROM (
         SELECT p.billing_email AS email, p.contact_name AS name, 1 AS pri
           FROM tenant_profiles p WHERE p.tenant_id = $1 AND COALESCE(p.billing_email, '') <> ''
         UNION ALL
         SELECT ts.email::text, ts.contact_name, 2 FROM trial_signups ts WHERE ts.tenant_id = $1
         UNION ALL
         SELECT u.email::text, u.name, 3
           FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.tenant_id = $1 AND m.role = 'owner' AND m.status = 'active'
            AND u.disabled_at IS NULL AND u.email::text NOT LIKE '%.invalid'
       ) x ORDER BY pri LIMIT 1`,
      [tenantId],
    );
    return rows[0] ?? null;
  }
}
