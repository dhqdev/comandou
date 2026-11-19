import { Module } from '@nestjs/common';
import { WhatsAppModule } from '../messaging/whatsapp.module';
import { PlatformWhatsAppController } from './platform-whatsapp.controller';
import { PlatformWhatsAppService } from './platform-whatsapp.service';

/** Super Admin › WhatsApp: número próprio do painel no gateway Baileys e as conversas dele. */
@Module({
  imports: [WhatsAppModule],
  controllers: [PlatformWhatsAppController],
  providers: [PlatformWhatsAppService],
})
export class PlatformWhatsAppModule {}
