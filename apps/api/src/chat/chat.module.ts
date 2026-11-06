import { Module } from '@nestjs/common';
import { WhatsAppModule } from '../messaging/whatsapp.module';
import { AiAgentController } from './ai-agent.controller';
import { AiAgentService } from './ai-agent.service';
import { AiService } from './ai.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/**
 * Chat interno da equipe (conversas, mural, avisos), o assistente de IA, a IA que atende o
 * cliente (configurada pelo gerente).
 */
@Module({
  imports: [WhatsAppModule],
  controllers: [ChatController, AiAgentController],
  providers: [ChatService, AiService, AiAgentService],
  exports: [ChatService, AiAgentService],
})
export class ChatModule {}
