import { Injectable, Logger, Optional } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';

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
/** a mesma mensagem não é tratada duas vezes nesse prazo (todas as réplicas, pelo Redis) */
const SEEN_TTL_S = 24 * 3600;
/** quanto a resposta ao gateway espera a mensagem ser tratada (o gateway espera até 60 s) */
export const RECEIVE_WAIT_MS = 45_000;

/**
 * Ponto de entrada das mensagens recebidas no WhatsApp. Quem atende (ex.: a IA) se registra com
 * onMessage(handler).
 *
 * - Repetição: o gateway pode repetir uma entrega (API lenta ou fora do ar). A mesma mensagem
 *   (restaurante + id) só é repassada uma vez, mesmo com várias réplicas da API (Redis).
 * - Ordem: as mensagens de uma conversa são tratadas uma de cada vez, na ordem. A resposta ao
 *   gateway só sai depois de tratar a mensagem (até RECEIVE_WAIT_MS), e o gateway só manda a
 *   próxima mensagem da mesma conversa depois dessa resposta: assim a ordem vale mesmo quando
 *   duas mensagens seguidas caem em réplicas diferentes da API.
 */
@Injectable()
export class WhatsAppInboundService {
  private readonly logger = new Logger('WhatsAppInbound');
  private readonly handlers: InboundHandler[] = [];
  private readonly seen = new Set<string>();
  /** fila por conversa: a próxima mensagem espera a anterior terminar */
  private readonly chains = new Map<string, Promise<void>>();

  constructor(@Optional() private readonly queue?: QueueService) {}

  onMessage(handler: InboundHandler) {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  /** Recebe do controller interno e espera a mensagem ser tratada (até RECEIVE_WAIT_MS). */
  async receive(msg: WhatsAppInbound, waitMs = RECEIVE_WAIT_MS): Promise<{ accepted: boolean }> {
    const key = `${msg.tenantId}:${msg.id}`;
    if (this.seen.has(key)) return { accepted: false };
    this.seen.add(key);
    if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.values().next().value as string);
    if ((await this.queue?.claimOnce(`wa-in:${key}`, SEEN_TTL_S)) === false)
      return { accepted: false }; // outra réplica já recebeu
    const chat = `${msg.tenantId}:${msg.jid}`;
    const prev = this.chains.get(chat) ?? Promise.resolve();
    const next = prev.then(() => this.dispatch(msg));
    this.chains.set(chat, next);
    void next.finally(() => {
      if (this.chains.get(chat) === next) this.chains.delete(chat);
    });
    let t: NodeJS.Timeout | undefined;
    await Promise.race([
      next,
      new Promise<void>((resolve) => {
        t = setTimeout(resolve, waitMs); // demorou: libera o gateway e segue tratando aqui
      }),
    ]);
    clearTimeout(t);
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
