import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { open, seal } from '../common/secret-box';
import { one, q } from '../common/sql';
import { ENV, Env } from '../config/env';
import { DatabaseService, Tx } from '../database/database.service';
import { QueueService, TenantJob } from '../queue/queue.service';
import { GatewayClient } from './gateway.client';
import { WhatsAppClient, WhatsAppUnavailableError } from './whatsapp.client';
import { PlanService } from '../plans/plan.service';

export type MessageEvent = 'order.ready' | 'order.dispatched';
export type MessagingProvider = 'baileys' | 'meta_cloud';

export interface MessagingSettingsInput {
  provider?: MessagingProvider;
  enabled?: boolean;
  phoneNumberId?: string | null;
  /** string grava um token novo; null apaga; ausente mantém. */
  token?: string | null;
  language?: string;
  templateReady?: string | null;
  templateDispatched?: string | null;
  textReady?: string;
  textDispatched?: string;
  notifyReady?: boolean;
  notifyDispatched?: boolean;
}

interface SettingsRow {
  provider: MessagingProvider;
  enabled: boolean;
  phone_number_id: string | null;
  token_enc: Buffer | null;
  token_last4: string | null;
  language: string;
  template_ready: string | null;
  template_dispatched: string | null;
  text_ready: string;
  text_dispatched: string;
  notify_ready: boolean;
  notify_dispatched: boolean;
  updated_at: Date | null;
}

const SEND_JOB = 'message.send';
const DEFAULT_READY =
  'Olá, {cliente}! Seu pedido #{pedido} no {restaurante} está pronto para retirada.';
const DEFAULT_DISPATCHED =
  'Olá, {cliente}! Seu pedido #{pedido} do {restaurante} saiu para entrega.';
const SETTINGS_COLS = `provider, enabled, phone_number_id, token_enc, token_last4, language, template_ready,
  template_dispatched, text_ready, text_dispatched, notify_ready, notify_dispatched, updated_at`;
const MSG_SELECT = `
  SELECT m.id, m.order_id AS "orderId", o.number AS "orderNumber", m.event, m.provider, m.to_phone AS "toPhone",
         m.template, m.body, m.status, m.attempts, m.last_error AS "lastError", m.created_at AS "createdAt",
         m.sent_at AS "sentAt"
    FROM message_outbox m LEFT JOIN orders o ON o.id = m.order_id`;

/**
 * Telefone brasileiro em formato internacional só com dígitos (ex.: 5511987654321).
 * Aceita DDD + número (10 ou 11 dígitos) e acrescenta o 55. Devolve null se não der para usar.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^55[1-9][0-9]{9,10}$/.test(d)) return null;
  return d;
}

/** Troca {cliente}, {pedido} e {restaurante} no texto do aviso. */
export function renderText(
  text: string,
  v: { cliente: string; pedido: string; restaurante: string },
): string {
  return text.replace(/\{(cliente|pedido|restaurante)\}/g, (_, k: keyof typeof v) => v[k]);
}

/**
 * Avisos ao cliente pelo WhatsApp. Provedor padrão: Baileys (QR Code), num serviço separado;
 * alternativa: API oficial da Meta.
 * O aviso é gravado na caixa de saída NA MESMA transação da mudança do pedido; a fila só
 * leva {tenantId, messageId}. O consumidor relê a mensagem e a configuração dentro do tenant
 * e, se a transação original não tiver sido gravada, não envia nada.
 */
@Injectable()
export class MessagingService implements OnModuleInit {
  private readonly logger = new Logger('Messaging');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly queue: QueueService,
    private readonly whatsapp: WhatsAppClient,
    private readonly gateway: GatewayClient,
    private readonly audit: AuditService,
    private readonly plans: PlanService,
  ) {}

  onModuleInit() {
    this.queue.register(SEND_JOB, (d, attempt, final) => this.runSend(d, attempt, final));
  }

  private settingsRow(tx: Tx) {
    return one<SettingsRow>(tx, `SELECT ${SETTINGS_COLS} FROM tenant_messaging_settings`);
  }

  private present(s: SettingsRow | undefined) {
    return {
      provider: s?.provider ?? 'baileys',
      enabled: s?.enabled ?? false,
      phoneNumberId: s?.phone_number_id ?? null,
      hasToken: !!s?.token_enc,
      tokenLast4: s?.token_last4 ?? null,
      language: s?.language ?? 'pt_BR',
      templateReady: s?.template_ready ?? null,
      templateDispatched: s?.template_dispatched ?? null,
      textReady: s?.text_ready ?? DEFAULT_READY,
      textDispatched: s?.text_dispatched ?? DEFAULT_DISPATCHED,
      notifyReady: s?.notify_ready ?? true,
      notifyDispatched: s?.notify_dispatched ?? true,
      updatedAt: s?.updated_at ?? null,
      keyConfigured: !!this.env.INTEGRATIONS_KEY,
      gatewayConfigured: this.gateway.configured,
    };
  }

  getSettings(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => this.present(await this.settingsRow(tx)));
  }

  saveSettings(ctx: Ctx, b: MessagingSettingsInput) {
    return this.db.withTenant(ctx, async (tx) => {
      await tx.$client.query(
        `INSERT INTO tenant_messaging_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
        [ctx.tenantId],
      );
      const cur = (await one<SettingsRow>(
        tx,
        `SELECT ${SETTINGS_COLS} FROM tenant_messaging_settings FOR UPDATE`,
      ))!;
      let tokenEnc = cur.token_enc;
      let last4 = cur.token_last4;
      if (b.token === null) {
        tokenEnc = null;
        last4 = null;
      } else if (b.token !== undefined) {
        if (!this.env.INTEGRATIONS_KEY)
          throw new UnprocessableEntityException(
            'Servidor sem INTEGRATIONS_KEY: não é possível guardar o token com segurança',
          );
        tokenEnc = seal(this.env.INTEGRATIONS_KEY, b.token, `whatsapp:${ctx.tenantId}`);
        last4 = b.token.slice(-4);
      }
      const pick = <K extends keyof MessagingSettingsInput, V>(k: K, curV: V) =>
        (b[k] !== undefined ? b[k] : curV) as V;
      const next = {
        provider: pick('provider', cur.provider),
        enabled: pick('enabled', cur.enabled),
        phoneNumberId: pick('phoneNumberId', cur.phone_number_id),
        language: pick('language', cur.language),
        templateReady: pick('templateReady', cur.template_ready),
        templateDispatched: pick('templateDispatched', cur.template_dispatched),
        textReady: pick('textReady', cur.text_ready),
        textDispatched: pick('textDispatched', cur.text_dispatched),
        notifyReady: pick('notifyReady', cur.notify_ready),
        notifyDispatched: pick('notifyDispatched', cur.notify_dispatched),
      };
      if (next.enabled && !cur.enabled) await this.plans.assertFeature(tx, 'whatsapp');
      if (next.enabled && next.provider === 'meta_cloud' && (!next.phoneNumberId || !tokenEnc))
        throw new UnprocessableEntityException(
          'Para ativar a API oficial, informe o ID do número e o token de acesso',
        );
      await tx.$client.query(
        `UPDATE tenant_messaging_settings
            SET provider=$1, enabled=$2, phone_number_id=$3, token_enc=$4, token_last4=$5, language=$6,
                template_ready=$7, template_dispatched=$8, text_ready=$9, text_dispatched=$10,
                notify_ready=$11, notify_dispatched=$12, updated_by=$13, updated_at=now()`,
        [
          next.provider,
          next.enabled,
          next.phoneNumberId,
          tokenEnc,
          last4,
          next.language,
          next.templateReady,
          next.templateDispatched,
          next.textReady,
          next.textDispatched,
          next.notifyReady,
          next.notifyDispatched,
          ctx.userId,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'messaging.settings_updated',
        entity: 'tenant_messaging_settings',
        entityId: ctx.tenantId,
        data: { ...next, tokenChanged: b.token !== undefined },
        ip: ctx.ip,
      });
      return this.present(await this.settingsRow(tx));
    });
  }

  // ------------------------------------------------------------- conexão Baileys (QR Code)
  session(ctx: Ctx) {
    return this.gateway.session(ctx.tenantId).catch((e: Error) => {
      throw new ConflictException(e.message);
    });
  }

  async connect(ctx: Ctx) {
    const r = await this.gateway.start(ctx.tenantId).catch((e: Error) => {
      throw new ConflictException(e.message);
    });
    await this.db.withTenant(ctx, (tx) =>
      this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'messaging.session_started',
        entity: 'tenant_messaging_settings',
        entityId: ctx.tenantId,
        ip: ctx.ip,
      }),
    );
    return r;
  }

  async disconnect(ctx: Ctx) {
    const r = await this.gateway.logout(ctx.tenantId).catch((e: Error) => {
      throw new ConflictException(e.message);
    });
    await this.db.withTenant(ctx, (tx) =>
      this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'messaging.session_logged_out',
        entity: 'tenant_messaging_settings',
        entityId: ctx.tenantId,
        ip: ctx.ip,
      }),
    );
    return r;
  }

  list(ctx: Ctx, limit: number) {
    return this.db.withTenant(ctx, (tx) =>
      q(tx, `${MSG_SELECT} ORDER BY m.created_at DESC LIMIT $1`, [limit]),
    );
  }

  /**
   * Grava o aviso de um pedido (pronto / saiu para entrega) dentro da transação da mudança de
   * status e o coloca na fila. Sem WhatsApp ativo, aviso desligado, modelo ou telefone válido,
   * não faz nada. Nunca impede a operação do pedido.
   */
  async stage(tx: Tx, tenantId: string, orderId: string, event: MessageEvent) {
    const s = await this.settingsRow(tx);
    if (!s?.enabled) return;
    // Plano sem WhatsApp: o aviso não sai, mas o pedido segue normalmente.
    if (!(await this.plans.hasFeature(tx, 'whatsapp'))) return;
    const on = event === 'order.ready' ? s.notify_ready : s.notify_dispatched;
    if (!on) return;
    const template = event === 'order.ready' ? s.template_ready : s.template_dispatched;
    if (s.provider === 'meta_cloud' && !template) return;
    const o = await one<{
      number: number;
      customer_name: string | null;
      customer_phone: string | null;
      name: string;
    }>(
      tx,
      `SELECT o.number, o.customer_name, o.customer_phone, t.name
         FROM orders o JOIN tenants t ON t.id = o.tenant_id WHERE o.id = $1`,
      [orderId],
    );
    const phone = normalizePhone(o?.customer_phone);
    if (!o || !phone) return;
    const vars = {
      cliente: o.customer_name?.trim() || 'cliente',
      pedido: String(o.number),
      restaurante: o.name,
    };
    // Meta: parâmetros do modelo, nesta ordem: {{1}} cliente, {{2}} pedido, {{3}} restaurante.
    // Baileys: o texto do restaurante com as variáveis trocadas.
    const meta = s.provider === 'meta_cloud';
    const body = meta
      ? null
      : renderText(event === 'order.ready' ? s.text_ready : s.text_dispatched, vars).slice(0, 4000);
    const m = await one<{ id: string }>(
      tx,
      `INSERT INTO message_outbox (tenant_id, order_id, event, provider, to_phone, template, language, params, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, order_id, event) WHERE order_id IS NOT NULL DO NOTHING RETURNING id`,
      [
        tenantId,
        orderId,
        event,
        s.provider,
        phone,
        meta ? template : null,
        meta ? s.language : null,
        JSON.stringify(meta ? [vars.cliente, vars.pedido, vars.restaurante] : []),
        body,
      ],
    );
    if (m) await this.enqueue(tenantId, m.id);
  }

  /** Mensagem de teste. Meta: modelo "hello_world" (criado em toda conta nova). */
  async sendTest(ctx: Ctx, phoneRaw: string) {
    const phone = normalizePhone(phoneRaw);
    if (!phone) throw new UnprocessableEntityException('Telefone inválido: use DDD + número');
    const m = await this.db.withTenant(ctx, async (tx) => {
      const s = await this.settingsRow(tx);
      if (!s?.enabled) throw new ConflictException('Ative o WhatsApp antes de testar');
      await this.plans.assertFeature(tx, 'whatsapp');
      const meta = s.provider === 'meta_cloud';
      return one<{ id: string }>(
        tx,
        `INSERT INTO message_outbox (tenant_id, event, provider, to_phone, template, language, body, created_by)
         VALUES ($1,'test',$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          ctx.tenantId,
          s.provider,
          phone,
          meta ? 'hello_world' : null,
          meta ? 'en_US' : null,
          meta ? null : 'Mensagem de teste do Comandou: o WhatsApp do restaurante está conectado.',
          ctx.userId,
        ],
      );
    });
    await this.enqueue(ctx.tenantId, m!.id);
    return this.db.withTenant(ctx, (tx) => one(tx, `${MSG_SELECT} WHERE m.id = $1`, [m!.id]));
  }

  /** Reenvia uma mensagem que falhou. */
  async retry(ctx: Ctx, id: string) {
    const r = await this.db.withTenant(ctx, async (tx) => {
      const m = await one<{ status: string }>(
        tx,
        `SELECT status FROM message_outbox WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!m) throw new NotFoundException('Mensagem não encontrada');
      if (m.status === 'sent') throw new ConflictException('Mensagem já enviada');
      await tx.$client.query(
        `UPDATE message_outbox SET status = 'queued', last_error = NULL WHERE id = $1`,
        [id],
      );
      return one(tx, `${MSG_SELECT} WHERE m.id = $1`, [id]);
    });
    await this.enqueue(ctx.tenantId, id, `-${Date.now()}`);
    return r;
  }

  private async enqueue(tenantId: string, messageId: string, suffix = '') {
    try {
      await this.queue.add(
        SEND_JOB,
        { tenantId, messageId },
        // O atraso dá tempo de a transação que gravou o aviso terminar antes do consumidor ler.
        { jobId: `${SEND_JOB}-${messageId}${suffix}`, attempts: 4, delayMs: 1000 },
      );
    } catch (err) {
      this.logger.error(`falha ao enfileirar ${messageId}: ${(err as Error).message}`);
    }
  }

  private async update(tenantId: string, id: string, fields: Record<string, unknown>) {
    const cols = Object.keys(fields);
    await this.db.withTenant({ tenantId }, (tx) =>
      tx.$client.query(
        `UPDATE message_outbox SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...cols.map((c) => fields[c])],
      ),
    );
  }

  /** Consumidor de "message.send": revalida tudo no banco do tenant e envia. */
  async runSend(job: TenantJob, _attempt: number, final: boolean) {
    const id = String(job.messageId ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('trabalho sem messageId');
    const { m, s } = await this.db.withTenant({ tenantId: job.tenantId }, async (tx) => ({
      m: await one<{
        status: string;
        attempts: number;
        provider: MessagingProvider;
        to_phone: string;
        template: string | null;
        language: string | null;
        params: string[];
        body: string | null;
      }>(
        tx,
        `SELECT status, attempts, provider, to_phone, template, language, params, body
           FROM message_outbox WHERE id = $1`,
        [id],
      ),
      s: await this.settingsRow(tx),
    }));
    if (!m) {
      // A transação que criou o aviso pode ainda não ter terminado (ou foi desfeita).
      if (!final) throw new Error('mensagem ainda não gravada');
      return;
    }
    if (m.status !== 'queued') return;
    const fail = (last_error: string) =>
      this.update(job.tenantId, id, { status: 'failed', last_error: last_error.slice(0, 500) });
    if (!s?.enabled) return fail('WhatsApp desativado');

    let send: () => Promise<{ ok: boolean; messageId?: string; error?: string }>;
    if (m.provider === 'baileys') {
      if (!this.gateway.configured) return fail('Serviço de WhatsApp não configurado no servidor');
      send = () => this.gateway.send(job.tenantId, m.to_phone, m.body ?? '');
    } else {
      let token: string | null = null;
      if (s.token_enc && this.env.INTEGRATIONS_KEY) {
        try {
          token = open(this.env.INTEGRATIONS_KEY, s.token_enc, `whatsapp:${job.tenantId}`);
        } catch {
          token = null;
        }
      }
      if (!s.phone_number_id || !token) return fail('Token da API oficial indisponível');
      send = () =>
        this.whatsapp.sendTemplate({
          phoneNumberId: s.phone_number_id!,
          token: token!,
          to: m.to_phone,
          template: m.template ?? '',
          language: m.language ?? 'pt_BR',
          params: m.params ?? [],
        });
    }
    await this.update(job.tenantId, id, { attempts: m.attempts + 1 });
    try {
      const r = await send();
      if (r.ok)
        await this.update(job.tenantId, id, {
          status: 'sent',
          provider_message_id: r.messageId ?? null,
          sent_at: new Date(),
          last_error: null,
        });
      else await fail(r.error ?? 'erro');
    } catch (err) {
      if (!(err instanceof WhatsAppUnavailableError)) throw err;
      if (!final) throw err;
      await fail(err.message);
    }
  }
}
