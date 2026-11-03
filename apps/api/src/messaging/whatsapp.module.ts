import { Module } from '@nestjs/common';
import { GatewayClient } from './gateway.client';
import { WhatsAppInboundService } from './whatsapp-inbound.service';
import { WhatsAppInternalController } from './whatsapp-internal.controller';

/**
 * Conexão do WhatsApp por QR Code (gateway Baileys): cliente do gateway (enviar, "digitando...",
 * lido, reação, online) e a entrada das mensagens recebidas. Quem atende o cliente importa este
 * módulo e se registra em WhatsAppInboundService.onMessage.
 */
@Module({
  controllers: [WhatsAppInternalController],
  providers: [GatewayClient, WhatsAppInboundService],
  exports: [GatewayClient, WhatsAppInboundService],
})
export class WhatsAppModule {}
