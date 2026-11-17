import { Global, Module } from '@nestjs/common';
import { MailAdminService } from './mail-admin.service';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';

/**
 * E-mail do Comandou (Super Admin › E-mail): a fila de saída que todo o sistema usa
 * (`MailService`), que entrega pelo Resend, e a tela de configuração e envios. Global porque
 * quem manda e-mail está em vários módulos (site, contratos, cardápio online).
 */
@Global()
@Module({
  controllers: [MailController],
  providers: [MailService, MailAdminService],
  exports: [MailService],
})
export class MailModule {}
