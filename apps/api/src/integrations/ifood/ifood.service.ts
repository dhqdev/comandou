import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { open, seal } from '../../common/secret-box';
import { one, q } from '../../common/sql';
import { DatabaseService, type Tx } from '../../database/database.service';
import { QueueService, type TenantJob } from '../../queue/queue.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { PRODUCT_STOCK_OUT } from '../../stock/availability-sql';
import { ChannelCredentials } from '../channels/channel-credentials.service';
import { ChannelStoresService } from '../channels/channel-stores.service';
import {
  type Fetcher,
  IfoodClient,
  type IfoodCredentials,
  IfoodError,
  type IfoodToken,
  ifoodAuth,
} from './ifood.client';
import {
  type ItemIds,
  type IfoodStatus,
  type LocalCategory,
  type LocalItem,
  type MapRow,
  type SyncSummary,
  categoryExternalCode,
  emptySummary,
  fingerprints,
  itemPayload,
  planItems,
  reais,
} from './ifood-sync';

const SYNC_TENANT_JOB = 'ifood.sync-tenant';
/** Credencial do polling: uma para todas as lojas (centralizado) ou uma por loja (distribuído). */
export const IFOOD_CENTRAL = 'ifood:central';
export const ifoodCredentialOf = (conn: { id: string; mode: string }) =>
  conn.mode === 'centralized' ? IFOOD_CENTRAL : `ifood:conn:${conn.id}`;
const MAX_ERRORS = 20;

export interface ConnectionRow {
  id: string;
  merchant_id: string;
  merchant_name: string;
  mode: 'centralized' | 'distributed';
  refresh_token_enc: Buffer | null;
  status: 'connected' | 'revoked';
  last_error: string | null;
}

interface MenuSyncRow {
  id: string;
  name: string;
  kind: string;
  active: boolean;
  ifood_connection_id: string | null;
}

/**
 * Integração do cardápio com o iFood: lojas ligadas, autorização e a sincronização.
 * As credenciais do aplicativo vêm de Super Admin › Credenciais (cifradas); IFOOD_CLIENT_ID/SECRET
 * do servidor ficam só como reserva.
 */
@Injectable()
export class IfoodService implements OnModuleInit {
  private readonly logger = new Logger('iFood');
  private readonly tokens = new Map<string, IfoodToken>();
  private readonly inflight = new Map<string, Promise<IfoodToken>>();
  private readonly running = new Set<string>();
  /** Troca só nos testes (servidor falso do iFood). */
  fetcher: Fetcher = (...a) => fetch(...a);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly queue: QueueService,
    private readonly realtime: RealtimeService,
    private readonly credentials: ChannelCredentials,
    private readonly stores: ChannelStoresService,
  ) {}

  onModuleInit() {
    this.queue.register(SYNC_TENANT_JOB, (d) => this.syncTenant(d));
    this.stores.onSync((tenantId) => this.ensureChannelStores(tenantId));
    // "Conforme o cliente coloca": qualquer mudança no cardápio agenda o envio ao iFood.
    this.realtime.onPublish((tenantId, e) => {
      if (e.type === 'menu.changed')
        void this.credentials.get('ifood').then((c) => c && this.scheduleTenant(tenantId));
    });
  }

  /** Modo do aplicativo: o salvo no painel, senão o do servidor. */
  async mode(): Promise<'centralized' | 'distributed'> {
    const c = await this.credentials.get('ifood');
    return c?.mode === 'distributed' || c?.mode === 'centralized'
      ? c.mode
      : this.env.IFOOD_APP_MODE;
  }

  async status() {
    const c = await this.credentials.get('ifood');
    return {
      configured: !!c,
      mode: await this.mode(),
      // O modo distribuído guarda o refresh token cifrado: precisa da INTEGRATIONS_KEY.
      keyConfigured: !!this.env.INTEGRATIONS_KEY,
    };
  }

  /** Para a rota responder 503 antes de começar, quando falta a credencial. */
  async assertConfigured() {
    await this.creds();
  }

  async creds(): Promise<IfoodCredentials> {
    const c = await this.credentials.get('ifood');
    if (!c)
      throw new ServiceUnavailableException(
        'Integração com o iFood não configurada (Super Admin › Credenciais › iFood)',
      );
    return {
      baseUrl: this.env.IFOOD_API_URL.replace(/\/$/, ''),
      clientId: c.clientId,
      clientSecret: c.clientSecret,
    };
  }

  // ------------------------------------------------------------------ token

  /** Token em memória, renovado 5 min antes de vencer, uma renovação por vez. */
  private async token(key: string, renew: () => Promise<IfoodToken>): Promise<string> {
    const t = this.tokens.get(key);
    if (t && Date.now() < t.expiresAt - 5 * 60_000) return t.accessToken;
    let p = this.inflight.get(key);
    if (!p) {
      p = renew().finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    const fresh = await p;
    this.tokens.set(key, fresh);
    return fresh.accessToken;
  }

  async centralClient() {
    const c = await this.creds();
    return new IfoodClient(
      c,
      () => this.token('central', () => ifoodAuth.clientCredentials(c, this.fetcher)),
      () => this.tokens.delete('central'),
      this.fetcher,
    );
  }

  private key() {
    if (!this.env.INTEGRATIONS_KEY)
      throw new ServiceUnavailableException(
        'Falta a INTEGRATIONS_KEY no servidor para guardar a autorização do iFood',
      );
    return this.env.INTEGRATIONS_KEY;
  }

  /** Cliente para uma loja ligada (central ou com o refresh token dela). */
  async clientFor(tenantId: string, conn: ConnectionRow) {
    if (conn.mode === 'centralized') return this.centralClient();
    const c = await this.creds();
    const ctx = `ifood:${tenantId}:${conn.id}`;
    return new IfoodClient(
      c,
      () => this.connectionToken(tenantId, conn.id),
      () => this.tokens.delete(ctx),
      this.fetcher,
    );
  }

  /** Token de uma loja do modo distribuído (refresh token cifrado dela). */
  private async connectionToken(tenantId: string, connId: string) {
    const c = await this.creds();
    const ctx = `ifood:${tenantId}:${connId}`;
    return this.token(ctx, async () => {
      const row = await this.db.withTenant({ tenantId }, (tx) =>
        one<{ refresh_token_enc: Buffer | null }>(
          tx,
          `SELECT refresh_token_enc FROM ifood_connections WHERE id = $1`,
          [connId],
        ),
      );
      if (!row?.refresh_token_enc) throw new IfoodError(403, 'Autorize a loja do iFood de novo');
      const refresh = open(this.key(), row.refresh_token_enc, ctx);
      const t = await ifoodAuth.refresh(c, refresh, this.fetcher);
      if (t.refreshToken && t.refreshToken !== refresh)
        await this.db.withTenant({ tenantId }, (tx) =>
          q(tx, `UPDATE ifood_connections SET refresh_token_enc = $2 WHERE id = $1`, [
            connId,
            seal(this.key(), t.refreshToken!, ctx),
          ]),
        );
      return t;
    });
  }

  /**
   * Token para os pedidos (polling, detalhes e ações). `credential` é a de channel_store_claims:
   * 'ifood:central' (um token para todas as lojas) ou 'ifood:conn:<id>' (modo distribuído).
   */
  async bearer(credential: string, tenantId: string): Promise<string> {
    if (credential === IFOOD_CENTRAL) {
      const c = await this.creds();
      return this.token('central', () => ifoodAuth.clientCredentials(c, this.fetcher));
    }
    const connId = credential.startsWith('ifood:conn:') ? credential.slice(11) : '';
    if (!/^[0-9a-f-]{36}$/.test(connId)) throw new IfoodError(403, 'Credencial do iFood inválida');
    return this.connectionToken(tenantId, connId);
  }

  /** O iFood respondeu 401: o próximo pedido de token busca um novo. */
  forgetBearer(credential: string, tenantId: string) {
    if (credential === IFOOD_CENTRAL) this.tokens.delete('central');
    else this.tokens.delete(`ifood:${tenantId}:${credential.slice(11)}`);
  }

  // ------------------------------------------------------------------ lojas ligadas

  listConnections(tx: Tx) {
    return q(
      tx,
      `SELECT c.id, c.merchant_id AS "merchantId", c.merchant_name AS "merchantName", c.mode,
              c.status, c.last_error AS "lastError", c.created_at AS "createdAt",
              (SELECT m.id FROM menus m WHERE m.ifood_connection_id = c.id LIMIT 1) AS "menuId"
         FROM ifood_connections c ORDER BY c.merchant_name`,
    );
  }

  /** Reserva a loja no banco central: uma loja do iFood fica ligada a um restaurante só. */
  private async claim(tenantId: string, merchantId: string) {
    try {
      await this.db.withCentral({ tenantId }, (tx) =>
        q(
          tx,
          `INSERT INTO ifood_merchant_claims (merchant_id, tenant_id) VALUES ($1, $2)
           ON CONFLICT (merchant_id) DO NOTHING`,
          [merchantId.toLowerCase(), tenantId],
        ).then(async () => {
          const mine = await one(tx, `SELECT 1 FROM ifood_merchant_claims WHERE merchant_id = $1`, [
            merchantId.toLowerCase(),
          ]);
          if (!mine) throw new ConflictException('claimed');
        }),
      );
    } catch (e) {
      if (e instanceof ConflictException || (e as { code?: string }).code === '23505')
        throw new ConflictException(
          'Essa loja do iFood já está ligada a outro restaurante. Fale com o suporte do Comandou.',
        );
      throw e;
    }
  }

  async releaseClaim(tenantId: string, merchantId: string) {
    await this.db.withCentral({ tenantId }, (tx) =>
      q(tx, `DELETE FROM ifood_merchant_claims WHERE merchant_id = $1`, [merchantId.toLowerCase()]),
    );
  }

  private async saveConnection(
    tenantId: string,
    userId: string,
    m: { id: string; name: string },
    mode: 'centralized' | 'distributed',
    refreshToken?: string,
  ) {
    await this.claim(tenantId, m.id);
    const saved = await this.db.withTenant({ tenantId, userId }, async (tx) => {
      const row = await one<{ id: string }>(
        tx,
        `INSERT INTO ifood_connections (tenant_id, merchant_id, merchant_name, mode, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, merchant_id) DO UPDATE
           SET merchant_name = EXCLUDED.merchant_name, mode = EXCLUDED.mode,
               status = 'connected', last_error = NULL
         RETURNING id`,
        [tenantId, m.id.toLowerCase(), (m.name || 'Loja iFood').slice(0, 160), mode, userId],
      );
      if (refreshToken)
        await q(tx, `UPDATE ifood_connections SET refresh_token_enc = $2 WHERE id = $1`, [
          row!.id,
          seal(this.key(), refreshToken, `ifood:${tenantId}:${row!.id}`),
        ]);
      this.tokens.delete(`ifood:${tenantId}:${row!.id}`);
      return { id: row!.id, merchantId: m.id.toLowerCase(), merchantName: m.name };
    });
    // Loja também na camada de canais (pedidos). Receber pedidos começa desligado.
    await this.stores.connect(tenantId, userId, {
      channel: 'ifood',
      storeId: saved.merchantId,
      name: m.name || 'Loja iFood',
      credential: ifoodCredentialOf({ id: saved.id, mode }),
      ifoodConnectionId: saved.id,
    });
    return saved;
  }

  /**
   * Lojas ligadas antes dos pedidos do iFood (só cardápio): entram na camada de canais na primeira
   * vez que alguém abre a tela de aplicativos. Idempotente.
   */
  async ensureChannelStores(tenantId: string) {
    const missing = await this.db.withTenant({ tenantId }, (tx) =>
      q<{ id: string; merchant_id: string; merchant_name: string; mode: string }>(
        tx,
        `SELECT c.id, c.merchant_id, c.merchant_name, c.mode FROM ifood_connections c
          WHERE NOT EXISTS (SELECT 1 FROM channel_stores s
                             WHERE s.channel = 'ifood' AND s.store_id = c.merchant_id)`,
      ),
    );
    for (const c of missing)
      await this.stores
        .connect(tenantId, null, {
          channel: 'ifood',
          storeId: c.merchant_id,
          name: c.merchant_name,
          credential: ifoodCredentialOf(c),
          ifoodConnectionId: c.id,
        })
        .catch((e) =>
          this.logger.warn(`loja do iFood não entrou nos canais: ${(e as Error).message}`),
        );
  }

  /** Modo centralizado: a loja autorizou o app do Comandou no Portal do Parceiro. */
  async connectCentralized(tenantId: string, userId: string, merchantId: string) {
    if ((await this.mode()) !== 'centralized')
      throw new BadRequestException('Use a autorização com código do iFood');
    let m: { id: string; name: string };
    const api = await this.centralClient();
    try {
      m = await api.merchant(merchantId);
    } catch (e) {
      if (e instanceof IfoodError && (e.status === 403 || e.status === 404))
        throw new BadRequestException(
          'O iFood não liberou essa loja para o Comandou. No Portal do Parceiro, autorize o aplicativo e confira o id da loja.',
        );
      throw this.http(e);
    }
    return this.saveConnection(
      tenantId,
      userId,
      { id: m.id ?? merchantId, name: m.name },
      'centralized',
    );
  }

  /** Modo distribuído, passo 1: código para o lojista digitar no Portal do Parceiro. */
  async startAuthorization(tenantId: string, userId: string) {
    if ((await this.mode()) !== 'distributed')
      throw new BadRequestException('Este servidor liga lojas pelo id do iFood');
    const c = await this.creds();
    const key = this.key();
    let r: Awaited<ReturnType<typeof ifoodAuth.userCode>>;
    try {
      r = await ifoodAuth.userCode(c, this.fetcher);
    } catch (e) {
      throw this.http(e);
    }
    await this.db.withTenant({ tenantId, userId }, (tx) =>
      q(
        tx,
        `INSERT INTO ifood_pending_auth (tenant_id, verifier_enc, user_code, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(secs => $4))
         ON CONFLICT (tenant_id) DO UPDATE SET verifier_enc = EXCLUDED.verifier_enc,
           user_code = EXCLUDED.user_code, expires_at = EXCLUDED.expires_at, created_at = now()`,
        [tenantId, seal(key, r.verifier, `ifood-auth:${tenantId}`), r.userCode, r.expiresIn],
      ),
    );
    return { userCode: r.userCode, verificationUrl: r.verificationUrl, expiresIn: r.expiresIn };
  }

  /** Passo 2: o código de autorização que o Portal mostra depois de aprovar. */
  async confirmAuthorization(tenantId: string, userId: string, authorizationCode: string) {
    const c = await this.creds();
    const key = this.key();
    const pending = await this.db.withTenant({ tenantId, userId }, (tx) =>
      // Só lê: um código digitado errado (ou a rede caindo na troca) não obriga a gerar outro e
      // autorizar de novo no Portal. Sai depois que a troca deu certo.
      one<{ verifier_enc: Buffer }>(
        tx,
        `SELECT verifier_enc FROM ifood_pending_auth WHERE expires_at > now()`,
      ),
    );
    if (!pending)
      throw new BadRequestException('O código venceu. Gere um novo e autorize de novo no iFood.');
    const verifier = open(key, pending.verifier_enc, `ifood-auth:${tenantId}`);
    let t: IfoodToken;
    let merchants: { id: string; name: string }[];
    try {
      t = await ifoodAuth.authorizationCode(c, authorizationCode.trim(), verifier, this.fetcher);
      if (!t.refreshToken) throw new IfoodError(502, 'O iFood não devolveu o refresh token');
      const token = t;
      merchants = await new IfoodClient(
        c,
        async () => token.accessToken,
        () => undefined,
        this.fetcher,
      ).merchants();
    } catch (e) {
      throw this.http(e);
    }
    await this.db.withTenant({ tenantId, userId }, (tx) =>
      q(tx, `DELETE FROM ifood_pending_auth WHERE tenant_id = $1`, [tenantId]),
    );
    if (!merchants.length) throw new BadRequestException('Nenhuma loja veio nessa autorização');
    const out = [];
    for (const m of merchants)
      out.push(await this.saveConnection(tenantId, userId, m, 'distributed', t.refreshToken));
    return out;
  }

  async removeConnection(tenantId: string, userId: string, id: string) {
    const row = await this.db.withTenant({ tenantId, userId }, async (tx) => {
      const r = await one<{ merchant_id: string }>(
        tx,
        `DELETE FROM ifood_connections WHERE id = $1 RETURNING merchant_id`,
        [id],
      );
      return r;
    });
    if (!row) throw new NotFoundException('Loja do iFood não encontrada');
    await this.releaseClaim(tenantId, row.merchant_id);
    // A loja da camada de canais saiu junto (FK em cascata); solta a reserva do polling.
    await this.stores.release(tenantId, 'ifood', row.merchant_id);
    this.tokens.delete(`ifood:${tenantId}:${id}`);
    return row;
  }

  private http(e: unknown) {
    if (e instanceof IfoodError) {
      if (e.status === 401) return new ServiceUnavailableException(e.message);
      return new BadRequestException(e.message);
    }
    return e;
  }

  // ------------------------------------------------------------------ sincronização

  /** Agenda o envio dos cardápios do iFood do restaurante (junta várias edições seguidas). */
  async scheduleTenant(tenantId: string) {
    const delayMs = this.env.IFOOD_SYNC_DELAY_SECONDS * 1000;
    const bucket = Math.floor(Date.now() / Math.max(delayMs, 1000));
    try {
      await this.queue.add(
        SYNC_TENANT_JOB,
        { tenantId },
        { jobId: `ifood-${tenantId}-${bucket}`, delayMs, attempts: 3 },
      );
    } catch (e) {
      this.logger.warn(`não agendou o envio ao iFood: ${(e as Error).message}`);
    }
  }

  private async syncTenant(d: TenantJob) {
    const menus = await this.db.withTenant({ tenantId: d.tenantId }, (tx) =>
      q<{ id: string }>(
        tx,
        `SELECT m.id FROM menus m JOIN ifood_connections c ON c.id = m.ifood_connection_id
          WHERE m.kind = 'ifood' AND m.active AND c.status = 'connected'`,
      ),
    );
    for (const m of menus) await this.syncMenu(d.tenantId, m.id);
  }

  /** Estado da última sincronização (para a tela). */
  syncState(tx: Tx, menuId: string) {
    return one(
      tx,
      `SELECT m.ifood_synced_at AS "syncedAt", m.ifood_sync_status AS "status",
              m.ifood_sync_summary AS "summary", m.ifood_sync_started_at AS "startedAt",
              c.id AS "connectionId", c.merchant_name AS "merchantName", c.status AS "connectionStatus"
         FROM menus m LEFT JOIN ifood_connections c ON c.id = m.ifood_connection_id
        WHERE m.id = $1 AND m.kind = 'ifood'`,
      [menuId],
    );
  }

  /** Marca "enviando" (uma sincronização por cardápio; destrava sozinho após 10 min). */
  private async begin(tenantId: string, menuId: string) {
    if (this.running.has(menuId)) return null;
    const row = await this.db.withTenant({ tenantId }, (tx) =>
      one<MenuSyncRow>(
        tx,
        `UPDATE menus SET ifood_sync_status = 'running', ifood_sync_started_at = now()
          WHERE id = $1 AND kind = 'ifood'
            AND (ifood_sync_status IS DISTINCT FROM 'running'
                 OR ifood_sync_started_at < now() - interval '10 minutes')
          RETURNING id, name, kind, active, ifood_connection_id`,
        [menuId],
      ),
    );
    if (row) this.running.add(menuId);
    return row;
  }

  /**
   * Compara o cardápio com o que já foi enviado e manda ao iFood só o que mudou.
   * Devolve o resumo (também guardado no cardápio) ou null se já havia uma rodando.
   */
  async syncMenu(tenantId: string, menuId: string) {
    const menu = await this.begin(tenantId, menuId);
    if (!menu) {
      // Outra rodando: tenta de novo depois para não perder a última edição.
      if (this.running.has(menuId)) void this.scheduleTenant(tenantId);
      return null;
    }
    this.realtime.publish(tenantId, { type: 'ifood.sync', menuId });
    const summary = emptySummary();
    let fatal: string | null = null;
    try {
      await this.run(tenantId, menu, summary);
    } catch (e) {
      fatal = (e as Error).message;
      summary.errors.unshift({ name: 'iFood', message: fatal });
      if (e instanceof IfoodError && e.status === 403 && menu.ifood_connection_id)
        await this.db.withTenant({ tenantId }, (tx) =>
          q(tx, `UPDATE ifood_connections SET status = 'revoked', last_error = $2 WHERE id = $1`, [
            menu.ifood_connection_id,
            fatal,
          ]),
        );
    } finally {
      this.running.delete(menuId);
      const status = fatal ? 'error' : summary.failed ? 'partial' : 'ok';
      await this.db
        .withTenant({ tenantId }, (tx) =>
          q(
            tx,
            `UPDATE menus SET ifood_sync_status = $2, ifood_sync_summary = $3::jsonb,
                    ifood_synced_at = CASE WHEN $2 = 'error' THEN ifood_synced_at ELSE now() END
              WHERE id = $1`,
            [menuId, status, JSON.stringify(summary)],
          ),
        )
        .catch((e: Error) => this.logger.warn(`não gravou o resumo: ${e.message}`));
      this.realtime.publish(tenantId, { type: 'ifood.sync', menuId });
    }
    return summary;
  }

  private async run(tenantId: string, menu: MenuSyncRow, summary: SyncSummary) {
    if (!menu.ifood_connection_id) throw new Error('Escolha a loja do iFood deste cardápio');
    const conn = await this.db.withTenant({ tenantId }, (tx) =>
      one<ConnectionRow>(tx, `SELECT * FROM ifood_connections WHERE id = $1`, [
        menu.ifood_connection_id,
      ]),
    );
    if (!conn) throw new Error('Loja do iFood não encontrada');
    const api = await this.clientFor(tenantId, conn);
    const merchant = conn.merchant_id;

    const catalogs = await api.catalogs(merchant);
    const catalog = catalogs.find((c) => c.context?.includes('DEFAULT')) ?? catalogs[0];
    if (!catalog?.catalogId) throw new Error('A loja não tem catálogo no iFood');

    const snap = await this.snapshot(tenantId, menu.id);
    const db = (fn: (tx: Tx) => Promise<unknown>) => this.db.withTenant({ tenantId }, fn);
    const fail = (name: string, e: unknown) => {
      summary.failed++;
      if (e instanceof IfoodError && (e.status === 401 || e.status === 403)) throw e;
      if (summary.errors.length < MAX_ERRORS)
        summary.errors.push({ name, message: (e as Error).message.slice(0, 300) });
    };

    // 1) Categorias: as que têm itens no cardápio.
    const usedCats = new Set(snap.items.map((i) => i.categoryId));
    const remoteCat = new Map<string, string>();
    let remoteList: { id: string; name: string; externalCode?: string }[] | null = null;
    for (const c of snap.categories) {
      const prev = snap.map.category.get(c.id);
      const want = usedCats.has(c.id);
      const shape = JSON.stringify([c.name, c.position]);
      try {
        if (!prev) {
          if (!want) continue;
          let id: string;
          try {
            id = (
              await api.createCategory(merchant, catalog.catalogId, {
                name: c.name,
                externalCode: categoryExternalCode(c.id),
                status: 'AVAILABLE',
                index: c.position,
              })
            ).id;
          } catch (e) {
            if (!(e instanceof IfoodError && e.status === 409)) throw e;
            // Já existe (ex.: cardápio recriado): acha pelo código ou pelo nome.
            remoteList ??= await api.categories(merchant, catalog.catalogId);
            const found = remoteList.find(
              (r) =>
                r.externalCode === categoryExternalCode(c.id) ||
                r.name.trim().toLowerCase() === c.name.trim().toLowerCase(),
            );
            if (!found) throw e;
            id = found.id;
          }
          remoteCat.set(c.id, id);
          await db((tx) =>
            this.putMap(tx, tenantId, menu.id, 'category', c.id, id, {}, shape, null, 'AVAILABLE'),
          );
          continue;
        }
        remoteCat.set(c.id, prev.remoteId);
        const status: IfoodStatus = want ? 'AVAILABLE' : 'UNAVAILABLE';
        if (prev.shapeHash !== shape || prev.status !== status) {
          if (!want && prev.status === 'UNAVAILABLE') continue;
          await api.updateCategory(merchant, catalog.catalogId, prev.remoteId, {
            ...(prev.shapeHash !== shape ? { name: c.name, index: c.position } : {}),
            status,
          });
          await db((tx) =>
            this.putMap(
              tx,
              tenantId,
              menu.id,
              'category',
              c.id,
              prev.remoteId,
              {},
              shape,
              null,
              status,
            ),
          );
        }
      } catch (e) {
        fail(`Categoria ${c.name}`, e);
      }
    }
    // Categoria que não existe mais no Comandou: só pausa no iFood.
    for (const [localId, prev] of snap.map.category) {
      if (snap.categories.some((c) => c.id === localId) || prev.status === 'UNAVAILABLE') continue;
      try {
        await api.updateCategory(merchant, catalog.catalogId, prev.remoteId, {
          status: 'UNAVAILABLE',
        });
        await db((tx) =>
          q(
            tx,
            `UPDATE ifood_sync_map SET status = 'UNAVAILABLE' WHERE menu_id = $1 AND entity = 'category' AND local_id = $2`,
            [menu.id, localId],
          ),
        );
      } catch (e) {
        fail('Categoria removida', e);
      }
    }

    // 2) Fotos: JPG/PNG sobem direto; WebP precisa ser convertida pelo navegador.
    const imagePath = new Map<string, string>();
    for (const [id, row] of snap.map.image) imagePath.set(id, row.remoteId);
    const pendingImages = new Set<string>();
    for (const i of snap.items) {
      if (!i.imageId || imagePath.has(i.imageId) || pendingImages.has(i.imageId)) continue;
      const media = snap.media.get(i.imageId);
      if (!media || media.content_type === 'image/webp') {
        pendingImages.add(i.imageId);
        continue;
      }
      try {
        const r = await this.uploadMedia(tenantId, api, merchant, i.imageId);
        if (r) {
          imagePath.set(i.imageId, r);
          await db((tx) =>
            this.putMap(tx, tenantId, menu.id, 'image', i.imageId!, r, {}, null, null, 'AVAILABLE'),
          );
        }
      } catch (e) {
        fail(`Foto de ${i.name}`, e);
      }
    }
    summary.imagesPending = pendingImages.size;

    // 3) Itens.
    const items = snap.items.filter((i) => remoteCat.has(i.categoryId));
    const payloadOf = (i: LocalItem, ids: ItemIds, itemId: string) =>
      itemPayload(
        i,
        ids,
        itemId,
        remoteCat.get(i.categoryId)!,
        i.imageId ? (imagePath.get(i.imageId) ?? null) : null,
      );
    for (const a of planItems(items, snap.map.item, payloadOf)) {
      try {
        if (a.kind === 'unchanged') {
          summary.unchanged++;
        } else if (a.kind === 'create' || a.kind === 'update') {
          let itemId = a.itemId;
          let body = payloadOf(a.local, a.ids, itemId);
          try {
            await api.putItem(merchant, body);
          } catch (e) {
            // 409 = já existe um item com esse código: usa o id que o iFood devolveu.
            const other = e instanceof IfoodError && e.status === 409 ? e.conflictingIds[0] : null;
            if (!other) throw e;
            itemId = other;
            body = payloadOf(a.local, a.ids, itemId);
            await api.putItem(merchant, body);
          }
          const fp = fingerprints(body);
          await db((tx) =>
            this.putMap(
              tx,
              tenantId,
              menu.id,
              'item',
              a.local.id,
              itemId,
              a.ids,
              fp.shape,
              fp.offer,
              body.item.status,
            ),
          );
          if (a.kind === 'create') summary.created++;
          else summary.updated++;
        } else if (a.kind === 'offer') {
          if (a.price) {
            await api.itemPrice(merchant, a.itemId, reais(a.local.price));
            const prev = snap.map.item.get(a.local.id)!;
            const fp = fingerprints(payloadOf(a.local, itemIdsOf(prev), a.itemId));
            await db((tx) =>
              q(
                tx,
                `UPDATE ifood_sync_map SET offer_hash = $3, updated_at = now() WHERE menu_id = $1 AND entity = 'item' AND local_id = $2`,
                [menu.id, a.local.id, fp.offer],
              ),
            );
          }
          if (a.status) {
            const status = a.status;
            await api.itemStatus(merchant, a.itemId, status);
            await db((tx) =>
              q(
                tx,
                `UPDATE ifood_sync_map SET status = $3, updated_at = now() WHERE menu_id = $1 AND entity = 'item' AND local_id = $2`,
                [menu.id, a.local.id, status],
              ),
            );
          }
          summary.updated++;
        } else if (a.kind === 'unavailable') {
          await api.itemStatus(merchant, a.itemId, 'UNAVAILABLE');
          await db((tx) =>
            q(
              tx,
              `UPDATE ifood_sync_map SET status = 'UNAVAILABLE', updated_at = now() WHERE menu_id = $1 AND entity = 'item' AND local_id = $2`,
              [menu.id, a.localId],
            ),
          );
          summary.unavailable++;
        }
      } catch (e) {
        fail('local' in a ? a.local.name : 'Item removido', e);
      }
    }
  }

  private putMap(
    tx: Tx,
    tenantId: string,
    menuId: string,
    entity: 'category' | 'item' | 'image',
    localId: string,
    remoteId: string,
    extra: object,
    shape: string | null,
    offer: string | null,
    status: IfoodStatus,
  ) {
    return q(
      tx,
      `INSERT INTO ifood_sync_map (tenant_id, menu_id, entity, local_id, remote_id, extra, shape_hash, offer_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
       ON CONFLICT (tenant_id, menu_id, entity, local_id) DO UPDATE SET remote_id = EXCLUDED.remote_id,
         extra = EXCLUDED.extra, shape_hash = EXCLUDED.shape_hash, offer_hash = EXCLUDED.offer_hash,
         status = EXCLUDED.status, updated_at = now()`,
      [tenantId, menuId, entity, localId, remoteId, JSON.stringify(extra), shape, offer, status],
    );
  }

  private async uploadMedia(tenantId: string, api: IfoodClient, merchant: string, mediaId: string) {
    const m = await this.db.withTenant({ tenantId }, (tx) =>
      one<{ content_type: string; bytes: Buffer }>(
        tx,
        `SELECT content_type, bytes FROM media WHERE id = $1`,
        [mediaId],
      ),
    );
    if (!m) return null;
    const r = await api.uploadImage(
      merchant,
      `data:${m.content_type};base64,${m.bytes.toString('base64')}`,
    );
    return r.imagePath ?? r.path ?? null;
  }

  /** Sobe ao iFood fotos já convertidas em JPG pelo navegador; o próximo envio usa o caminho. */
  async uploadImages(tenantId: string, menuId: string, images: Map<string, string>) {
    const conn = await this.db.withTenant({ tenantId }, async (tx) => {
      const m = await one<{ ifood_connection_id: string | null }>(
        tx,
        `SELECT ifood_connection_id FROM menus WHERE id = $1 AND kind = 'ifood'`,
        [menuId],
      );
      if (!m) throw new NotFoundException('Cardápio do iFood não encontrado');
      if (!m.ifood_connection_id)
        throw new BadRequestException('Escolha a loja do iFood deste cardápio');
      return one<ConnectionRow>(tx, `SELECT * FROM ifood_connections WHERE id = $1`, [
        m.ifood_connection_id,
      ]);
    });
    if (!conn) throw new NotFoundException('Loja do iFood não encontrada');
    const api = await this.clientFor(tenantId, conn);
    let sent = 0;
    const errors: string[] = [];
    for (const [mediaId, dataUri] of images) {
      // Só fotos de itens deste restaurante (o RLS já garante; aqui confere que existe).
      const ok = await this.db.withTenant({ tenantId }, (tx) =>
        one(tx, `SELECT 1 FROM media WHERE id = $1`, [mediaId]),
      );
      if (!ok) continue;
      try {
        const r = await api.uploadImage(conn.merchant_id, dataUri);
        const path = r.imagePath ?? r.path;
        if (!path) continue;
        await this.db.withTenant({ tenantId }, (tx) =>
          this.putMap(tx, tenantId, menuId, 'image', mediaId, path, {}, null, null, 'AVAILABLE'),
        );
        sent++;
      } catch (e) {
        if (e instanceof IfoodError && (e.status === 401 || e.status === 403)) throw this.http(e);
        errors.push((e as Error).message);
      }
    }
    return { sent, errors: errors.slice(0, 5) };
  }

  /** Fotos em WebP que o navegador precisa converter em JPG antes de enviar. */
  pendingImages(tx: Tx, menuId: string) {
    return q<{ mediaId: string }>(
      tx,
      `SELECT DISTINCT p.image_id AS "mediaId"
         FROM menu_items mi JOIN products p ON p.id = mi.product_id
         JOIN media md ON md.id = p.image_id
        WHERE mi.menu_id = $1 AND p.active AND md.content_type = 'image/webp'
          AND NOT EXISTS (SELECT 1 FROM ifood_sync_map s
                           WHERE s.menu_id = $1 AND s.entity = 'image' AND s.local_id = p.image_id)
        LIMIT 300`,
      [menuId],
    );
  }

  /** Tudo o que o cardápio tem hoje, mais o que já foi enviado ao iFood. */
  private snapshot(tenantId: string, menuId: string) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const categories = await q<LocalCategory>(
        tx,
        `SELECT id, name, position FROM categories WHERE active ORDER BY position, name`,
      );
      const rows = await q<{
        id: string;
        code: string | null;
        name: string;
        description: string | null;
        price: string;
        category_id: string;
        sold_out: boolean;
        image_id: string | null;
        position: number;
        groups: {
          id: string;
          name: string;
          min: number;
          max: number;
          options: { id: string; name: string; priceDelta: string }[];
        }[];
      }>(
        tx,
        `SELECT p.id, p.code, p.name, p.description, COALESCE(mi.price, p.price)::text AS price,
                p.category_id, (p.sold_out OR ${PRODUCT_STOCK_OUT}) AS sold_out, p.image_id, p.position,
                COALESCE((SELECT json_agg(json_build_object(
                    'id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
                    'options', COALESCE((SELECT json_agg(json_build_object('id', o.id, 'name', o.name,
                                           'priceDelta', o.price_delta::text) ORDER BY o.position, o.name)
                                        FROM options o WHERE o.group_id = g.id AND o.active AND NOT o.archived), '[]'))
                  ORDER BY pog.position)
                  FROM product_option_groups pog JOIN option_groups g ON g.id = pog.group_id
                 WHERE pog.product_id = p.id AND g.active), '[]') AS groups
           FROM menu_items mi
           JOIN products p ON p.id = mi.product_id
           JOIN categories c ON c.id = p.category_id
          WHERE mi.menu_id = $1 AND p.active AND c.active
          ORDER BY c.position, p.position, p.name`,
        [menuId],
      );
      const items: LocalItem[] = rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        price: r.price,
        categoryId: r.category_id,
        available: !r.sold_out,
        imageId: r.image_id,
        position: r.position,
        groups: r.groups,
      }));
      const mapRows = await q<{
        entity: 'category' | 'item' | 'image';
        local_id: string;
        remote_id: string;
        extra: Partial<ItemIds>;
        shape_hash: string | null;
        offer_hash: string | null;
        status: IfoodStatus;
      }>(
        tx,
        `SELECT entity, local_id, remote_id, extra, shape_hash, offer_hash, status FROM ifood_sync_map WHERE menu_id = $1`,
        [menuId],
      );
      const map = {
        category: new Map<string, MapRow>(),
        item: new Map<string, MapRow>(),
        image: new Map<string, MapRow>(),
      };
      for (const r of mapRows)
        map[r.entity].set(r.local_id, {
          remoteId: r.remote_id,
          extra: r.extra,
          shapeHash: r.shape_hash,
          offerHash: r.offer_hash,
          status: r.status,
        });
      const imageIds = [...new Set(items.map((i) => i.imageId).filter((x): x is string => !!x))];
      const media = new Map(
        (
          await q<{ id: string; content_type: string }>(
            tx,
            `SELECT id, content_type FROM media WHERE id = ANY($1::uuid[])`,
            [imageIds],
          )
        ).map((m) => [m.id, m]),
      );
      return { categories, items, map, media };
    });
  }
}

function itemIdsOf(row: MapRow): ItemIds {
  return {
    productId: row.extra.productId ?? '',
    groups: row.extra.groups ?? {},
    options: row.extra.options ?? {},
  };
}
