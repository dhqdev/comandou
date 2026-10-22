import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { PlatformAuthService, PlatformHostGuard, PlatformSessionGuard } from './platform-auth';
import { PlatformAuthController, PlatformController } from './platform.controller';
import { PlatformDb } from './platform-db.service';
import { PlatformService } from './platform.service';

/** Painel Super Admin (admin.<domínio base>): caminho privilegiado separado e auditado. */
@Module({
  imports: [HealthModule],
  controllers: [PlatformAuthController, PlatformController],
  providers: [
    PlatformDb,
    PlatformAuthService,
    PlatformService,
    PlatformHostGuard,
    PlatformSessionGuard,
  ],
})
export class PlatformModule {}
