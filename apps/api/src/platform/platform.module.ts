import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import {
  PlatformAiController,
  PlatformAuthController,
  PlatformCepController,
  PlatformController,
  PlatformReceiveController,
  PlatformServerController,
} from './platform.controller';
import { ReleaseFeed, ServerAgentClient } from './server-agent.service';
import { PlatformService } from './platform.service';
import { PlatformBackupService } from './platform-backup.service';
import { PlatformAiService } from './platform-ai.service';
import { PlatformDatabasesService } from './platform-databases.service';
import { PlatformDbServersService } from './platform-db-servers.service';
import { PlatformMigrationsService } from './platform-migrations.service';
import { PlatformReceiveService } from './platform-receive.service';
import { PlatformVersionsService } from './platform-versions.service';
import { ContractSignController, ContractsController } from './contracts/contracts.controller';
import { ContractsService } from './contracts/contracts.service';
import { QuotesController } from './quotes/quotes.controller';
import { QuotesService } from './quotes/quotes.service';
import { PlatformSitesService } from './platform-sites.service';
import { GatewayClient } from '../messaging/gateway.client';
import { PlatformKitchenService } from './platform-kitchen.service';
import { CepService } from '../store/cep.service';

/** Painel Super Admin (admin.<domínio base>): caminho privilegiado separado e auditado. */
@Module({
  imports: [HealthModule],
  controllers: [
    PlatformAuthController,
    PlatformCepController,
    PlatformController,
    PlatformAiController,
    PlatformServerController,
    PlatformReceiveController,
    ContractsController,
    QuotesController,
    ContractSignController,
  ],
  providers: [
    PlatformService,
    PlatformBackupService,
    PlatformAiService,
    PlatformDatabasesService,
    PlatformDbServersService,
    PlatformMigrationsService,
    PlatformReceiveService,
    PlatformVersionsService,
    ContractsService,
    QuotesService,
    PlatformSitesService,
    PlatformKitchenService,
    CepService,
    GatewayClient,
    ServerAgentClient,
    ReleaseFeed,
  ],
})
export class PlatformModule {}
