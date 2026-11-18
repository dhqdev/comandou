import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import { SECRET_CONTEXT as BACKUP_CONTEXT } from '../backup/backup-settings';
import { KEY_CONTEXT as ASAAS_CONTEXT } from '../billing/billing.service';
import { open, seal } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { FOCUS_MASTER_CONTEXT, FocusClient } from '../fiscal/focus.client';
import { MAIL_SECRET } from '../mail/mail.service';
import { PLATFORM_TOKEN_CONTEXT } from '../online-pay/online-pay.service';
import { GITHUB_KEY_CONTEXT } from '../tickets/tickets.service';
import { CLIENT_KEY_CONTEXT, OWNER_KEY_CONTEXT } from './ai-keys';
import { SITE_KEY_CONTEXT } from './site/site-ai.service';
import type { Actor } from './platform.service';
import { PlatformDb, platformAudit } from './platform-db.service';

export const FocusMasterBody = z.object({ token: z.string().trim().min(8).max(300) });
export const FocusMasterTest = z.object({ token: z.string().trim().max(300).optional() });

/**
 * Situação de uma credencial. `configured: null` = não dá para conferir daqui (fica em outro
 * serviço, no GitHub ou no DNS); a tela mostra só o passo a passo.
 */
export interface CredentialStatus {
  id: string;
  configured: boolean | null;
  required: boolean;
  /** Complemento curto (ambiente, modo, conta), nunca o valor. */
  detail?: string;
  /** Os 4 últimos caracteres da chave salva, para saber qual está em uso. */
  last4?: string;
  /** Salva, mas não abre com a INTEGRATIONS_KEY atual (precisa colar de novo). */
  unreadable?: boolean;
}

type Sealed = Buffer | null;

const env2 = (v: string) => (v === 'production' ? 'produção' : 'sandbox');

/**
 * Super Admin › Credenciais: todas as chaves, tokens e senhas que o Comandou usa, num lugar só.
 * Diz se cada uma está configurada; o texto de cada uma (para que serve e como gerar) fica na
 * tela. Nunca devolve um valor.
 */
@Injectable()
export class PlatformCredentialsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly focus: FocusClient,
  ) {}

  /**
   * Situação de uma chave cifrada: salva ou não e os 4 últimos caracteres (abre só aqui dentro,
   * o valor nunca sai). Se não abre com a chave mestra atual, avisa para colar de novo.
   */
  private key(enc: Sealed | undefined, context: string) {
    if (!enc) return { configured: false };
    const k = this.env.INTEGRATIONS_KEY;
    try {
      const v = k ? open(k, enc, context) : '';
      return { configured: true, last4: v.length >= 8 ? v.slice(-4) : undefined };
    } catch {
      return { configured: true, unreadable: true };
    }
  }

  private one<T extends QueryResultRow>(sql: string): Promise<T | undefined> {
    return this.db
      .query<T>(sql)
      .then((r) => r[0])
      .catch(() => undefined);
  }

  async status() {
    const e = this.env;
    const [ai, site, billing, pay, mail, backup, pipeline, focus] = await Promise.all([
      this.one<{ owner: Sealed; clients: Sealed }>(
        `SELECT owner_api_key_enc AS owner, api_key_enc AS clients
           FROM platform_ai_settings WHERE id`,
      ),
      this.one<{ key: Sealed }>(
        `SELECT api_key_enc AS key FROM platform_site_ai_settings WHERE id`,
      ),
      this.one<{ api: Sealed; hook: boolean; registered: boolean; env: string }>(
        `SELECT api_key_enc AS api, webhook_token_enc IS NOT NULL AS hook,
                webhook_id IS NOT NULL AS registered, environment AS env
           FROM platform_billing_settings WHERE id`,
      ),
      this.one<{ token: Sealed; app: boolean; receiver: string | null; env: string }>(
        `SELECT platform_token_enc AS token,
                (client_id IS NOT NULL AND client_secret_enc IS NOT NULL) AS app,
                receiver_account_id AS receiver, environment AS env
           FROM platform_online_pay_settings WHERE id`,
      ),
      this.one<{ key: Sealed }>(`SELECT resend_key_enc AS key FROM mail_settings WHERE id`),
      this.one<{ secret: Sealed; ok: boolean; bucket: string }>(
        `SELECT secret_enc AS secret, bucket,
                (secret_enc IS NOT NULL AND key_id <> '' AND bucket <> '' AND endpoint <> '') AS ok
           FROM platform_backup_settings WHERE id`,
      ),
      this.one<{ token: Sealed; repo: string | null }>(
        `SELECT github_token_enc AS token, github_repo AS repo
           FROM platform_pipeline_settings WHERE id`,
      ),
      this.one<{ last4: string; at: string }>(
        `SELECT last4, updated_at AS at FROM platform_credentials WHERE name = 'focus_master'`,
      ),
    ]);

    const items: CredentialStatus[] = [
      // ---- Servidor: o instalador gera sozinho (Docker secrets)
      { id: 'integrations_key', configured: !!e.INTEGRATIONS_KEY, required: true },
      // A API está respondendo pelo banco e você entrou no painel: estes existem.
      { id: 'database', configured: true, required: true },
      { id: 'platform_admin', configured: true, required: true },
      {
        id: 'whatsapp_gateway',
        configured: !!e.WHATSAPP_GATEWAY_TOKEN,
        required: !!e.WHATSAPP_GATEWAY_URL,
      },
      // A chave das sessões fica só no gateway: daqui não dá para ver.
      { id: 'whatsapp_session', configured: null, required: !!e.WHATSAPP_GATEWAY_URL },
      { id: 'traefik_provider', configured: !!e.TRAEFIK_PROVIDER_TOKEN, required: true },
      { id: 'metrics', configured: !!e.METRICS_TOKEN, required: false },
      { id: 'host_agent', configured: !!e.HOST_AGENT_TOKEN, required: !!e.HOST_AGENT_URL },
      {
        id: 'crowdsec',
        configured: !!e.CROWDSEC_BOUNCER_KEY,
        required: e.CROWDSEC_BOUNCER,
      },
      // ---- Servidor: você coloca no deploy.env
      {
        id: 'ifood',
        configured: !!(e.IFOOD_CLIENT_ID && e.IFOOD_CLIENT_SECRET),
        required: false,
        detail: e.IFOOD_APP_MODE === 'centralized' ? 'modo centralizado' : 'modo distribuído',
      },
      { id: 'update_github', configured: !!e.UPDATE_GITHUB_TOKEN, required: false },
      { id: 'ghcr_agent', configured: null, required: false },
      { id: 'acme_email', configured: null, required: true },
      // ---- Painel (cifradas com a INTEGRATIONS_KEY)
      {
        id: 'focus_master',
        configured: !!focus || !!e.FOCUS_NFE_MASTER_TOKEN,
        required: true,
        last4: focus?.last4 ?? undefined,
        detail: !focus && e.FOCUS_NFE_MASTER_TOKEN ? 'vindo do servidor' : undefined,
      },
      { id: 'openrouter_clients', required: true, ...this.key(ai?.clients, CLIENT_KEY_CONTEXT) },
      { id: 'openrouter_owner', required: false, ...this.key(ai?.owner, OWNER_KEY_CONTEXT) },
      { id: 'openrouter_site', required: false, ...this.key(site?.key, SITE_KEY_CONTEXT) },
      { id: 'resend', required: true, ...this.key(mail?.key, MAIL_SECRET.resend) },
      {
        id: 'asaas',
        required: true,
        ...this.key(billing?.api, ASAAS_CONTEXT),
        detail: billing?.api ? env2(billing.env) : undefined,
      },
      {
        id: 'asaas_webhook',
        configured: !!billing?.hook && !!billing?.registered,
        required: true,
      },
      {
        id: 'pagbank',
        required: false,
        ...this.key(pay?.token, PLATFORM_TOKEN_CONTEXT),
        configured: !!pay?.token && !!pay?.app && !!pay?.receiver,
        detail: pay?.token
          ? [
              env2(pay.env),
              pay.receiver ? `conta ${pay.receiver}` : 'falta a conta',
              !pay.app && 'falta a aplicação',
            ]
              .filter(Boolean)
              .join(' · ')
          : undefined,
      },
      {
        id: 'backblaze',
        required: false,
        ...this.key(backup?.secret, BACKUP_CONTEXT),
        configured: !!backup?.ok,
        detail: backup?.ok ? `bucket ${backup.bucket}` : undefined,
      },
      {
        id: 'github_pipeline',
        required: false,
        ...this.key(pipeline?.token, GITHUB_KEY_CONTEXT),
        detail: pipeline?.token && pipeline.repo ? pipeline.repo : undefined,
      },
      // ---- GitHub (Actions) e DNS: ficam fora do sistema
      { id: 'github_deploy', configured: null, required: false },
      { id: 'dns', configured: null, required: true },
    ];
    return {
      keyConfigured: !!e.INTEGRATIONS_KEY,
      baseDomain: e.COMANDOU_BASE_DOMAIN,
      focus: {
        saved: !!focus,
        fromServer: !focus && !!e.FOCUS_NFE_MASTER_TOKEN,
        last4: focus?.last4 ?? null,
        updatedAt: focus?.at ?? null,
      },
      items,
    };
  }

  /** Salva o token master da Focus NFe (cifrado). Vale na hora, em vez da variável do servidor. */
  async saveFocusMaster(token: string, a: Actor) {
    if (!this.env.INTEGRATIONS_KEY)
      throw new UnprocessableEntityException(
        'Servidor sem INTEGRATIONS_KEY: não é possível guardar o token com segurança',
      );
    const enc = seal(this.env.INTEGRATIONS_KEY, token, FOCUS_MASTER_CONTEXT);
    await this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO platform_credentials (name, value_enc, last4, updated_by)
         VALUES ('focus_master', $1, $2, $3)
         ON CONFLICT (name) DO UPDATE
           SET value_enc = EXCLUDED.value_enc, last4 = EXCLUDED.last4,
               updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [enc, token.slice(-4), a.admin.id],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'credentials.save',
        entity: 'credential',
        entityId: 'focus_master',
        ip: a.ip,
      });
    });
    this.focus.forgetMaster();
    return this.status();
  }

  async removeFocusMaster(a: Actor) {
    await this.db.tx(async (c) => {
      await c.query(`DELETE FROM platform_credentials WHERE name = 'focus_master'`);
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'credentials.remove',
        entity: 'credential',
        entityId: 'focus_master',
        ip: a.ip,
      });
    });
    this.focus.forgetMaster();
    return this.status();
  }

  testFocusMaster(token?: string) {
    return this.focus.testMaster(token);
  }
}
