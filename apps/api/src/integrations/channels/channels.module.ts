import { Module } from '@nestjs/common';
import { HealthModule } from '../../health/health.module';
import { OperationsModule } from '../../orders/operations.module';
import { ChannelRegistry } from './channel-adapter';
import { ChannelInboxService } from './channel-inbox.service';
import { ChannelMetrics } from './channel-metrics';
import { ChannelOutboxService } from './channel-outbox.service';
import { ChannelPoller } from './channel-poller.service';
import { ChannelStoresService } from './channel-stores.service';
import { ChannelsController } from './channels.controller';
import { ExternalOrdersService } from './external-orders.service';

/**
 * Aplicativos de delivery (ADR 0015): a camada de canais. Os adaptadores de cada aplicativo se
 * registram no ChannelRegistry; daqui para dentro tudo é igual para todos os canais.
 */
@Module({
  imports: [OperationsModule, HealthModule],
  controllers: [ChannelsController],
  providers: [
    ChannelRegistry,
    ChannelMetrics,
    ChannelStoresService,
    ChannelOutboxService,
    ExternalOrdersService,
    ChannelInboxService,
    ChannelPoller,
  ],
  exports: [
    ChannelRegistry,
    ChannelMetrics,
    ChannelStoresService,
    ChannelOutboxService,
    ExternalOrdersService,
    ChannelInboxService,
    ChannelPoller,
  ],
})
export class ChannelsModule {}
