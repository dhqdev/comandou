import {
  BadRequestException,
  Inject,
  Injectable,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { channelInfo, withArticle } from '@comandou/shared';
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
  odCredential,
} from './od.adapter';

/** Canais do padrão Open Delivery que o restaurante liga pelo Comandou. */
export const OD_CHANNELS = ['keeta', '99food', 'opendelivery'] as const;
export type OdChannel = (typeof OD_CHANNELS)[number];

/**
 * Keeta, 99Food e Open Delivery (ADR 0015, Fases 10 e 11): registra os adaptadores na camada de
 * canais e liga as lojas. Na Keeta, ligar faz o cadastro (merchantOnboarding) com o código da loja
 * no portal da Keeta; na 99Food, confere que a loja está vinculada ao app do Comandou (token da
 * loja); no padrão, a loja é o id que o aplicativo deu. Receber pedidos começa desligado.
 */
@Injectable()
export class OpenDeliveryService implements OnModuleInit {
  readonly adapters: Record<OdChannel, OpenDeliveryAdapter>;
  /** Trocado nos testes. */
  fetcher: Fetcher = (...a) => fetch(...a);

  constructor(
    @Inject(ENV) env: Env,
    creds: ChannelCredentials,
    metrics: ChannelMetrics,
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
  }

  /** Liga uma loja do aplicativo a este restaurante (e, na Keeta, faz o cadastro dela lá). */
  async connect(
    tenantId: string,
    userId: string,
    b: { channel: OdChannel; storeId: string; name: string },
    ip?: string,
  ) {
    const adapter = this.adapters[b.channel];
    const label = channelInfo(b.channel).label;
    const storeId = b.storeId.trim().toLowerCase();
    if ((b.channel === 'keeta' || b.channel === '99food') && !/^\d{1,20}$/.test(storeId))
      throw new BadRequestException(`O código da loja na ${label} tem só números`);
    try {
      // Keeta: o id da loja no Comandou é o próprio código da Keeta (é ele que vai no polling).
      // 99Food: é o id que o app do Comandou deu à loja ao vincular (o mesmo número da loja).
      await adapter.onboard(storeId, storeId);
    } catch (e) {
      const status = e instanceof ChannelHttpError ? e.status : 0;
      const perStore = adapter.dialect.token === 'store';
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
