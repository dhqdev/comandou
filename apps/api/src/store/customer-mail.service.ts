import { Injectable } from '@nestjs/common';
import { MailService } from '../mail/mail.service';

export interface CustomerEmail {
  /** O que é o e-mail (aparece em Super Admin › E-mail › Envios). */
  event: string;
  tenantId: string;
  to: string;
  toName?: string | null;
  /** Nome do remetente: o restaurante. */
  fromName: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * E-mails para os clientes dos restaurantes (hoje, o código de nova senha). Saem pelo envio do
 * próprio Comandou (Super Admin › E-mail), com o nome do restaurante como remetente. O conteúdo
 * tem um código: fica cifrado na fila e é apagado assim que sai. Sem envio configurado, não
 * manda nada.
 */
@Injectable()
export class CustomerMailService {
  constructor(private readonly mail: MailService) {}

  /** Dá para mandar e-mail ao cliente? */
  ready() {
    return this.mail.ready();
  }

  /** Envia na hora; devolve false se não há envio configurado ou se o provedor não aceitou. */
  async send(m: CustomerEmail): Promise<boolean> {
    if (!(await this.mail.ready())) return false;
    try {
      const r = await this.mail.send({
        kind: m.event,
        tenantId: m.tenantId,
        from: { name: m.fromName },
        to: [{ email: m.to, name: m.toName ?? undefined }],
        subject: m.subject,
        html: m.html,
        text: m.text,
        sensitive: true,
      });
      return r.ok;
    } catch {
      return false;
    }
  }
}
