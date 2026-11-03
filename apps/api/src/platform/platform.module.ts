import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import {
  PlatformAiController,
  PlatformAuthController,
  PlatformController,
  PlatformServerController,
} from './platform.controller';
import { ReleaseFeed, ServerAgentClient } from './server-agent.service';
import { PlatformService } from './platform.service';
import { PlatformBackupService } from './platform-backup.service';
import { PlatformAiService } from './platform-ai.service';
import { PlatformDatabasesService } from './platform-databases.service';
import { PlatformDbServersService } from './platform-db-servers.service';
import { ContractSignController, ContractsController } from './contracts/contracts.controller';
import { ContractsService } from './contracts/contracts.service';
import { PlatformSitesService } from './platform-sites.service';
import { GatewayClient } from '../messaging/gateway.client';

/** Painel Super Admin (admin.<domínio base>): caminho privilegiado separado e auditado. */
@Module({
  imports: [HealthModule],
  controllers: [
    PlatformAuthController,
    PlatformController,
    PlatformAiController,
    PlatformServerController,
    ContractsController,
    ContractSignController,
  ],
  providers: [
    PlatformService,
    PlatformBackupService,
    PlatformAiService,
    PlatformDatabasesService,
    PlatformDbServersService,
    ContractsService,
    PlatformSitesService,
    GatewayClient,
    ServerAgentClient,
    ReleaseFeed,
  ],
})
export class PlatformModule {}
