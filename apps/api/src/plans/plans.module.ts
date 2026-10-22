import { Global, Module } from '@nestjs/common';
import { PlanService } from './plan.service';
import { SubscriptionController } from './subscription.controller';

/** Plano e limites do restaurante: disponível para todos os módulos que criam recursos. */
@Global()
@Module({
  controllers: [SubscriptionController],
  providers: [PlanService],
  exports: [PlanService],
})
export class PlansModule {}
