import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { open, seal } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { PlatformDb } from '../platform/platform-db.service';
import { Address, cleanHeader, domainOf, isEmail, normalizeMessageId } from './address';
import {
  Fetcher,
  MailSendError,
  OutgoingAttachment,
  ProviderConfig,
  ProviderName,
  sendThrough,
} from './providers';

/** Contextos das chaves cifradas (um valor cifrado para uma coisa não abre como outra). */
export const MAIL_SECRET = {
  cloudflare: 'mail:cloudflare-token',
  resend: 'mail:resend-key',
  smtp: 'mail:smtp-pass',
  inbound: 'mail:inbound-secret',
  body: (id: string) => `mail:outbox:${id}`,
} as const;

/** Espera entre as tentativas: 1 min, 5 min, 15 min, 1 h, 3 h. Depois disso, falhou. */
export const RETRY_MINUTES = [1, 5, 15, 60, 180];
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
/** Anexos de um e-mail somados (o limite dos provedores é 25 MB com a codificação). */
export const MAX_ATTACHMENTS_BYTES = 15 * 1024 * 1024;
const KEEP_DAYS = 90;

export interface SettingsRow {
  provider: 'none' | ProviderName;
  from_address: string;
  from_name: string;
  reply_to: string;
  cf_account_id: string;
  cf_token_enc: Buffer | null;
  resend_key_enc: Buffer | null;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass_enc: Buffer | null;
  inbound_secret_enc: Buffer | null;
  updated_at: Date;
}

export interface QueueInput {
  /** trial.welcome, customer.password_reset, contract.send, mailbox, calendar.invite, test... */
  kind: string;
  tenantId?: string | null;
  /** Mensagem da caixa que este envio representa. */
  messageId?: string | null;
  /** Sem endereço: o remetente padrão. Só o nome: "Restaurante X" <remetente padrão>. */
  from?: { address?: string; name?: string };
  replyTo?: string;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject: string;
  html?: string;
  text?: string;
  rfcId?: string;
  headers?: Record<string, string>;
  attachments?: OutgoingAttachment[];
  /** Tem senha ou código: o corpo fica cifrado na fila e é apagado ao sair. */
  sensitive?: boolean;
}

interface OutboxRow {
  id: string;
  kind: string;
  message_id: string | null;
  from_address: string;
  from_name: string;
  reply_to: string;
  recipients: { to: Address[]; cc: Address[]; bcc: Address[] };
  subject: string;
  html: string | null;
  body_text: string | null;
  body_enc: Buffer | null;
  sensitive: boolean;
  headers: Record<string, string>;
  rfc_id: string | null;
  attempts: number;
}

export interface DeliveryResult {
  id: string;
  ok: boolean;
  error?: string;
}

const CLAIM_COLS = `id, kind, message_id, from_address::text AS from_address, from_name, reply_to,
  recipients, subject, html, body_text, body_enc, sensitive, headers, rfc_id, attempts`;

/**
 * Envio de e-mail do próprio Comandou. Quem precisa mandar um e-mail (boas-vindas do teste,
 * código de nova senha, contrato, convite) chama `enqueue` dentro da própria transação: o e-mail
 * só existe se a operação valer. A entrega acontece em seguida, fora da transação, e o que falhar
 * por problema passageiro é tentado de novo sozinho. Várias réplicas da API podem rodar a fila ao
 * mesmo tempo: cada e-mail é "pego" por uma só.
 */
@Injectable()
export class MailService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Mail');
  private timers: NodeJS.Timeout[] = [];
  private draining = false;
  /** Trocado nos testes para não chamar a internet. */
  fetcher: Fetcher = (...a) => fetch(...a);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
  ) {}

  onApplicationBootstrap() {
    if (!this.db.enabled || this.env.NODE_ENV === 'test') return;
    const drain = setInterval(() => void this.drain().catch(() => undefined), 30_000);
    const purge = setInterval(() => void this.purge().catch(() => undefined), 6 * 3600_000);
    for (const t of [drain, purge]) t.unref();
    this.timers = [drain, purge];
  }

  onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
  }

  get enabled() {
    return this.db.enabled;
  }

  async settingsRow(c?: PoolClient): Promise<SettingsRow> {
    const sql = `SELECT provider, from_address::text AS from_address, from_name,
        reply_to::text AS reply_to, cf_account_id, cf_token_enc, resend_key_enc, smtp_host,
        smtp_port, smtp_secure, smtp_user, smtp_pass_enc, inbound_secret_enc, updated_at
      FROM mail_settings WHERE id`;
    const rows = c ? (await c.query<SettingsRow>(sql)).rows : await this.db.query<SettingsRow>(sql);
    return rows[0]!;
  }

  /** Dá para enviar? (provedor escolhido, com chave, e remetente definido). */
  async ready(): Promise<boolean> {
    if (!this.db.enabled) return false;
    try {
      const s = await this.settingsRow();
      return !!s.from_address && !!this.providerOf(s);
    } catch {
      return false;
    }
  }

  private reveal(enc: Buffer | null, context: string): string | null {
    if (!enc || !this.env.INTEGRATIONS_KEY) return null;
    try {
      return open(this.env.INTEGRATIONS_KEY, enc, context);
    } catch {
      return null;
    }
  }

  /** Configuração do provedor com a chave aberta, ou null se falta algo. */
  providerOf(s: SettingsRow): ProviderConfig | null {
    if (s.provider === 'cloudflare') {
      const token = this.reveal(s.cf_token_enc, MAIL_SECRET.cloudflare);
      return s.cf_account_id && token
        ? { provider: 'cloudflare', accountId: s.cf_account_id, token }
        : null;
    }
    if (s.provider === 'resend') {
      const apiKey = this.reveal(s.resend_key_enc, MAIL_SECRET.resend);
      return apiKey ? { provider: 'resend', apiKey } : null;
    }
    if (s.provider === 'smtp') {
      if (!s.smtp_host) return null;
      const pass = this.reveal(s.smtp_pass_enc, MAIL_SECRET.smtp) ?? '';
      if (s.smtp_user && !pass) return null;
      return {
        provider: 'smtp',
        host: s.smtp_host,
        port: s.smtp_port,
        secure: s.smtp_secure,
        user: s.smtp_user,
        pass,
      };
    }
    return null;
  }

  inboundSecret(s: SettingsRow): string | null {
    return this.reveal(s.inbound_secret_enc, MAIL_SECRET.inbound);
  }

  /**
   * Põe o e-mail na fila. Com `c`, entra na transação de quem chamou (se ela desfizer, o e-mail
   * não existe). Devolve o id para entregar em seguida com `deliver`.
   */
  async enqueue(c: PoolClient | null, m: QueueInput): Promise<string> {
    const clean = (list: Address[] | undefined) =>
      (list ?? [])
        .filter((a) => isEmail(a.email))
        .map((a) => ({
          email: a.email.toLowerCase(),
          name: cleanHeader(a.name ?? '').slice(0, 120),
        }));
    const recipients = { to: clean(m.to), cc: clean(m.cc), bcc: clean(m.bcc) };
    if (!recipients.to.length && !recipients.cc.length && !recipients.bcc.length)
      throw new UnprocessableEntityException('Informe pelo menos um destinatário válido');
    const size = (m.attachments ?? []).reduce((n, a) => n + a.data.length, 0);
    if (size > MAX_ATTACHMENTS_BYTES)
      throw new UnprocessableEntityException('Os anexos passam de 15 MB');
    const id = randomUUID();
    const sealed =
      m.sensitive && this.env.INTEGRATIONS_KEY
        ? seal(
            this.env.INTEGRATIONS_KEY,
            JSON.stringify({ html: m.html ?? null, text: m.text ?? null }),
            MAIL_SECRET.body(id),
          )
        : null;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.headers ?? {}))
      if (/^[A-Za-z0-9-]{1,100}$/.test(k) && v) headers[k] = cleanHeader(v).slice(0, 2000);
    const run = async (q: PoolClient) => {
      await q.query(
        `INSERT INTO mail_outbox (id, kind, tenant_id, message_id, from_address, from_name, reply_to,
                                  recipients, subject, html, body_text, body_enc, sensitive, headers, rfc_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          id,
          m.kind.slice(0, 60),
          m.tenantId ?? null,
          m.messageId ?? null,
          m.from?.address && isEmail(m.from.address) ? m.from.address.toLowerCase() : '',
          cleanHeader(m.from?.name ?? '').slice(0, 200),
          m.replyTo && isEmail(m.replyTo) ? m.replyTo : '',
          JSON.stringify(recipients),
          cleanHeader(m.subject).slice(0, 998),
          sealed ? null : (m.html ?? null),
          sealed ? null : (m.text ?? null),
          sealed,
          !!m.sensitive,
          JSON.stringify(headers),
          normalizeMessageId(m.rfcId),
        ],
      );
      for (const a of m.attachments ?? [])
        await q.query(
          `INSERT INTO mail_attachments (outbox_id, filename, content_type, content_id, size_bytes, data)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            id,
            cleanHeader(a.filename).slice(0, 255) || 'anexo',
            cleanHeader(a.contentType).slice(0, 255) || 'application/octet-stream',
            a.contentId ?? null,
            a.data.length,
            a.data,
          ],
        );
    };
    if (c) await run(c);
    else await this.db.tx(run);
    return id;
  }

  /** Fila + entrega na hora. Erro passageiro fica na fila e é tentado de novo sozinho. */
  async send(m: QueueInput): Promise<DeliveryResult> {
    return this.deliver(await this.enqueue(null, m));
  }

  /** Entrega agora um e-mail da fila (se outra réplica já pegou, devolve "ok" sem repetir). */
  async deliver(id: string): Promise<DeliveryResult> {
    const rows = await this.db.query<OutboxRow>(
      `UPDATE mail_outbox SET status = 'sending', locked_at = now(), attempts = attempts + 1
        WHERE id = $1 AND status = 'queued' RETURNING ${CLAIM_COLS}`,
      [id],
    );
    if (!rows[0]) {
      const [cur] = await this.db.query<{ status: string; last_error: string | null }>(
        `SELECT status, last_error FROM mail_outbox WHERE id = $1`,
        [id],
      );
      if (!cur) return { id, ok: false, error: 'E-mail não encontrado na fila' };
      return cur.status === 'failed'
        ? { id, ok: false, error: cur.last_error ?? 'Falhou' }
        : { id, ok: true };
    }
    return this.attempt(rows[0]);
  }

  /** Roda a fila: o que está na hora e o que ficou "pego" por uma réplica que caiu. */
  async drain(limit = 10): Promise<number> {
    if (!this.db.enabled || this.draining) return 0;
    this.draining = true;
    try {
      const rows = await this.db.query<OutboxRow>(
        `UPDATE mail_outbox SET status = 'sending', locked_at = now(), attempts = attempts + 1
          WHERE id IN (
            SELECT id FROM mail_outbox
             WHERE (status = 'queued' AND next_attempt_at <= now())
                OR (status = 'sending' AND locked_at < now() - interval '5 minutes')
             ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING ${CLAIM_COLS}`,
        [limit],
      );
      for (const r of rows) await this.attempt(r);
      return rows.length;
    } finally {
      this.draining = false;
    }
  }

  private async attempt(r: OutboxRow): Promise<DeliveryResult> {
    try {
      const s = await this.settingsRow();
      const cfg = this.providerOf(s);
      if (!cfg || !s.from_address)
        throw new MailSendError(
          'O envio de e-mail não está configurado (Super Admin › E-mail)',
          false,
        );
      let html = r.html ?? undefined;
      let text = r.body_text ?? undefined;
      if (r.body_enc) {
        const plain = this.reveal(r.body_enc, MAIL_SECRET.body(r.id));
        if (!plain)
          throw new MailSendError('Não deu para abrir o conteúdo cifrado do e-mail', true);
        const body = JSON.parse(plain) as { html: string | null; text: string | null };
        html = body.html ?? undefined;
        text = body.text ?? undefined;
      }
      const attachments = await this.db.query<{
        filename: string;
        content_type: string;
        content_id: string | null;
        data: Buffer;
      }>(
        `SELECT filename, content_type, content_id, data FROM mail_attachments
          WHERE ${r.message_id ? 'message_id = $1' : 'outbox_id = $1'} ORDER BY created_at, id`,
        [r.message_id ?? r.id],
      );
      const from = r.from_address || s.from_address;
      const rfcId =
        r.rfc_id ?? `<${randomUUID()}@${domainOf(from) || this.env.COMANDOU_BASE_DOMAIN}>`;
      const sent = await sendThrough(
        cfg,
        {
          from: { email: from, name: r.from_name || (r.from_address ? '' : s.from_name) },
          replyTo: r.reply_to || (r.from_address ? '' : s.reply_to) || undefined,
          to: r.recipients.to ?? [],
          cc: r.recipients.cc ?? [],
          bcc: r.recipients.bcc ?? [],
          subject: r.subject,
          html,
          text,
          rfcId,
          headers: r.headers ?? {},
          attachments: attachments.map((a) => ({
            filename: a.filename,
            contentType: a.content_type,
            contentId: a.content_id,
            data: a.data,
          })),
        },
        this.fetcher,
      );
      const finalId = sent.rfcId ?? rfcId;
      await this.db.tx(async (c) => {
        await c.query(
          `UPDATE mail_outbox SET status = 'sent', sent_at = now(), locked_at = NULL, last_error = NULL,
                  provider = $2, provider_id = $3, rfc_id = $4,
                  html = CASE WHEN sensitive THEN NULL ELSE html END,
                  body_text = CASE WHEN sensitive THEN NULL ELSE body_text END,
                  body_enc = NULL
            WHERE id = $1`,
          [r.id, cfg.provider, sent.providerId?.slice(0, 300) ?? null, finalId],
        );
        if (r.message_id)
          await c.query(
            `UPDATE mail_messages SET send_status = 'sent', send_error = NULL, rfc_id = $2,
                    sent_at = now() WHERE id = $1`,
            [r.message_id, finalId],
          );
      });
      return { id: r.id, ok: true };
    } catch (e) {
      const err = e as Error;
      const permanent = e instanceof MailSendError && e.permanent;
      const gaveUp = permanent || r.attempts >= MAX_ATTEMPTS;
      const message = (err.message || 'Erro ao enviar').slice(0, 480);
      const wait = RETRY_MINUTES[Math.min(r.attempts, RETRY_MINUTES.length) - 1] ?? 180;
      await this.db
        .tx(async (c) => {
          await c.query(
            `UPDATE mail_outbox SET status = $2, locked_at = NULL, last_error = $3,
                    next_attempt_at = now() + make_interval(mins => $4::int),
                    -- Desistiu: o que tinha senha ou código não fica guardado.
                    html = CASE WHEN $5::boolean AND sensitive THEN NULL ELSE html END,
                    body_text = CASE WHEN $5::boolean AND sensitive THEN NULL ELSE body_text END,
                    body_enc = CASE WHEN $5::boolean THEN NULL ELSE body_enc END
              WHERE id = $1`,
            [r.id, gaveUp ? 'failed' : 'queued', message, wait, gaveUp],
          );
          if (r.message_id)
            await c.query(
              `UPDATE mail_messages SET send_status = $2, send_error = $3 WHERE id = $1`,
              [r.message_id, gaveUp ? 'failed' : 'queued', message],
            );
        })
        .catch(() => undefined);
      this.logger.warn(
        `e-mail ${r.kind} ${gaveUp ? 'falhou' : 'vai ser tentado de novo'}: ${message}`,
      );
      return { id: r.id, ok: false, error: message };
    }
  }

  /** Apaga da fila o que já saiu (ou falhou) há mais de 90 dias, com os anexos. */
  async purge(): Promise<number> {
    if (!this.db.enabled) return 0;
    const rows = await this.db.query(
      `DELETE FROM mail_outbox
        WHERE status IN ('sent', 'failed', 'cancelled')
          AND created_at < now() - make_interval(days => $1) RETURNING id`,
      [KEEP_DAYS],
    );
    return rows.length;
  }
}
