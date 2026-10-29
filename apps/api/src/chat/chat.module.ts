import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/** Chat interno da equipe (conversas, mural, avisos) e o assistente de IA. */
@Module({
  controllers: [ChatController],
  providers: [ChatService, AiService],
  exports: [ChatService],
})
export class ChatModule {}
