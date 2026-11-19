import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { LiveChangesInterceptor } from './live-changes.interceptor';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

@Global()
@Module({
  imports: [AuthModule, TenancyModule],
  providers: [
    RealtimeService,
    RealtimeGateway,
    // Gravação em área sem evento próprio avisa as outras telas abertas.
    { provide: APP_INTERCEPTOR, useClass: LiveChangesInterceptor },
  ],
  exports: [RealtimeService],
})
export class RealtimeModule {}
