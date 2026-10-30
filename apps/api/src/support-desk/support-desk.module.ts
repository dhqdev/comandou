import { Module } from '@nestjs/common';
import { HelpChatController, PlatformSupportController } from './support-desk.controller';
import { SupportDeskService } from './support-desk.service';

/** Conversa de cada restaurante com a Comandou (aba Suporte) e o Super Admin › Conversas. */
@Module({
  controllers: [HelpChatController, PlatformSupportController],
  providers: [SupportDeskService],
})
export class SupportDeskModule {}
