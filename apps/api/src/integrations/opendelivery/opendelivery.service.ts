import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { channelInfo, isCustomOd, withArticle } from '@comandou/shared';
import { AuditService } from '../../audit/audit.service';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { ChannelHttpError, ChannelRegistry } from '../channels/channel-adapter';
import { ChannelCredentials } from '../channels/channel-credentials.service';
import type { Fetcher } from '../channels/channel-http';
import { ChannelMetrics } from '../channels/channel-metrics';
import { ChannelStoresService } from '../channels/channel-stores.service';
import {
  FOOD99_DIALECT,
  KEETA_DIALECT,
  OPEN_DELIVERY_DIALECT,
  OpenDeliveryAdapter,
  customOdDialect,
  odCredential,
} from './od.adapter';

/** Canais do padrão Open Delivery que o restaurante liga pelo Comandou. */
export const OD_CHANNELS = ['keeta', '99food', 'opendelivery'] as const;
export type OdChannel = (typeof OD_CHANNELS)[number];
/** De quanto em quanto tempo os aplicativos Open Delivery cadastrados no Super Admin são relidos. */
const CUSTOM_SYNC_MS = 60_000;
/** Canais em que o restaurante liga a loja pelo código do aplicativo (Open Delivery e Rappi). */
export const CONNECT_CHANNELS = [...OD_CHANNELS, 'rappi'] as const;
export type ConnectChannel = (typeof CONNECT_CHANNELS)[number];
const NUMERIC_STORE = new Set<string>(['keeta', '99food', 'rappi']);

/** O que ligar a loja precisa do adaptador (Open Delivery e Rappi implementam). */
interface Connectable {
  onboard(storeId: string, channelStoreId: string): Promise<void>;
  dialect?: { token: string };
}

/**
 * Keeta, 99Food e Open Delivery (ADR 0015, Fases 10 e 11): registra os adaptadores na camada de
 * canais e liga as lojas. Na Keeta, ligar faz o cadastro (merchantOnboarding) com o código da loja
 * no portal da Keeta; na 99Food, confere que a loja está vinculada ao app do Comandou (token da
 * loja); no padrão, a loja é o id que o aplicativo deu. Receber pedidos começa desligado.
 */
@Injectable()
export class OpenDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('OpenDelivery');
  readonly adapters: Record<OdChannel, OpenDeliveryAdapter>;
  /** Aplicativos Open Delivery cadastrados no Super Admin (`od-<nome>`), pelo nome em uso. */
  private readonly custom = new Map<string, string>();
  private timer?: NodeJS.Timeout;
  /** Trocado nos testes. */
  fetcher: Fetcher = (...a) => fetch(...a);

  constructor(
    @Inject(ENV) env: Env,
    private readonly creds: ChannelCredentials,
    private readonly metrics: ChannelMetrics,
    private readonly registry: ChannelRegistry,
    private readonly stores: ChannelStoresService,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {
    const f = () => this.fetcher;
    this.adapters = {
      keeta: new OpenDeliveryAdapter(
        KEETA_DIALECT,
        creds,
        metrics,
        async () => env.KEETA_API_URL,
        f,
      ),
      '99food': new OpenDeliveryAdapter(
        FOOD99_DIALECT,
        creds,
        metrics,
        async () => env.FOOD99_API_URL,
        f,
      ),
      opendelivery: new OpenDeliveryAdapter(
        OPEN_DELIVERY_DIALECT,
        creds,
        metrics,
        async () => (await creds.get('opendelivery'))?.baseUrl ?? null,
        f,
      ),
    };
  }

  onModuleInit() {
    for (const a of Object.values(this.adapters)) this.registry.register(a);
    void this.syncCustom().catch(() => undefined);
    this.timer = setInterval(() => void this.syncCustom().catch(() => undefined), CUSTOM_SYNC_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Outros aplicativos Open Delivery: cada credencial `od-<nome>` do Super Admin vira um adaptador
   * do padrão (mesmo polling, ack e ações), sem código novo. Apagado lá, sai daqui.
   */
  async syncCustom() {
    const list = await this.creds.customOd();
    const seen = new Set<string>();
    for (const c of list) {
      seen.add(c.channel);
      if (this.custom.get(c.channel) === c.name && this.registry.get(c.channel)) continue;
      const channel = c.channel;
      this.registry.register(
        new OpenDeliveryAdapter(
          customOdDialect(channel, c.name),
          this.creds,
          this.metrics,
          async () => (await this.creds.get(channel))?.baseUrl ?? null,
          () => this.fetcher,
        ),
      );
      this.custom.set(channel, c.name);
      this.logger.log(`aplicativo Open Delivery ${channel} pronto`);
    }
    for (const channel of [...this.custom.keys()])
      if (!seen.has(channel)) {
        this.registry.unregister(channel);
        this.custom.delete(channel);
      }
    return list;
  }

  /** Liga uma loja do aplicativo a este restaurante (e, na Keeta, faz o cadastro dela lá). */
  async connect(
    tenantId: string,
    userId: string,
    b: { channel: string; storeId: string; name: string },
    ip?: string,
  ) {
    // Aplicativo cadastrado agora há pouco no Super Admin: não espera a próxima releitura.
    if (isCustomOd(b.channel) && !this.registry.get(b.channel)) await this.syncCustom();
    const adapter = this.registry.get(b.channel) as
      (Connectable & { label?: string; capabilities?: unknown }) | undefined;
    if (!adapter || typeof adapter.onboard !== 'function')
      throw new BadRequestException('Aplicativo não disponível neste servidor');
    const label = channelInfo(b.channel, adapter.label).label;
    const storeId = b.storeId.trim().toLowerCase();
    if (NUMERIC_STORE.has(b.channel) && !/^\d{1,20}$/.test(storeId))
      throw new BadRequestException(`O código da loja ${withArticle(label, 'no')} tem só números`);
    try {
      // Keeta: o id da loja no Comandou é o próprio código da Keeta (é ele que vai no polling).
      // 99Food: é o id que o app do Comandou deu à loja ao vincular (o mesmo número da loja).
      await adapter.onboard(storeId, storeId);
    } catch (e) {
      const status = e instanceof ChannelHttpError ? e.status : 0;
      const perStore = adapter.dialect?.token === 'store';
      throw new UnprocessableEntityException(
        perStore && status >= 400 && status < 500
          ? `A loja ainda não está vinculada ao Comandou na ${label}, ou o código está errado. Peça o vínculo ao suporte do Comandou.`
          : status === 401
            ? `${withArticle(label, 'O')} recusou as chaves do Comandou. Fale com o suporte.`
            : status === 403 || status === 404
              ? `A loja ainda não autorizou o Comandou no portal ${withArticle(label, 'do')}, ou o código está errado.`
              : `Não deu para falar com ${withArticle(label, 'o')} agora. Tente de novo em alguns minutos.`,
      );
    }
    const row = await this.stores.connect(tenantId, userId, {
      channel: b.channel,
      storeId,
      name: b.name.trim() || `Loja ${label}`,
      credential: odCredential(b.channel),
    });
    await this.db.withTenant({ tenantId, userId }, (tx) =>
      this.audit.record(tx, {
        tenantId,
        actorUserId: userId,
        action: 'channel.store_connected',
        entity: 'channel_store',
        entityId: row.id,
        data: { channel: b.channel },
        ip,
      }),
    );
    this.realtime.publish(tenantId, { type: 'channels.changed' });
    return row;
  }
}
