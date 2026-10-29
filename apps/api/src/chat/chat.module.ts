import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { MascotController } from './mascot.controller';

/** Chat interno da equipe (conversas, mural, avisos), o assistente de IA e a roupinha do panda. */
@Module({
  controllers: [ChatController, MascotController],
  providers: [ChatService, AiService],
  exports: [ChatService],
})
export class ChatModule {}
