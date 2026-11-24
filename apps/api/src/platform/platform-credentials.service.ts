import { Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import { SECRET_CONTEXT as BACKUP_CONTEXT } from '../backup/backup-settings';
import { BillingService, KEY_CONTEXT as ASAAS_CONTEXT } from '../billing/billing.service';
import { open, seal } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { FOCUS_MASTER_CONTEXT, FocusClient } from '../fiscal/focus.client';
import { MAIL_SECRET, MailService } from '../mail/mail.service';
import { OnlinePayService, PLATFORM_TOKEN_CONTEXT } from '../online-pay/online-pay.service';
import { GITHUB_KEY_CONTEXT, TicketsService } from '../tickets/tickets.service';
import { KNOWN_CHANNELS } from '@comandou/shared';
import {
  ChannelCredentials,
  type ChannelCredentialInput,
} from '../integrations/channels/channel-credentials.service';
import { ADMIN_KEY_CONTEXT, CLIENT_KEY_CONTEXT, OWNER_KEY_CONTEXT } from './ai-keys';
import type { Actor } from './platform.service';
import { PlatformAiService } from './platform-ai.service';
import { PlatformBackupService } from './platform-backup.service';
import { PlatformDb, platformAudit } from './platform-db.service';
import { ReleaseFeed } from './server-agent.service';

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

/**
 * Resultado de "Conferir todas": a chave salva foi usada agora no fornecedor. `ok: null` = não
 * dá para testar daqui sem efeito colateral (o texto diz como saber).
 */
export interface CredentialCheck {
  id: string;
  ok: boolean | null;
  detail: string;
  ms: number;
}

/** Cada conferência desiste depois disto (o fornecedor fora do ar não trava a tela). */
const CHECK_TIMEOUT_MS = 25_000;

type Sealed = Buffer | null;

const env2 = (v: string) => (v === 'production' ? 'produção' : 'sandbox');

/**
 * Super Admin › Credenciais: todas as chaves, tokens e senhas que o Comandou usa, num lugar só.
 * Diz se cada uma está configurada; o texto de cada uma (para que serve e como gerar) fica na
 * tela. Nunca devolve um valor.
 */
@Injectable()
export class PlatformCredentialsService {
  private readonly logger = new Logger('Credenciais');
  /** Separado para os testes trocarem a internet por uma função. */
  fetcher: typeof fetch = (...a) => fetch(...a);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly focus: FocusClient,
    private readonly channels: ChannelCredentials,
    private readonly ai: PlatformAiService,
    private readonly backup: PlatformBackupService,
    private readonly releases: ReleaseFeed,
    private readonly mail: MailService,
    private readonly billing: BillingService,
    private readonly moduleRef: ModuleRef,
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
    const channels = await this.channels.status(KNOWN_CHANNELS);
    // Outros aplicativos Open Delivery cadastrados aqui (`od-<nome>`): nome, servidor e final.
    const customOd = await this.channels.customOd();
    const [ai, billing, pay, mail, backup, pipeline, focus] = await Promise.all([
      this.one<{ owner: Sealed; clients: Sealed; admin: Sealed }>(
        `SELECT owner_api_key_enc AS owner, api_key_enc AS clients, admin_api_key_enc AS admin
           FROM platform_ai_settings WHERE id`,
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
      // Aplicativos de delivery (o iFood ainda aceita o .env do servidor como reserva).
      ...KNOWN_CHANNELS.map((c) => {
        const st = channels[c]!;
        return {
          id: `channel_${c.replace(/-/g, '_')}`,
          configured: st.configured,
          required: false,
          last4: st.last4,
          detail:
            [
              st.mode === 'centralized' && 'modo centralizado',
              st.mode === 'distributed' && 'modo distribuído',
              st.source === 'env' && 'vindo do servidor',
            ]
              .filter(Boolean)
              .join(' · ') || undefined,
        };
      }),
      {
        id: 'channel_od_apps',
        configured: customOd.length > 0,
        required: false,
        detail: customOd.length ? customOd.map((c) => c.name).join(' · ') : undefined,
      },
      { id: 'openrouter_clients', required: true, ...this.key(ai?.clients, CLIENT_KEY_CONTEXT) },
      { id: 'openrouter_owner', required: false, ...this.key(ai?.owner, OWNER_KEY_CONTEXT) },
      { id: 'openrouter_admin', required: false, ...this.key(ai?.admin, ADMIN_KEY_CONTEXT) },
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
      channels,
      customOd,
      items,
    };
  }

  /**
   * Conferir todas: usa cada chave salva no próprio fornecedor, sem gastar e sem mandar nada a
   * ninguém (lê a conta, a chave ou o saldo; o Backblaze grava e apaga um arquivo de teste).
   * Só as que estão salvas e abrem com a chave mestra; nunca devolve um valor.
   */
  async check(a: Actor): Promise<{ checkedAt: string; results: CredentialCheck[] }> {
    const st = await this.status();
    const saved = new Set(
      st.items.filter((i) => i.configured && !i.unreadable).map((i) => i.id),
    );
    const run = async (
      id: string,
      fn: () => Promise<{ ok: boolean | null; detail: string }>,
    ): Promise<CredentialCheck | null> => {
      if (!saved.has(id)) return null;
      const t0 = Date.now();
      let timer: NodeJS.Timeout | undefined;
      try {
        const r = await Promise.race([
          fn(),
          new Promise<never>((_, rej) => {
            timer = setTimeout(
              () => rej(new Error(`sem resposta em ${CHECK_TIMEOUT_MS / 1000} s`)),
              CHECK_TIMEOUT_MS,
            );
          }),
        ]);
        return { id, ...r, ms: Date.now() - t0 };
      } catch (e) {
        return { id, ok: false, detail: (e as Error).message, ms: Date.now() - t0 };
      } finally {
        clearTimeout(timer);
      }
    };
    const results = (
      await Promise.all([
        run('focus_master', async () => {
          const r = await this.focus.testMaster();
          return r.ok
            ? {
                ok: true,
                detail:
                  r.companies == null
                    ? 'token aceito pela Focus'
                    : `token aceito · ${r.companies} empresa(s) na conta`,
              }
            : { ok: false, detail: r.error ?? 'a Focus recusou o token' };
        }),
        run('openrouter_clients', () => this.ai.checkKey('clients')),
        run('openrouter_owner', () => this.ai.checkKey('owner')),
        run('openrouter_admin', () => this.ai.checkKey('admin')),
        run('resend', () => this.checkResend()),
        run('asaas', async () => {
          const r = await this.billing.test(a);
          return r.ok
            ? {
                ok: true,
                detail: [r.accountName && `conta ${r.accountName}`, st.items.find((i) => i.id === 'asaas')?.detail]
                  .filter(Boolean)
                  .join(' · ') || 'chave aceita pelo Asaas',
              }
            : { ok: false, detail: r.error ?? 'o Asaas recusou a chave' };
        }),
        run('asaas_webhook', async () => ({
          ok: null,
          detail: 'O Asaas avisa aqui a cada pagamento; confira os últimos avisos em Cobrança',
        })),
        run('pagbank', () => this.checkPagBank()),
        run('backblaze', async () => {
          const r = await this.backup.testSaved();
          const bad = r.steps.find((x) => !x.ok);
          return r.ok
            ? {
                ok: true,
                detail: r.canDelete
                  ? 'gravou, leu e apagou um arquivo de teste no bucket'
                  : 'grava e lê, mas não apaga (a retenção não limpa backups velhos)',
              }
            : { ok: false, detail: bad ? `${bad.step}: ${bad.detail ?? 'falhou'}` : 'falhou' };
        }),
        run('github_pipeline', async () => {
          const tickets = this.moduleRef.get(TicketsService, { strict: false });
          const r = await tickets.testGithub({});
          const bad = r.checks.filter((x) => !x.ok);
          return r.ok
            ? { ok: true, detail: r.checks[0]?.label ?? 'token aceito pelo GitHub' }
            : {
                ok: false,
                detail: bad.map((x) => [x.label, x.detail].filter(Boolean).join(': ')).join(' · '),
              };
        }),
        run('update_github', async () => {
          const r = await this.releases.latest();
          return r.error || !r.latest
            ? { ok: false, detail: r.error ?? 'não achei a última versão' }
            : { ok: true, detail: `lê as versões publicadas (última: ${r.latest.version})` };
        }),
      ])
    ).filter((r): r is CredentialCheck => !!r);
    await this.db.tx((c) =>
      platformAudit(c, {
        adminId: a.admin.id,
        action: 'credentials.checked',
        entity: 'credential',
        data: {
          ok: results.filter((r) => r.ok === true).map((r) => r.id),
          failed: results.filter((r) => r.ok === false).map((r) => r.id),
        },
        ip: a.ip,
      }),
    );
    return { checkedAt: new Date().toISOString(), results };
  }

  /**
   * Resend: lê os domínios da conta. Chave "só envio" (a recomendada) não pode ler domínios e o
   * Resend responde 401 restricted_api_key: a chave vale, só não dá para conferir o domínio.
   */
  private async checkResend(): Promise<{ ok: boolean | null; detail: string }> {
    const s = await this.mail.settingsRow();
    const cfg = this.mail.providerOf(s);
    if (!cfg) return { ok: false, detail: 'A chave salva não abre: cole de novo' };
    const res = await this.fetcher('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'User-Agent': 'Comandou' },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as {
      name?: string;
      message?: string;
      data?: { name?: string; status?: string }[];
    } | null;
    if (res.status === 401 && body?.name === 'restricted_api_key')
      return {
        ok: true,
        detail: 'chave aceita (só envio: o domínio do remetente não dá para conferir com ela)',
      };
    if (!res.ok)
      return {
        ok: false,
        detail: `O Resend recusou a chave (HTTP ${res.status}${body?.message ? `: ${body.message}` : ''})`,
      };
    const domain = s.from_address?.split('@')[1]?.toLowerCase();
    if (!domain) return { ok: true, detail: 'chave aceita; falta o remetente na tela E-mail' };
    const d = (body?.data ?? []).find((x) => x.name?.toLowerCase() === domain);
    if (!d)
      return {
        ok: false,
        detail: `Chave aceita, mas o domínio ${domain} do remetente não está cadastrado no Resend`,
      };
    return d.status === 'verified'
      ? { ok: true, detail: `chave aceita · domínio ${domain} verificado` }
      : {
          ok: false,
          detail: `Chave aceita, mas o domínio ${domain} está "${d.status}" no Resend: confira o DNS`,
        };
  }

  /** PagBank: pede a chave pública da conta com o token da plataforma (não cobra nada). */
  private async checkPagBank(): Promise<{ ok: boolean | null; detail: string }> {
    const pay = this.moduleRef.get(OnlinePayService, { strict: false });
    const cfg = await pay.platformCfg();
    if (!cfg?.platformToken) return { ok: false, detail: 'O token salvo não abre: cole de novo' };
    await pay.client(cfg.environment).publicKey(cfg.platformToken);
    return {
      ok: true,
      detail: `token aceito (${env2(cfg.environment)})${cfg.clientSecret ? '' : ' · falta a aplicação do Connect'}`,
    };
  }

  /** Credencial do aplicativo do Comandou num canal de delivery (cifrada). Vale na hora. */
  async saveChannel(channel: string, body: ChannelCredentialInput, a: Actor) {
    await this.channels.save(channel, body, { adminId: a.admin.id, ip: a.ip });
    return this.status();
  }

  async removeChannel(channel: string, a: Actor) {
    await this.channels.remove(channel, { adminId: a.admin.id, ip: a.ip });
    return this.status();
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
