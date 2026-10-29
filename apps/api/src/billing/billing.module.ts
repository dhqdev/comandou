import { Global, Module } from '@nestjs/common';
import {
  AsaasWebhookController,
  BillingAdminController,
  TenantBillingController,
} from './billing.controller';
import { BillingGuard } from './billing.guard';
import { BillingService } from './billing.service';

/** Cobrança da assinatura (Asaas) e bloqueio automático: ver docs/cobranca.md. */
@Global()
@Module({
  controllers: [BillingAdminController, AsaasWebhookController, TenantBillingController],
  providers: [BillingService, BillingGuard],
  exports: [BillingService, BillingGuard],
})
export class BillingModule {}
