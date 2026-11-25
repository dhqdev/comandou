import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { GatewayClient } from '../messaging/gateway.client';
import { PLATFORM_WA_ID } from '../messaging/whatsapp-inbound.service';
import { PlatformDb } from '../platform/platform-db.service';
import { Operator, OPERATOR_COLS } from './admin-bot.service';
import { Issue, PlatformWaChecks } from './admin-checks.service';
import { brasiliaNow, clip, ICON } from './admin-menu';
import { Delivered, PlatformWaOutbox } from './platform-wa-outbox.service';

/** Aviso que some e volta (serviço que cai de novo) só avisa outra vez depois desse tempo. */
const REARM_HOURS = 6;

const KEY_SQL = (col: string) =>
  `(CASE WHEN length(${col}) >= 12 AND left(${col}, 2) = '55' THEN substr(${col}, 3, 2)
         ELSE left(${col}, 2) END) || right(${col}, 8)`;

/**
 * Avisos automáticos e resumo do dia pelo WhatsApp do painel, para os números do menu do
 * Super Admin. Roda a cada PLATFORM_WA_ALERTS_SECONDS em todas as réplicas: cada aviso é
 * "reservado" no banco (platform_wa_alerts) antes de sair, então sai uma vez só.
 */
@Injectable()
export class PlatformWaAlerts implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('PlatformWaAlerts');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly pdb: PlatformDb,
    private readonly gateway: GatewayClient,
    private readonly checks: PlatformWaChecks,
    private readonly outbox: PlatformWaOutbox,
  ) {}

  onApplicationBootstrap() {
    const s = this.env.PLATFORM_WA_ALERTS_SECONDS;
    if (!s || !this.pdb.enabled || !this.gateway.configured) return;
    this.timer = setInterval(() => void this.tick(), s * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep();
    } catch (e) {
      this.logger.warn(`avisos do admin: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async operators(col: 'alerts' | 'summary') {
    return this.pdb.query<Operator>(
      `SELECT ${OPERATOR_COLS} FROM platform_wa_operators o
         JOIN platform_admins a ON a.id = o.admin_id AND a.disabled_at IS NULL
        WHERE o.${col} ORDER BY o.created_at`,
    );
  }

  /** Manda para o número, na conversa que já existe com ele (pode ser @lid). */
  async sendTo(op: Pick<Operator, 'phone'>, text: string): Promise<Delivered> {
    const [chat] = await this.pdb.query<{ jid: string }>(
      `SELECT jid FROM platform_wa_chats WHERE phone IS NOT NULL
          AND ${KEY_SQL('phone')} = ${KEY_SQL('$1::text')}
        ORDER BY last_at DESC LIMIT 1`,
      [op.phone],
    );
    return this.outbox.deliver(
      chat?.jid ?? op.phone,
      clip(text),
      null,
      chat?.jid ?? null,
      op.phone,
    );
  }

  /**
   * Uma volta: avisos novos e, na hora marcada, o resumo do dia. Com o WhatsApp do painel
   * desconectado não reserva nada (os avisos saem quando ele voltar).
   */
  async sweep(now = new Date()): Promise<{ alerts: number; summary: boolean }> {
    if (!this.pdb.enabled || !this.gateway.configured) return { alerts: 0, summary: false };
    const [st] = await this.pdb.query<{ enabled: boolean; summaryHour: number | null }>(
      `SELECT enabled, summary_hour AS "summaryHour" FROM platform_wa_bot_settings WHERE id`,
    );
    if (!st?.enabled) return { alerts: 0, summary: false };
    const session = await this.gateway.session(PLATFORM_WA_ID).catch(() => null);
    if (session?.status !== 'connected') return { alerts: 0, summary: false };
    const alerts = await this.alerts();
    const summary = await this.summary(st.summaryHour, now);
    return { alerts, summary };
  }

  private async alerts(): Promise<number> {
    const ops = await this.operators('alerts');
    const issues = (await this.checks.issues()).filter((i) => i.alert);
    const fresh = await this.pdb.query<{
      id: string;
      name: string;
      slug: string;
      city: string | null;
    }>(
      `SELECT t.id, t.name, t.slug, p.city FROM tenants t
         LEFT JOIN tenant_profiles p ON p.tenant_id = t.id
        WHERE t.created_at > now() - interval '1 day'`,
    );
    const all: Issue[] = [
      ...issues,
      ...fresh.map((t) => ({
        key: `tenant:new:${t.id}`,
        level: 'info' as const,
        text: `🎉 Restaurante novo: ${t.name} (${t.slug})${t.city ? ` · ${t.city}` : ''}`,
        alert: true,
      })),
    ];
    const keys = all.map((i) => i.key.slice(0, 120));
    // Problema que acabou: a chave é esquecida depois de um tempo (se voltar, avisa de novo).
    await this.pdb.query(
      `DELETE FROM platform_wa_alerts
        WHERE (NOT (key = ANY($1::text[])) AND sent_at < now() - interval '${REARM_HOURS} hours')
           OR sent_at < now() - interval '30 days'`,
      [keys],
    );
    if (!all.length || !ops.length) return 0;
    const claimed = new Set(
      (
        await this.pdb.query<{ key: string }>(
          `INSERT INTO platform_wa_alerts (key) SELECT unnest($1::text[])
           ON CONFLICT (key) DO NOTHING RETURNING key`,
          [keys],
        )
      ).map((r) => r.key),
    );
    const news = all.filter((i) => claimed.has(i.key.slice(0, 120)));
    if (!news.length) return 0;
    const text = [
      `🔔 *Aviso do Comandou*`,
      '',
      ...news.map((i) => (i.key.startsWith('tenant:new:') ? i.text : `${ICON[i.level]} ${i.text}`)),
      '',
      '_Responda *menu* para ver as opções._',
    ].join('\n');
    for (const op of ops) await this.sendTo(op, text);
    return news.length;
  }

  /** Resumo do dia, uma vez por dia (trava no banco), entre a hora marcada e duas horas depois. */
  private async summary(hour: number | null, now: Date): Promise<boolean> {
    if (hour == null) return false;
    const b = brasiliaNow(now);
    if (b.hour < hour || b.hour > hour + 1) return false;
    const ops = await this.operators('summary');
    if (!ops.length) return false;
    const [won] = await this.pdb.query<{ ok: boolean }>(
      `UPDATE platform_wa_bot_settings SET last_summary_on = $1::date
        WHERE id AND (last_summary_on IS NULL OR last_summary_on < $1::date) RETURNING true AS ok`,
      [b.day],
    );
    if (!won) return false;
    const text = `${await this.checks.summary('☀️ *Resumo do dia · Comandou*')}\n\n_Responda *menu* para ver as opções._`;
    for (const op of ops) await this.sendTo(op, text);
    return true;
  }
}
