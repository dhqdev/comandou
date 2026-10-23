import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { PlatformAuthService, PlatformHostGuard, PlatformSessionGuard } from './platform-auth';
import {
  PlatformAuthController,
  PlatformController,
  PlatformServerController,
} from './platform.controller';
import { ReleaseFeed, ServerAgentClient } from './server-agent.service';
import { PlatformDb } from './platform-db.service';
import { PlatformService } from './platform.service';
import { PlatformBackupService } from './platform-backup.service';
import { PlatformDatabasesService } from './platform-databases.service';

/** Painel Super Admin (admin.<domínio base>): caminho privilegiado separado e auditado. */
@Module({
  imports: [HealthModule],
  controllers: [PlatformAuthController, PlatformController, PlatformServerController],
  providers: [
    PlatformDb,
    PlatformAuthService,
    PlatformService,
    PlatformBackupService,
    PlatformDatabasesService,
    PlatformHostGuard,
    PlatformSessionGuard,
    ServerAgentClient,
    ReleaseFeed,
  ],
})
export class PlatformModule {}
