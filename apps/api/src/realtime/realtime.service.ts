import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

export type RealtimeEvent =
  | { type: 'order.changed'; orderId: string; status?: string; version?: number }
  | { type: 'kitchen.changed'; orderId: string }
  // O Super Admin mudou as cozinhas ou o que a tela da cozinha mostra.
  | { type: 'kitchen.settings' }
  | { type: 'tab.changed'; tabId: string }
  | { type: 'cash.changed'; sessionId: string }
  | { type: 'menu.changed' }
  // Aplicativos de delivery: loja, evento ou item sem vínculo mudou (tela Integrações).
  | { type: 'channels.changed' }
  // Repasses e o que os pedidos dos aplicativos renderam foram lidos de novo.
  | { type: 'channels.finance' }
  // Avaliações dos aplicativos lidas de novo ou respondidas.
  | { type: 'channels.reviews' }
  // Sincronização de um cardápio com o iFood começou ou terminou.
  | { type: 'ifood.sync'; menuId: string }
  | { type: 'store.changed' }
  | { type: 'stock.changed' }
  | { type: 'delivery.changed'; deliveryId: string }
  | {
      type: 'delivery.location';
      deliveryId: string;
      lat: number;
      lng: number;
      heading: number | null;
      speed: number | null;
      at: string;
    }
  | { type: 'print.changed' }
  | { type: 'fiscal.changed'; documentId: string; orderId: string }
  | { type: 'reservation.changed'; reservationId: string }
  // Chat da equipe: só os ids; a tela busca o conteúdo pela API (que confere quem participa).
  | { type: 'chat.message'; conversationId: string; messageId: string; authorId: string | null }
  | { type: 'chat.changed'; conversationId?: string }
  | { type: 'chat.read'; conversationId: string; userId: string }
  | { type: 'chat.typing'; conversationId: string; userId: string; name: string }
  | { type: 'chat.mural' }
  | { type: 'chat.notice' }
  // Conversa do cliente com a loja (cardápio online): só ids; cada lado busca pela API.
  | { type: 'support.message'; chatId: string; messageId: string; sender: string }
  | { type: 'support.read'; chatId: string; by: 'customer' | 'staff' }
  | { type: 'support.typing'; chatId: string; by: 'customer' | 'staff'; name?: string }
  // Conversa do restaurante com a Comandou (suporte da plataforma): o dono/gerente busca pela API.
  | { type: 'help.message'; messageId: string; sender: string }
  | { type: 'help.read' };

export const tenantRoom = (tenantId: string) => `t:${tenantId}`;
/** Sala de uma pessoa (todas as abas/aparelhos dela neste restaurante). */
export const userRoom = (tenantId: string, userId: string) => `u:${tenantId}:${userId}`;

/**
 * Publica eventos para os clientes de UM restaurante (sala do tenant).
 * Os eventos são apenas sinais "algo mudou" com IDs: o cliente busca o estado oficial pela API.
 * Um evento recebido NÃO é prova de que a operação foi persistida; por isso só publicamos
 * depois do COMMIT, e a UI sempre reconcilia via REST após reconectar.
 */
@Injectable()
export class RealtimeService {
  private server?: Server;
  private readonly logger = new Logger('Realtime');
  private readonly listeners: ((tenantId: string, event: RealtimeEvent) => void)[] = [];

  /** Outros módulos reagem aos sinais do restaurante (ex.: cardápio mudou → enviar ao iFood). */
  onPublish(fn: (tenantId: string, event: RealtimeEvent) => void) {
    this.listeners.push(fn);
  }

  attach(server: Server) {
    this.server = server;
  }

  publish(tenantId: string, event: RealtimeEvent) {
    for (const fn of this.listeners) {
      try {
        fn(tenantId, event);
      } catch (err) {
        this.logger.warn(`ouvinte falhou: ${(err as Error).message}`);
      }
    }
    if (!this.server) return;
    try {
      this.server.to(tenantRoom(tenantId)).emit('event', event);
    } catch (err) {
      this.logger.warn(`falha ao publicar evento: ${(err as Error).message}`);
    }
  }

  /** Para uma sala específica (ex.: o aparelho do cliente na conversa com a loja). */
  publishToRoom(room: string, event: RealtimeEvent) {
    if (!this.server) return;
    try {
      this.server.to(room).emit('event', event);
    } catch (err) {
      this.logger.warn(`falha ao publicar evento: ${(err as Error).message}`);
    }
  }

  /** Só para estas pessoas (chat: quem participa da conversa). */
  publishToUsers(tenantId: string, userIds: Iterable<string>, event: RealtimeEvent) {
    if (!this.server) return;
    const rooms = [...new Set(userIds)].map((u) => userRoom(tenantId, u));
    if (!rooms.length) return;
    try {
      this.server.to(rooms).emit('event', event);
    } catch (err) {
      this.logger.warn(`falha ao publicar evento: ${(err as Error).message}`);
    }
  }
}
