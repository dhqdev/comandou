import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { PlatformTicketsController, TenantTicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

/** Chamados dos clientes e a esteira de desenvolvimento (ver docs/chamados.md). */
@Module({
  controllers: [TenantTicketsController, PlatformTicketsController],
  providers: [TicketsService, PipelineService],
})
export class TicketsModule {}
