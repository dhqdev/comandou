import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { WhatsAppModule } from '../messaging/whatsapp.module';
import { PlatformModule } from '../platform/platform.module';
import { PlatformWaAlerts } from './admin-alerts.service';
import { PlatformWaBot } from './admin-bot.service';
import { PlatformWaChecks } from './admin-checks.service';
import { PlatformWaMenuSettings } from './admin-menu-settings.service';
import { PlatformWhatsAppController } from './platform-whatsapp.controller';
import { PlatformWhatsAppService } from './platform-whatsapp.service';
import { PlatformWaOutbox } from './platform-wa-outbox.service';

/**
 * Super Admin › WhatsApp: número próprio do painel no gateway Baileys e as conversas dele, mais o
 * menu do Super Admin (números cadastrados), os avisos automáticos e o resumo do dia.
 */
@Module({
  imports: [WhatsAppModule, PlatformModule, HealthModule],
  controllers: [PlatformWhatsAppController],
  providers: [
    PlatformWhatsAppService,
    PlatformWaOutbox,
    PlatformWaChecks,
    PlatformWaBot,
    PlatformWaAlerts,
    PlatformWaMenuSettings,
  ],
})
export class PlatformWhatsAppModule {}
