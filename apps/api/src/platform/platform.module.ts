import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { PlatformAuthService, PlatformHostGuard, PlatformSessionGuard } from './platform-auth';
import {
  PlatformAuthController,
  PlatformController,
  PlatformServerController,
} from './platform.controller';
import { ServerAgentClient } from './server-agent.service';
import { PlatformDb } from './platform-db.service';
import { PlatformService } from './platform.service';

/** Painel Super Admin (admin.<domínio base>): caminho privilegiado separado e auditado. */
@Module({
  imports: [HealthModule],
  controllers: [PlatformAuthController, PlatformController, PlatformServerController],
  providers: [
    PlatformDb,
    PlatformAuthService,
    PlatformService,
    PlatformHostGuard,
    PlatformSessionGuard,
    ServerAgentClient,
  ],
})
export class PlatformModule {}
