import { Global, Module } from '@nestjs/common';
import {
  AsaasWebhookController,
  BillingAdminController,
  PublicPlansController,
  TenantBillingController,
} from './billing.controller';
import { BillingGuard } from './billing.guard';
import { BillingService } from './billing.service';
import { LifecycleMailService } from './lifecycle-mail.service';

/** Cobrança da assinatura (Asaas) e bloqueio automático: ver docs/cobranca.md. */
@Global()
@Module({
  controllers: [
    BillingAdminController,
    AsaasWebhookController,
    TenantBillingController,
    PublicPlansController,
  ],
  providers: [BillingService, BillingGuard, LifecycleMailService],
  exports: [BillingService, BillingGuard, LifecycleMailService],
})
export class BillingModule {}
