import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { IfoodOrdersAdapter } from './ifood-orders.adapter';
import { IfoodCatalogService } from './ifood-catalog.service';
import { IfoodController } from './ifood.controller';
import { IfoodService } from './ifood.service';

/** iFood: cardápio (catálogo v2) e pedidos (adaptador da camada de canais, ADR 0015). */
@Module({
  imports: [ChannelsModule],
  controllers: [IfoodController],
  providers: [IfoodService, IfoodCatalogService, IfoodOrdersAdapter],
  exports: [IfoodService, IfoodCatalogService],
})
export class IfoodModule {}
