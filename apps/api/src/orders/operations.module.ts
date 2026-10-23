import { Module } from '@nestjs/common';
import { DeliveryController } from '../delivery/delivery.controller';
import { DeliveryService } from '../delivery/delivery.service';
import { GeocoderService } from '../delivery/geocoder.service';
import { ZonesController } from '../delivery/zones.controller';
import { ZonesService } from '../delivery/zones.service';
import { FinanceController } from '../finance/finance.controller';
import { FiscalController } from '../fiscal/fiscal.controller';
import { FiscalService } from '../fiscal/fiscal.service';
import { FocusClient } from '../fiscal/focus.client';
import { MessagingController } from '../messaging/messaging.controller';
import { GatewayClient } from '../messaging/gateway.client';
import { MessagingService } from '../messaging/messaging.service';
import { WhatsAppClient } from '../messaging/whatsapp.client';
import { PrintAgentController, PrintingController } from '../printing/printing.controller';
import { PrintingService } from '../printing/printing.service';
import { StockController } from '../stock/stock.controller';
import { StockService } from '../stock/stock.service';
import { UsersController } from '../users/users.controller';
import { CashController } from '../cash/cash.controller';
import { CashService } from '../cash/cash.service';
import { KitchenController } from '../kitchen/kitchen.controller';
import { KitchenService } from '../kitchen/kitchen.service';
import { ReportsController } from '../reports/reports.controller';
import { SetupController } from '../setup/setup.controller';
import { TabsController } from '../tables/tabs.controller';
import { TabsService } from '../tables/tabs.service';
import { AccountController, CustomersController } from '../store/account.controller';
import { CustomersService } from '../store/customers.service';
import { MediaController, StoreController } from '../store/store.controller';
import { StoreService } from '../store/store.service';
import { SearchController } from '../search/search.controller';
import { OrdersController, PaymentsController } from './orders.controller';
import { OrdersService } from './orders.service';

/** Operação e retaguarda do restaurante: pedidos, salão, cozinha, caixa, estoque, entregas, impressão, financeiro, equipe, nota fiscal e WhatsApp. */
@Module({
  controllers: [
    OrdersController,
    PaymentsController,
    TabsController,
    KitchenController,
    CashController,
    ReportsController,
    SetupController,
    StockController,
    DeliveryController,
    ZonesController,
    PrintingController,
    PrintAgentController,
    FinanceController,
    UsersController,
    FiscalController,
    MessagingController,
    StoreController,
    MediaController,
    AccountController,
    CustomersController,
    SearchController,
  ],
  providers: [
    OrdersService,
    CashService,
    TabsService,
    KitchenService,
    StockService,
    PrintingService,
    DeliveryService,
    ZonesService,
    GeocoderService,
    FiscalService,
    FocusClient,
    MessagingService,
    WhatsAppClient,
    GatewayClient,
    StoreService,
    CustomersService,
  ],
})
export class OperationsModule {}
