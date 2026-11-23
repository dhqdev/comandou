import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Áreas sem evento próprio, avisadas pelo `LiveChangesInterceptor` a cada gravação. */
export type LiveArea = 'finance' | 'customers' | 'team' | 'agenda';

export type RealtimeEvent =
  // Gravação numa área sem evento próprio (Financeiro, Clientes, Equipe, Agenda).
  | { type: 'data.changed'; area: LiveArea }
  | { type: 'order.changed'; orderId: string; status?: string; version?: number }
  | { type: 'kitchen.changed'; orderId: string }
  // O Super Admin mudou as cozinhas ou o que a tela da cozinha mostra.
  | { type: 'kitchen.settings' }
  | { type: 'tab.changed'; tabId: string }
  /** Mesa chamou o garçom pelo celular (ou o chamado foi atendido/cancelado). */
  | {
      type: 'table.call';
      tableId: string;
      callId: string;
      status: 'open' | 'answered' | 'cancelled';
    }
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
  // Para os entregadores: a fila de pedidos prontos para pegar pode ter mudado (sem dado nenhum).
  | { type: 'runs.changed' }
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
  | { type: 'help.read' }
  // O Super Admin limpou o cache deste restaurante: a tela apaga o que guardou e recarrega.
  | { type: 'cache.clear'; at: string };

export const tenantRoom = (tenantId: string) => `t:${tenantId}`;
/** Sala de uma pessoa (todas as abas/aparelhos dela neste restaurante). */
export const userRoom = (tenantId: string, userId: string) => `u:${tenantId}:${userId}`;
/**
 * Sala de TODAS as conexões do restaurante (equipe, entregador e cliente na conversa). Só recebe
 * o aviso `cache.clear`, que não leva dado nenhum da operação.
 */
export const tenantAllRoom = (tenantId: string) => `a:${tenantId}`;
/**
 * Sala dos entregadores com login do restaurante. Eles não entram na sala da loja (pedidos e
 * posição dos outros motoboys): aqui só chega `runs.changed`, o sinal para recarregar a aba
 * Disponíveis (a lista vem da API, que filtra pronto + delivery + sem entregador).
 */
export const driversRoom = (tenantId: string) => `d:${tenantId}`;

/** Várias mudanças de pedido seguidas viram um aviso só para os entregadores. */
const RUNS_COALESCE_MS = 400;

/** Aviso entre as réplicas da API (pelo adapter Redis): limpar o cache deste restaurante. */
const CACHE_CLEAR_SIGNAL = 'tenant.cache.clear';

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
  private readonly runsTimers = new Map<string, NodeJS.Timeout>();

  /** Outros módulos reagem aos sinais do restaurante (ex.: cardápio mudou → enviar ao iFood). */
  onPublish(fn: (tenantId: string, event: RealtimeEvent) => void) {
    this.listeners.push(fn);
  }

  private readonly cacheHooks: ((tenantId: string) => void)[] = [];

  attach(server: Server) {
    this.server = server;
    // Outra réplica mandou limpar: esta apaga o próprio cache (a memória é de cada réplica).
    server.on(CACHE_CLEAR_SIGNAL, (tenantId: unknown) => {
      if (typeof tenantId === 'string') this.runCacheHooks(tenantId);
    });
  }

  /** Cache em memória de um restaurante (local, banco, bloqueio): apagado ao limpar pelo painel. */
  onCacheClear(fn: (tenantId: string) => void) {
    this.cacheHooks.push(fn);
  }

  private runCacheHooks(tenantId: string) {
    for (const fn of this.cacheHooks) {
      try {
        fn(tenantId);
      } catch (err) {
        this.logger.warn(`limpeza de cache falhou: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Limpa o cache do restaurante nesta réplica e nas outras, e manda toda tela aberta dele
   * (equipe, cozinha, entregador, cliente na conversa) apagar o que guardou e recarregar.
   */
  clearTenantCaches(tenantId: string, at: string) {
    this.runCacheHooks(tenantId);
    if (!this.server) return;
    try {
      this.server.serverSideEmit(CACHE_CLEAR_SIGNAL, tenantId);
    } catch {
      /* uma réplica só (sem Redis): não há outras para avisar */
    }
    try {
      this.server.to(tenantAllRoom(tenantId)).emit('event', { type: 'cache.clear', at });
    } catch (err) {
      this.logger.warn(`falha ao publicar evento: ${(err as Error).message}`);
    }
  }

  /** Quantas telas do restaurante estão conectadas agora (todas as réplicas; 0 se não souber). */
  async connectedCount(tenantId: string): Promise<number> {
    if (!this.server) return 0;
    try {
      const sockets = await this.server.in(tenantAllRoom(tenantId)).timeout(3000).fetchSockets();
      return sockets.length;
    } catch {
      return 0;
    }
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
    // Pedido mudou (ficou pronto, saiu, foi cancelado…): a aba Disponíveis do entregador recarrega
    // na hora. Só o sinal, sem o id: quem decide o que ele vê é a API.
    if (event.type === 'order.changed' || event.type === 'delivery.changed')
      this.signalRuns(tenantId);
  }

  private signalRuns(tenantId: string) {
    if (this.runsTimers.has(tenantId)) return;
    const timer = setTimeout(() => {
      this.runsTimers.delete(tenantId);
      try {
        this.server?.to(driversRoom(tenantId)).emit('event', { type: 'runs.changed' });
      } catch (err) {
        this.logger.warn(`falha ao avisar os entregadores: ${(err as Error).message}`);
      }
    }, RUNS_COALESCE_MS);
    timer.unref();
    this.runsTimers.set(tenantId, timer);
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
