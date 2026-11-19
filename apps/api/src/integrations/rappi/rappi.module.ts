import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { RappiWebhookController } from './rappi.controller';
import { RappiService } from './rappi.service';

/** Rappi (ADR 0015, Fase 12): pedidos por polling e os webhooks assinados. */
@Module({
  imports: [ChannelsModule],
  controllers: [RappiWebhookController],
  providers: [RappiService],
  exports: [RappiService],
})
export class RappiModule {}
