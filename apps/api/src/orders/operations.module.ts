import { Module } from '@nestjs/common';
import { CourierPayController } from '../delivery/courier-pay.controller';
import { CourierPayService } from '../delivery/courier-pay.service';
import { DeliveryController } from '../delivery/delivery.controller';
import { DeliveryService } from '../delivery/delivery.service';
import { GeocoderService } from '../delivery/geocoder.service';
import { CepService } from '../store/cep.service';
import { ZonesController } from '../delivery/zones.controller';
import { ZonesService } from '../delivery/zones.service';
import { FinanceController } from '../finance/finance.controller';
import { FiscalController } from '../fiscal/fiscal.controller';
import { FiscalService } from '../fiscal/fiscal.service';
import { FiscalExtraService } from '../fiscal/fiscal-extra.service';
import { FiscalRulesService } from '../fiscal/fiscal-rules.service';
import { FocusClient } from '../fiscal/focus.client';
import { MessagingController } from '../messaging/messaging.controller';
import { WhatsAppModule } from '../messaging/whatsapp.module';
import { MessagingService } from '../messaging/messaging.service';
import { WhatsAppClient } from '../messaging/whatsapp.client';
import { PrintAgentController, PrintingController } from '../printing/printing.controller';
import { PrintingService } from '../printing/printing.service';
import { StockController } from '../stock/stock.controller';
import { StockService } from '../stock/stock.service';
import { StockOpsService } from '../stock/stock-ops.service';
import { StockSectionsController } from '../stock/stock-sections.controller';
import { UsersController } from '../users/users.controller';
import { CashController } from '../cash/cash.controller';
import { CashService } from '../cash/cash.service';
import { KitchenController } from '../kitchen/kitchen.controller';
import { KitchenService } from '../kitchen/kitchen.service';
import { ReportsController } from '../reports/reports.controller';
import {
  PublicReservationsController,
  ReservationsController,
} from '../reservations/reservations.controller';
import { ReservationsService } from '../reservations/reservations.service';
import { SetupController } from '../setup/setup.controller';
import { SalonController, TabsController } from '../tables/tabs.controller';
import { TabsService } from '../tables/tabs.service';
import { WaitersController } from '../tables/waiters.controller';
import { AccountController, CustomersController } from '../store/account.controller';
import { CustomersService } from '../store/customers.service';
import { MediaController, StoreController } from '../store/store.controller';
import { StoreService } from '../store/store.service';
import { SearchController } from '../search/search.controller';
import {
  PublicStoreChatController,
  SupportChatController,
} from '../store-chat/store-chat.controller';
import { StoreChatService } from '../store-chat/store-chat.service';
import { LoyaltyController } from '../loyalty/loyalty.controller';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { OrdersController, PaymentsController } from './orders.controller';
import { OrdersService } from './orders.service';

/** Operação e retaguarda do restaurante: pedidos, salão, cozinha, caixa, estoque, entregas, impressão, financeiro, equipe, nota fiscal e WhatsApp. */
@Module({
  imports: [WhatsAppModule],
  controllers: [
    OrdersController,
    PaymentsController,
    TabsController,
    SalonController,
    WaitersController,
    KitchenController,
    CashController,
    ReportsController,
    SetupController,
    StockController,
    StockSectionsController,
    DeliveryController,
    CourierPayController,
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
    ReservationsController,
    PublicReservationsController,
    LoyaltyController,
    PublicStoreChatController,
    SupportChatController,
  ],
  providers: [
    OrdersService,
    CashService,
    TabsService,
    KitchenService,
    StockService,
    StockOpsService,
    PrintingService,
    DeliveryService,
    CourierPayService,
    ZonesService,
    GeocoderService,
    CepService,
    FiscalService,
    FiscalRulesService,
    FiscalExtraService,
    FocusClient,
    MessagingService,
    WhatsAppClient,
    StoreService,
    CustomersService,
    ReservationsService,
    LoyaltyService,
    StoreChatService,
  ],
})
export class OperationsModule {}
