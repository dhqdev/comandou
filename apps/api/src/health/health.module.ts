import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HealthChecks } from './checks.service';
import { HealthController } from './health.controller';
import { Metrics, MetricsController, MetricsMiddleware } from './metrics';
import { SiteHealthController } from './site-health.controller';

@Module({
  controllers: [HealthController, SiteHealthController, MetricsController],
  providers: [HealthChecks, Metrics],
  exports: [HealthChecks, Metrics],
})
export class HealthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware).forRoutes('*');
  }
}
