import { Global, Module } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { MailController, MailInboundController, PublicBookingController } from './mail.controller';
import { MailService } from './mail.service';
import { MailboxService } from './mailbox.service';

/**
 * E-mail próprio do Comandou (Super Admin › E-mail): a fila de saída que todo o sistema usa
 * (`MailService`), as caixas do domínio, a agenda e a página de agendamento. Global porque quem
 * manda e-mail está em vários módulos (site, contratos, cardápio online).
 */
@Global()
@Module({
  controllers: [MailController, MailInboundController, PublicBookingController],
  providers: [MailService, MailboxService, CalendarService],
  exports: [MailService],
})
export class MailModule {}
