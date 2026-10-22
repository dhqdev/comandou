import { Module } from '@nestjs/common';
import { CashController } from '../cash/cash.controller';
import { CashService } from '../cash/cash.service';
import { KitchenController } from '../kitchen/kitchen.controller';
import { KitchenService } from '../kitchen/kitchen.service';
import { ReportsController } from '../reports/reports.controller';
import { SetupController } from '../setup/setup.controller';
import { TabsController } from '../tables/tabs.controller';
import { TabsService } from '../tables/tabs.service';
import { OrdersController, PaymentsController } from './orders.controller';
import { OrdersService } from './orders.service';

/** Operação do restaurante: pedidos, salão, cozinha, caixa e relatórios. */
@Module({
  controllers: [
    OrdersController,
    PaymentsController,
    TabsController,
    KitchenController,
    CashController,
    ReportsController,
    SetupController,
  ],
  providers: [OrdersService, CashService, TabsService, KitchenService],
})
export class OperationsModule {}
