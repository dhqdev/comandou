import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import { seal } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { FOCUS_MASTER_CONTEXT, FocusClient } from '../fiscal/focus.client';
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
}

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

  private one<T extends QueryResultRow>(sql: string): Promise<T | undefined> {
    return this.db
      .query<T>(sql)
      .then((r) => r[0])
      .catch(() => undefined);
  }

  async status() {
    const e = this.env;
    const [ai, site, billing, pay, mail, backup, pipeline, focus] = await Promise.all([
      this.one<{ owner: boolean; clients: boolean }>(
        `SELECT owner_api_key_enc IS NOT NULL AS owner, api_key_enc IS NOT NULL AS clients
           FROM platform_ai_settings WHERE id`,
      ),
      this.one<{ key: boolean }>(
        `SELECT api_key_enc IS NOT NULL AS key FROM platform_site_ai_settings WHERE id`,
      ),
      this.one<{ api: boolean; hook: boolean; registered: boolean; env: string }>(
        `SELECT api_key_enc IS NOT NULL AS api, webhook_token_enc IS NOT NULL AS hook,
                webhook_id IS NOT NULL AS registered, environment AS env
           FROM platform_billing_settings WHERE id`,
      ),
      this.one<{ token: boolean; app: boolean; receiver: boolean; env: string }>(
        `SELECT platform_token_enc IS NOT NULL AS token,
                (client_id IS NOT NULL AND client_secret_enc IS NOT NULL) AS app,
                receiver_account_id IS NOT NULL AS receiver, environment AS env
           FROM platform_online_pay_settings WHERE id`,
      ),
      this.one<{ key: boolean }>(
        `SELECT resend_key_enc IS NOT NULL AS key FROM mail_settings WHERE id`,
      ),
      this.one<{ ok: boolean }>(
        `SELECT (secret_enc IS NOT NULL AND key_id <> '' AND bucket <> '' AND endpoint <> '') AS ok
           FROM platform_backup_settings WHERE id`,
      ),
      this.one<{ ok: boolean }>(
        `SELECT github_token_enc IS NOT NULL AS ok FROM platform_pipeline_settings WHERE id`,
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
        detail: focus
          ? `termina em ${focus.last4}`
          : e.FOCUS_NFE_MASTER_TOKEN
            ? 'vindo do servidor (FOCUS_NFE_MASTER_TOKEN)'
            : undefined,
      },
      { id: 'openrouter_clients', configured: !!ai?.clients, required: true },
      { id: 'openrouter_owner', configured: !!ai?.owner, required: false },
      { id: 'openrouter_site', configured: !!site?.key, required: false },
      {
        id: 'resend',
        configured: !!mail?.key,
        required: true,
      },
      {
        id: 'asaas',
        configured: !!billing?.api,
        required: true,
        detail: billing ? env2(billing.env) : undefined,
      },
      {
        id: 'asaas_webhook',
        configured: !!billing?.hook && !!billing?.registered,
        required: true,
      },
      {
        id: 'pagbank',
        configured: !!pay?.token && !!pay?.app && !!pay?.receiver,
        required: false,
        detail: pay ? env2(pay.env) : undefined,
      },
      { id: 'backblaze', configured: !!backup?.ok, required: false },
      { id: 'github_pipeline', configured: !!pipeline?.ok, required: false },
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
