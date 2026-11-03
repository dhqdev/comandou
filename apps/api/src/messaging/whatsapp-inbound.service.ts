import { Injectable, Logger } from '@nestjs/common';

export type InboundKind =
  'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contact' | 'other';

/** Mensagem que um cliente mandou para o WhatsApp do restaurante (vem do gateway Baileys). */
export interface WhatsAppInbound {
  tenantId: string;
  /** id da mensagem no WhatsApp (para GatewayClient.markRead / react) */
  id: string;
  /** conversa: responda para este JID (pode ser @lid, número escondido) */
  jid: string;
  /** número do cliente só com dígitos, quando o WhatsApp informa */
  from: string | null;
  kind: InboundKind;
  /** texto, legenda da mídia ou opção escolhida num botão/lista */
  text: string;
  pushName: string | null;
  timestamp: Date;
}

export type InboundHandler = (msg: WhatsAppInbound) => Promise<void> | void;

const SEEN_MAX = 5000;

/**
 * Ponto de entrada das mensagens recebidas no WhatsApp. Quem atende (ex.: a IA) se registra com
 * onMessage(handler). O gateway pode repetir uma entrega (API lenta ou fora do ar): a mesma
 * mensagem (restaurante + id) só é repassada uma vez. As mensagens de uma mesma conversa são
 * tratadas uma de cada vez, na ordem em que chegaram.
 */
@Injectable()
export class WhatsAppInboundService {
  private readonly logger = new Logger('WhatsAppInbound');
  private readonly handlers: InboundHandler[] = [];
  private readonly seen = new Set<string>();
  /** fila por conversa: a próxima mensagem espera a anterior terminar */
  private readonly chains = new Map<string, Promise<void>>();

  onMessage(handler: InboundHandler) {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  /** Recebe do controller interno; não espera os handlers (o gateway não fica preso). */
  receive(msg: WhatsAppInbound): { accepted: boolean } {
    const key = `${msg.tenantId}:${msg.id}`;
    if (this.seen.has(key)) return { accepted: false };
    this.seen.add(key);
    if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.values().next().value as string);
    const chat = `${msg.tenantId}:${msg.jid}`;
    const prev = this.chains.get(chat) ?? Promise.resolve();
    const next = prev.then(() => this.dispatch(msg));
    this.chains.set(chat, next);
    void next.finally(() => {
      if (this.chains.get(chat) === next) this.chains.delete(chat);
    });
    return { accepted: true };
  }

  /** Para testes: espera as conversas em andamento terminarem. */
  async idle() {
    while (this.chains.size) await Promise.all([...this.chains.values()]);
  }

  private async dispatch(msg: WhatsAppInbound) {
    for (const h of this.handlers) {
      try {
        await h(msg);
      } catch (e) {
        this.logger.error(
          `restaurante ${msg.tenantId}: falha ao tratar mensagem recebida (${(e as Error).message})`,
        );
      }
    }
  }
}
