import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HealthChecks } from './checks.service';
import { HealthController } from './health.controller';
import { Metrics, MetricsController, MetricsMiddleware } from './metrics';

@Module({
  controllers: [HealthController, MetricsController],
  providers: [HealthChecks, Metrics],
  exports: [HealthChecks, Metrics],
})
export class HealthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware).forRoutes('*');
  }
}
