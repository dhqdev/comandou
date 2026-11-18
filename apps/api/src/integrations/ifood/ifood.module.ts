import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { IfoodOrdersAdapter } from './ifood-orders.adapter';
import { IfoodController } from './ifood.controller';
import { IfoodService } from './ifood.service';

/** iFood: cardápio (catálogo v2) e pedidos (adaptador da camada de canais, ADR 0015). */
@Module({
  imports: [ChannelsModule],
  controllers: [IfoodController],
  providers: [IfoodService, IfoodOrdersAdapter],
  exports: [IfoodService],
})
export class IfoodModule {}
