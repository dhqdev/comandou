import { Global, Module } from '@nestjs/common';
import { PlatformAuthService, PlatformHostGuard, PlatformSessionGuard } from './platform-auth';
import { PlatformDb } from './platform-db.service';

/** Pool da plataforma e guardas do painel, compartilhados pelo painel e pela cobrança. */
@Global()
@Module({
  providers: [PlatformDb, PlatformAuthService, PlatformHostGuard, PlatformSessionGuard],
  exports: [PlatformDb, PlatformAuthService, PlatformHostGuard, PlatformSessionGuard],
})
export class PlatformDbModule {}
