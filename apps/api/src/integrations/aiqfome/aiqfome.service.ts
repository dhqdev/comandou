import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../../audit/audit.service';
import { one, q } from '../../common/sql';
import { open, seal } from '../../common/secret-box';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { PlatformDb } from '../../platform/platform-db.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { ChannelHttpError, ChannelRegistry } from '../channels/channel-adapter';
import { ChannelCredentials } from '../channels/channel-credentials.service';
import { ChannelHttp, RateGate, type Fetcher } from '../channels/channel-http';
import { ChannelMetrics } from '../channels/channel-metrics';
import { ChannelStoresService } from '../channels/channel-stores.service';
import {
  AIQFOME_DIALECT,
  OpenDeliveryAdapter,
  odCredential,
  type StoreTokenSource,
} from '../opendelivery/od.adapter';

/** Escopos que o Comandou pede à loja (loja e pedidos; cardápio fica para depois). */
export const AIQFOME_SCOPES = [
  'aqf:store:read',
  'aqf:store:create',
  'aqf:order:read',
  'aqf:order:create',
];
/** Quanto tempo a pessoa tem para autorizar no ID Magalu e voltar. */
const STATE_MINUTES = 15;
/** Token de acesso usado até este tempo antes de vencer (vale 2 horas). */
const EARLY_MS = 5 * 60_000;

const sha = (s: string) => createHash('sha256').update(s).digest();
const refreshCtx = (tenantId: string, storeId: string) => `aiqfome:${tenantId}:${storeId}`;
const accessCtx = (tenantId: string, storeId: string) => `aiqfome-access:${tenantId}:${storeId}`;

interface TokenBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * aiqfome (ADR 0015, Fase 13) pela camada Open Delivery dele. Cada loja autoriza o Comandou no
 * ID Magalu (OAuth com código): o restaurante digita o código da loja, vai ao ID Magalu, volta por
 * admin.<domínio> (endereço fixo cadastrado no portal do aiqfome) e termina no endereço dele, onde
 * a sessão da equipe confere o `state` (de uso único, deste restaurante e de quem começou). O
 * token de renovação troca a cada uso: a renovação trava a linha da loja para duas réplicas
 * nunca gastarem o mesmo.
 */
@Injectable()
export class AiqfomeService implements OnModuleInit, StoreTokenSource {
  private readonly logger = new Logger('Aiqfome');
  readonly adapter: OpenDeliveryAdapter;
  /** Trocado nos testes. */
  fetcher: Fetcher = (...a) => fetch(...a);
  private readonly gate = new RateGate();
  private auth?: { base: string; http: ChannelHttp };
  /** Token de acesso em memória (vale para esta réplica; o banco guarda para as outras). */
  private readonly tokens = new Map<string, { value: string; until: number }>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly creds: ChannelCredentials,
    private readonly metrics: ChannelMetrics,
    private readonly registry: ChannelRegistry,
    private readonly stores: ChannelStoresService,
    private readonly db: DatabaseService,
    private readonly platformDb: PlatformDb,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {
    this.adapter = new OpenDeliveryAdapter(
      AIQFOME_DIALECT,
      creds,
      metrics,
      async () => env.AIQFOME_API_URL,
      () => this.fetcher,
      this,
    );
  }

  onModuleInit() {
    this.registry.register(this.adapter);
  }

  /** Volta fixa cadastrada no portal do aiqfome (no painel da equipe, como o PagBank). */
  redirectUri() {
    return `https://admin.${this.env.COMANDOU_BASE_DOMAIN}/api/v1/platform/channels/oauth/aiqfome/callback`;
  }

  private key() {
    const k = this.env.INTEGRATIONS_KEY;
    if (!k)
      throw new ServiceUnavailableException(
        'Falta a INTEGRATIONS_KEY no servidor para guardar a autorização do aiqfome',
      );
    return k;
  }

  private async app() {
    const c = await this.creds.get('aiqfome');
    if (!c)
      throw new ServiceUnavailableException(
        'O aiqfome ainda não está disponível no Comandou (falta a credencial)',
      );
    return c;
  }

  private authHttp() {
    const base = this.env.AIQFOME_AUTH_URL.replace(/\/$/, '');
    if (this.auth?.base !== base)
      this.auth = {
        base,
        http: new ChannelHttp('aiqfome', base, this.metrics, this.gate, () => this.fetcher, 15_000),
      };
    return this.auth.http;
  }

  /** Troca no ID Magalu (código da autorização ou renovação). */
  private async exchange(form: Record<string, string>) {
    const c = await this.app();
    const r = await this.authHttp().request<TokenBody>({
      endpoint: 'auth:token',
      method: 'POST',
      path: '/oauth/token',
      form: {
        client_id: c.clientId,
        client_secret: c.clientSecret,
        redirect_uri: this.redirectUri(),
        ...form,
      },
      perMinute: 120,
      retries: 1,
    });
    const access = r.body?.access_token;
    if (!access || typeof access !== 'string')
      throw new ChannelHttpError(502, 'O ID Magalu não devolveu o token');
    const ttl = Number(r.body.expires_in) > 0 ? Number(r.body.expires_in) : 7200;
    return {
      access,
      refresh: typeof r.body.refresh_token === 'string' ? r.body.refresh_token : undefined,
      until: Date.now() + ttl * 1000 - EARLY_MS,
    };
  }

  // ------------------------------------------------------------------ autorização da loja

  /** Começa: guarda o state (só o hash) e devolve o endereço do ID Magalu. */
  async authorize(
    ctx: { tenantId: string; userId: string },
    b: { storeId: string; name: string },
    returnHost: string,
  ) {
    const c = await this.app();
    this.key();
    const storeId = b.storeId.trim().toLowerCase();
    if (!/^\d{1,20}$/.test(storeId))
      throw new UnprocessableEntityException('O código da loja no aiqfome tem só números');
    const state = `${ctx.tenantId.replace(/-/g, '')}.${randomBytes(32).toString('base64url')}`;
    await this.db.withTenant(ctx, (tx) =>
      q(
        tx,
        `INSERT INTO channel_oauth_states (tenant_id, channel, store_id, name, state_hash, user_id,
                                           return_host, expires_at)
         VALUES ($1, 'aiqfome', $2, $3, $4, $5, $6, now() + make_interval(mins => $7))`,
        [
          ctx.tenantId,
          storeId,
          (b.name.trim() || 'Loja aiqfome').slice(0, 160),
          sha(state),
          ctx.userId,
          returnHost,
          STATE_MINUTES,
        ],
      ),
    );
    const u = new URL(`${this.env.AIQFOME_AUTH_URL.replace(/\/$/, '')}/login`);
    u.searchParams.set('client_id', c.clientId);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', this.redirectUri());
    u.searchParams.set('scope', AIQFOME_SCOPES.join(' '));
    u.searchParams.set('state', state);
    // A pessoa escolhe a loja (filial) que está autorizando.
    u.searchParams.set('choose_tenants', 'true');
    return { url: u.toString() };
  }

  /**
   * Volta do ID Magalu em admin.<domínio>: acha o restaurante pelo state e manda o navegador de
   * volta ao endereço dele (o cookie da equipe só vale lá). Nada é trocado aqui.
   */
  async callbackTarget(state: string): Promise<string | null> {
    const m = /^([0-9a-f]{32})\.[A-Za-z0-9_-]{43}$/.exec(state ?? '');
    if (!m || !this.platformDb.enabled) return null;
    const tenantId = m[1]!.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    try {
      const h = await this.platformDb.tenantDb(tenantId);
      const [row] = await h.query<{ return_host: string }>(
        `SELECT return_host FROM channel_oauth_states
          WHERE tenant_id = $1 AND state_hash = $2 AND used_at IS NULL AND expires_at > now()`,
        [tenantId, sha(state)],
      );
      return row?.return_host ?? null;
    } catch {
      return null;
    }
  }

  /** No endereço do restaurante: confere o state, troca o código, cadastra e liga a loja. */
  async finish(
    ctx: { tenantId: string; userId: string; ip?: string },
    code: string,
    state: string,
  ) {
    if (!/^[A-Za-z0-9._~-]{4,1024}$/.test(code ?? ''))
      throw new UnprocessableEntityException('Código do aiqfome inválido');
    const st = await this.db.withTenant(ctx, (tx) =>
      one<{ store_id: string; name: string }>(
        tx,
        `UPDATE channel_oauth_states SET used_at = now()
          WHERE state_hash = $1 AND user_id = $2 AND channel = 'aiqfome'
            AND used_at IS NULL AND expires_at > now()
        RETURNING store_id, name`,
        [sha(state ?? ''), ctx.userId],
      ),
    );
    if (!st)
      throw new UnprocessableEntityException(
        'A autorização do aiqfome venceu ou já foi usada. Toque em Ligar uma loja de novo.',
      );
    const key = this.key();
    const t = await this.exchange({ grant_type: 'authorization_code', code }).catch((e) => {
      throw new HttpException(
        e instanceof ChannelHttpError && e.status < 500
          ? 'O aiqfome recusou a autorização. Tente de novo.'
          : 'Não deu para falar com o aiqfome agora. Tente de novo em alguns minutos.',
        502,
      );
    });
    if (!t.refresh)
      throw new HttpException('O ID Magalu não devolveu a renovação da autorização', 502);
    // A loja passa a usar este token já no cadastro (antes de existir a linha no banco).
    this.tokens.set(`${ctx.tenantId}|${st.store_id}`, { value: t.access, until: t.until });
    try {
      await this.adapter.onboardAuthorized(ctx.tenantId, st.store_id);
    } catch (e) {
      this.tokens.delete(`${ctx.tenantId}|${st.store_id}`);
      const status = e instanceof ChannelHttpError ? e.status : 0;
      throw new HttpException(
        status >= 400 && status < 500
          ? 'O aiqfome não aceitou o cadastro desta loja. Confira o código da loja e se ela foi a escolhida no ID Magalu.'
          : 'Não deu para falar com o aiqfome agora. Tente de novo em alguns minutos.',
        502,
      );
    }
    // Loja já ligada a outro restaurante: recusa aqui (a reserva no banco central decide).
    const row = await this.stores
      .connect(ctx.tenantId, ctx.userId, {
        channel: 'aiqfome',
        storeId: st.store_id,
        name: st.name,
        credential: odCredential('aiqfome'),
      })
      .catch((e: unknown) => {
        this.tokens.delete(`${ctx.tenantId}|${st.store_id}`);
        throw e;
      });
    await this.db.withTenant(ctx, async (tx) => {
      await q(
        tx,
        `UPDATE channel_stores SET token_enc = $2, access_enc = $3, access_until = $4
          WHERE id = $1`,
        [
          row.id,
          seal(key, t.refresh!, refreshCtx(ctx.tenantId, st.store_id)),
          seal(key, t.access, accessCtx(ctx.tenantId, st.store_id)),
          new Date(t.until),
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'channel.store_connected',
        entity: 'channel_store',
        entityId: row.id,
        data: { channel: 'aiqfome' },
        ip: ctx.ip,
      });
    });
    this.realtime.publish(ctx.tenantId, { type: 'channels.changed' });
    return row;
  }

  // ------------------------------------------------------------------ token de cada loja

  /**
   * Token de acesso da loja: memória → banco → renovação. A renovação trava a linha da loja
   * (FOR UPDATE) e grava o par novo antes de soltar; quem esperava lê o token já renovado.
   * Renovação recusada: a loja para de buscar e pede nova autorização na tela.
   */
  async get(tenantId: string, storeId: string, forget: boolean): Promise<string> {
    const mem = `${tenantId}|${storeId}`;
    const hit = this.tokens.get(mem);
    if (!forget && hit && Date.now() < hit.until) return hit.value;
    const key = this.key();
    let revoked: { id: string } | null = null;
    const token = await this.db.withTenant({ tenantId }, async (tx) => {
      const r = await one<{
        id: string;
        token_enc: Buffer | null;
        access_enc: Buffer | null;
        access_until: Date | null;
      }>(
        tx,
        `SELECT id, token_enc, access_enc, access_until FROM channel_stores
          WHERE channel = 'aiqfome' AND store_id = $1 FOR UPDATE`,
        [storeId],
      );
      if (!r?.token_enc) throw new ChannelHttpError(403, 'Autorize a loja do aiqfome de novo');
      const until = r.access_until ? new Date(r.access_until).getTime() : 0;
      // Outra réplica já renovou (ou o token guardado ainda vale e não foi recusado aqui).
      if (r.access_enc && Date.now() < until) {
        const value = open(key, r.access_enc, accessCtx(tenantId, storeId));
        if (!forget || value !== hit?.value) return { value, until };
      }
      const refresh = open(key, r.token_enc, refreshCtx(tenantId, storeId));
      let t: Awaited<ReturnType<AiqfomeService['exchange']>>;
      try {
        t = await this.exchange({ grant_type: 'refresh_token', refresh_token: refresh });
      } catch (e) {
        if (e instanceof ChannelHttpError && (e.status === 400 || e.status === 401)) {
          revoked = { id: r.id };
          await q(
            tx,
            `UPDATE channel_stores SET token_enc = NULL, access_enc = NULL, access_until = NULL
              WHERE id = $1`,
            [r.id],
          );
          return null;
        }
        throw e;
      }
      await q(
        tx,
        `UPDATE channel_stores SET token_enc = $2, access_enc = $3, access_until = $4 WHERE id = $1`,
        [
          r.id,
          seal(key, t.refresh ?? refresh, refreshCtx(tenantId, storeId)),
          seal(key, t.access, accessCtx(tenantId, storeId)),
          new Date(t.until),
        ],
      );
      return { value: t.access, until: t.until };
    });
    if (!token) {
      this.tokens.delete(mem);
      const msg = 'A autorização do aiqfome venceu. Ligue a loja de novo pelo ID Magalu.';
      this.logger.warn('autorização de uma loja do aiqfome recusada na renovação');
      if (revoked)
        await this.stores
          .markRevoked(tenantId, (revoked as { id: string }).id, msg)
          .catch(() => undefined);
      throw new ChannelHttpError(403, msg);
    }
    if (this.tokens.size > 5000) this.tokens.clear();
    this.tokens.set(mem, token);
    return token.value;
  }
}
