import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

export type RealtimeEvent =
  | { type: 'order.changed'; orderId: string; status?: string; version?: number }
  | { type: 'kitchen.changed'; orderId: string }
  | { type: 'tab.changed'; tabId: string }
  | { type: 'cash.changed'; sessionId: string }
  | { type: 'menu.changed' }
  | { type: 'store.changed' }
  | { type: 'stock.changed' }
  | { type: 'delivery.changed'; deliveryId: string }
  | { type: 'print.changed' }
  | { type: 'fiscal.changed'; documentId: string; orderId: string };

export const tenantRoom = (tenantId: string) => `t:${tenantId}`;

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

  attach(server: Server) {
    this.server = server;
  }

  publish(tenantId: string, event: RealtimeEvent) {
    if (!this.server) return;
    try {
      this.server.to(tenantRoom(tenantId)).emit('event', event);
    } catch (err) {
      this.logger.warn(`falha ao publicar evento: ${(err as Error).message}`);
    }
  }
}
