import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { OpenDeliveryController } from './opendelivery.controller';
import { OpenDeliveryService } from './opendelivery.service';

/** Keeta e aplicativos do padrão Open Delivery (ADR 0015, Fase 10). */
@Module({
  imports: [ChannelsModule],
  controllers: [OpenDeliveryController],
  providers: [OpenDeliveryService],
  exports: [OpenDeliveryService],
})
export class OpenDeliveryModule {}
