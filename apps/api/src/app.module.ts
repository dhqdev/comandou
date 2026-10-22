import { DynamicModule, Module, OnApplicationShutdown, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { CsrfGuard, PermissionGuard, SessionGuard } from './auth/auth.guards';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { maskSecretsInUrl } from './common/log-redact';
import { RedisThrottlerStorage } from './common/redis-throttler.storage';
import { ENV, Env } from './config/env';
import { DatabaseModule } from './database/database.module';
import { DomainsModule } from './domains/domains.module';
import { HealthModule } from './health/health.module';
import { MaintenanceModule } from './maintenance/maintenance.service';
import { PlansModule } from './plans/plans.module';
import { PlatformModule } from './platform/platform.module';
import { OperationsModule } from './orders/operations.module';
import { QueueModule } from './queue/queue.module';
import { RealtimeModule } from './realtime/realtime.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { TenantGuard } from './tenancy/tenant.guard';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    // Com Redis, o limite de requisições vale para todas as réplicas juntas.
    const throttleStorage = env.REDIS_URL
      ? new RedisThrottlerStorage(env.REDIS_URL, `${env.QUEUE_PREFIX}:throttle:`)
      : undefined;
    class ThrottleStorageLifecycle implements OnApplicationShutdown {
      async onApplicationShutdown() {
        await throttleStorage?.close();
      }
    }
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggerModule.forRoot({
          forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
          pinoHttp: {
            level: env.LOG_LEVEL,
            // Nunca registrar cookies, tokens ou senhas.
            redact: [
              'req.headers.cookie',
              'req.headers.authorization',
              'res.headers["set-cookie"]',
            ],
            serializers: {
              req: (req: { url?: string }) => ({ ...req, url: maskSecretsInUrl(req.url) }),
            },
            customProps: (req) => ({ tenant: (req as { tenant?: { slug: string } }).tenant?.slug }),
            autoLogging: { ignore: (req) => (req.url ?? '').includes('/health/') },
          },
        }),
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE }],
          storage: throttleStorage,
        }),
        DatabaseModule,
        AuditModule,
        TenancyModule,
        AuthModule,
        RealtimeModule,
        QueueModule,
        PlansModule,
        CatalogModule,
        OperationsModule,
        DomainsModule,
        HealthModule,
        PlatformModule,
        MaintenanceModule,
      ],
      providers: [
        { provide: ENV, useValue: env },
        ThrottleStorageLifecycle,
        // Ordem importa: rate limit → CSRF → tenant → sessão → permissão.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: TenantGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
      exports: [ENV],
    };
  }
}
