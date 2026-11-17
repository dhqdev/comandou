import {
  ConflictException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { seal } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { PlatformDb, platformAudit } from '../platform/platform-db.service';
import type { Actor } from '../platform/platform.service';
import type { MailSettingsInput } from './mail.schemas';
import { MAIL_SECRET, MailService, SettingsRow } from './mail.service';
import { testEmail } from './templates/emails';
import { emailSamples } from './templates/samples';
import { siteUrlOf, tenantUrlOf } from './templates/urls';

/** Super Admin › E-mail: a configuração do Resend, o e-mail de teste e a fila de envios. */
@Injectable()
export class MailAdminService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly mail: MailService,
  ) {}

  private settingsView(s: SettingsRow) {
    return {
      enabled: s.provider === 'resend',
      fromAddress: s.from_address,
      fromName: s.from_name,
      replyTo: s.reply_to,
      resendKeySet: !!s.resend_key_enc,
      /** Envio pronto: Resend ligado, com chave e remetente. */
      ready: !!s.from_address && !!this.mail.providerOf(s),
      /** Sem a INTEGRATIONS_KEY não dá para guardar a chave. */
      canStoreSecrets: !!this.env.INTEGRATIONS_KEY,
      updatedAt: s.updated_at,
    };
  }

  async settings() {
    return this.settingsView(await this.mail.settingsRow());
  }

  async saveSettings(b: MailSettingsInput, a: Actor) {
    const key = this.env.INTEGRATIONS_KEY;
    if (b.resendKey && !key)
      throw new UnprocessableEntityException('Defina a INTEGRATIONS_KEY para guardar a chave');
    if (b.enabled && !b.fromAddress)
      throw new UnprocessableEntityException('Informe o e-mail remetente');
    // Ausente: mantém. Vazio: apaga. Texto: troca.
    const clear = b.resendKey === '';
    const enc = b.resendKey && key ? seal(key, b.resendKey, MAIL_SECRET.resend) : null;
    await this.db.tx(async (c) => {
      // As chaves da Cloudflare, do SMTP e do recebimento (versões antigas) são apagadas.
      await c.query(
        `UPDATE mail_settings
            SET provider = $1, from_address = $2, from_name = $3, reply_to = $4,
                resend_key_enc = CASE WHEN $5::boolean THEN NULL
                                      WHEN $6::bytea IS NOT NULL THEN $6 ELSE resend_key_enc END,
                cf_account_id = '', cf_token_enc = NULL, smtp_host = '', smtp_user = '',
                smtp_pass_enc = NULL, inbound_secret_enc = NULL,
                updated_at = now(), updated_by = $7
          WHERE id`,
        [
          b.enabled ? 'resend' : 'none',
          b.fromAddress,
          b.fromName || 'Comandou',
          b.replyTo,
          clear,
          enc,
          a.admin.id,
        ],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.settings_saved',
        entity: 'mail',
        data: {
          provider: b.enabled ? 'resend' : 'none',
          fromAddress: b.fromAddress,
          keyChanged: b.resendKey !== undefined,
        },
        ip: a.ip,
      });
    });
    return this.settings();
  }

  /** E-mail de teste pelo Resend: sai na hora e devolve o erro do Resend, se houver. */
  async testSend(to: string, a: Actor) {
    if (!(await this.mail.ready()))
      throw new UnprocessableEntityException(
        'Salve a chave do Resend e o remetente antes de testar',
      );
    const r = await this.mail.send({
      kind: 'test',
      to: [{ email: to }],
      ...testEmail(siteUrlOf(this.env)),
    });
    await this.db.tx((c) =>
      platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.test_sent',
        entity: 'mail',
        data: { to, ok: r.ok },
        ip: a.ip,
      }),
    );
    if (!r.ok) throw new UnprocessableEntityException(r.error ?? 'O envio falhou');
    return { ok: true, to };
  }

  private samples() {
    return emailSamples(siteUrlOf(this.env), (slug) => tenantUrlOf(this.env, slug));
  }

  /** Aba Modelos: todos os e-mails do sistema com dados de exemplo, e se os avisos estão ligados. */
  async templates() {
    const [m] = await this.db.query<{ enabled: boolean }>(
      `SELECT lifecycle_enabled AS enabled FROM mail_settings WHERE id`,
    );
    return {
      lifecycleEnabled: !!m?.enabled,
      ready: await this.mail.ready(),
      items: this.samples().map((x) => ({
        id: x.id,
        label: x.label,
        when: x.when,
        subject: x.mail.subject,
        html: x.mail.html,
      })),
    };
  }

  /** Liga ou desliga os avisos automáticos de teste grátis e cobrança. */
  async setLifecycle(enabled: boolean, a: Actor) {
    await this.db.tx(async (c) => {
      await c.query(`UPDATE mail_settings SET lifecycle_enabled = $1 WHERE id`, [enabled]);
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.lifecycle_set',
        entity: 'mail',
        data: { enabled },
        ip: a.ip,
      });
    });
    return this.templates();
  }

  /** Manda um modelo com os dados de exemplo para conferir na caixa de entrada. */
  async sendSample(id: string, to: string, a: Actor) {
    const s = this.samples().find((x) => x.id === id);
    if (!s) throw new UnprocessableEntityException('Modelo não encontrado');
    if (!(await this.mail.ready()))
      throw new UnprocessableEntityException(
        'Salve a chave do Resend e o remetente antes de testar',
      );
    const r = await this.mail.send({
      kind: 'test',
      from: s.fromName ? { name: s.fromName } : undefined,
      to: [{ email: to }],
      ...s.mail,
      subject: `[Teste] ${s.mail.subject}`,
    });
    await this.db.tx((c) =>
      platformAudit(c, {
        adminId: a.admin.id,
        action: 'mail.sample_sent',
        entity: 'mail',
        data: { to, template: id, ok: r.ok },
        ip: a.ip,
      }),
    );
    if (!r.ok) throw new UnprocessableEntityException(r.error ?? 'O envio falhou');
    return { ok: true, to };
  }

  /** Fila de saída: o que o sistema mandou (ou tentou), sem o conteúdo. */
  async outbox(status?: string) {
    const ok = ['queued', 'sending', 'sent', 'failed', 'cancelled'].includes(status ?? '');
    const rows = await this.db.query(
      `SELECT o.id, o.kind, o.subject, o.recipients->'to' AS "to", o.status, o.attempts,
              o.last_error AS "lastError", o.provider, o.created_at AS "createdAt",
              o.sent_at AS "sentAt", o.next_attempt_at AS "nextAttemptAt", t.name AS tenant,
              COALESCE(NULLIF(o.from_address::text, ''), '') AS "fromAddress"
         FROM mail_outbox o LEFT JOIN tenants t ON t.id = o.tenant_id
        ${ok ? 'WHERE o.status = $1' : ''}
        ORDER BY o.created_at DESC LIMIT 200`,
      ok ? [status] : [],
    );
    const [c] = await this.db.query<{ queued: number; failed: number; sent_day: number }>(
      `SELECT count(*) FILTER (WHERE status IN ('queued', 'sending'))::int AS queued,
              count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '7 days')::int AS failed,
              count(*) FILTER (WHERE status = 'sent' AND sent_at > now() - interval '1 day')::int AS sent_day
         FROM mail_outbox`,
    );
    return { rows, queued: c?.queued ?? 0, failed: c?.failed ?? 0, sentDay: c?.sent_day ?? 0 };
  }

  /** Tenta de novo um envio que falhou. E-mail com senha ou código já foi apagado e não volta. */
  async retryOutbox(id: string) {
    const [o] = await this.db.query<{ id: string }>(
      `UPDATE mail_outbox SET status = 'queued', attempts = 0, next_attempt_at = now(), last_error = NULL
        WHERE id = $1 AND status = 'failed'
          AND (html IS NOT NULL OR body_text IS NOT NULL OR body_enc IS NOT NULL)
        RETURNING id`,
      [id],
    );
    if (!o)
      throw new ConflictException(
        'Não dá para reenviar: o envio não falhou ou o conteúdo (com senha ou código) já foi apagado',
      );
    const r = await this.mail.deliver(o.id);
    return { id, sent: r.ok, queued: !!r.queued, error: r.ok ? null : (r.error ?? null) };
  }

  async cancelOutbox(id: string) {
    const rows = await this.db.query(
      `UPDATE mail_outbox SET status = 'cancelled', body_enc = NULL,
              html = CASE WHEN sensitive THEN NULL ELSE html END,
              body_text = CASE WHEN sensitive THEN NULL ELSE body_text END
        WHERE id = $1 AND status = 'queued' RETURNING id`,
      [id],
    );
    if (!rows.length) throw new ConflictException('Este envio não está na fila');
    return { ok: true };
  }
}
