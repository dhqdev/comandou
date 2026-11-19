import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { AiqfomeCallbackController, AiqfomeController } from './aiqfome.controller';
import { AiqfomeService } from './aiqfome.service';

/** aiqfome (ADR 0015, Fase 13): a loja autoriza no ID Magalu; pedidos por polling (Open Delivery). */
@Module({
  imports: [ChannelsModule],
  controllers: [AiqfomeController, AiqfomeCallbackController],
  providers: [AiqfomeService],
  exports: [AiqfomeService],
})
export class AiqfomeModule {}
