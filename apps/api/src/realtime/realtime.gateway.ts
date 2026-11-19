import { Inject, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import { parse as parseCookie } from 'cookie';
import type { Server, Socket } from 'socket.io';
import { tenantAcceptsTraffic } from '@comandou/shared';
import { SESSION_COOKIE, SessionService } from '../auth/session.service';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { chatForCookies, chatRoom, GUEST_COOKIE } from '../store-chat/store-chat.service';
import { CUSTOMER_COOKIE } from '../store/customers.service';
import { TenantResolverService } from '../tenancy/tenant-resolver.service';
import { PlatformDb } from '../platform/platform-db.service';
import { RealtimeService, tenantAllRoom, tenantRoom, userRoom } from './realtime.service';

const REVALIDATE_MS = 60_000;

/**
 * WebSocket em /api/ws (mesmo host do restaurante; o Traefik roteia junto com /api).
 * Autenticação no handshake: Host → tenant, cookie de sessão → usuário DESTE tenant.
 * O socket entra somente na sala do próprio tenant. A sessão é revalidada periodicamente:
 * logout, revogação ou suspensão do restaurante desconectam o socket.
 */
@WebSocketGateway({
  path: '/api/ws',
  serveClient: false,
  cors: false,
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('RealtimeGateway');
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly realtime: RealtimeService,
    private readonly resolver: TenantResolverService,
    private readonly sessions: SessionService,
    private readonly db: DatabaseService,
    @Inject(ENV) private readonly env: Env,
    platformDb: PlatformDb,
  ) {
    // Onde fica o banco do restaurante (guardado alguns segundos por réplica).
    realtime.onCacheClear((tenantId) => {
      db.router.forget(tenantId);
      platformDb.router?.forget(tenantId);
    });
  }

  /** Quando o painel mandou limpar o cache pela última vez (o aparelho confere ao conectar). */
  private async cacheEpoch(tenantId: string): Promise<string | null> {
    const rows = await this.db
      .queryUnscoped<{ at: Date | null }>('SELECT app_tenant_cache_epoch($1) AS at', [tenantId])
      .catch(() => []);
    return rows[0]?.at ? new Date(rows[0].at).toISOString() : null;
  }

  async afterInit(server: Server) {
    this.realtime.attach(server);
    if (this.env.REDIS_URL) {
      const { createAdapter } = await import('@socket.io/redis-adapter');
      const { createClient } = await import('redis');
      const pub = createClient({ url: this.env.REDIS_URL });
      const sub = pub.duplicate();
      await Promise.all([pub.connect(), sub.connect()]);
      server.adapter(createAdapter(pub, sub));
      this.logger.log('adapter Redis ativo');
    }
    server.use((socket, next) => {
      this.authenticate(socket)
        .then((ok) => (ok ? next() : next(new Error('unauthorized'))))
        .catch(() => next(new Error('unauthorized')));
    });
  }

  private hostOf(socket: Socket): string | undefined {
    const h = socket.handshake.headers;
    const fwd = this.env.TRUST_PROXY ? (h['x-forwarded-host'] as string | undefined) : undefined;
    return (fwd?.split(',')[0] ?? h.host)?.trim();
  }

  private async authenticate(socket: Socket): Promise<boolean> {
    const outcome = await this.resolver.resolve(this.hostOf(socket));
    if (!outcome.ok || !tenantAcceptsTraffic(outcome.tenant.status)) return false;
    const origin = socket.handshake.headers.origin;
    if (origin) {
      try {
        const host = this.hostOf(socket)?.replace(/:\d+$/, '');
        if (new URL(origin).hostname !== host) return false;
      } catch {
        return false;
      }
    }
    const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
    const token = cookies[SESSION_COOKIE];
    const user = token ? await this.sessions.validate(outcome.tenant.id, token) : null;
    if (!user) return this.authenticateCustomer(socket, outcome.tenant.id, cookies);
    // O entregador não entra na sala da loja (pedidos e posição dos outros motoboys): só na dele,
    // onde chegam as próprias corridas (despacho na hora, com o som) e o chat.
    socket.data.personal = user.role === 'driver';
    socket.data.tenantId = outcome.tenant.id;
    socket.data.userId = user.id;
    socket.data.token = token;
    socket.data.host = this.hostOf(socket);
    return true;
  }

  /**
   * Cliente do cardápio online (sem login da equipe): só entra na sala da própria conversa com a
   * loja, pelo cookie da conta ou de visitante. Não recebe nenhum evento da operação.
   */
  private async authenticateCustomer(
    socket: Socket,
    tenantId: string,
    cookies: Record<string, string | undefined>,
  ): Promise<boolean> {
    const account = cookies[CUSTOMER_COOKIE];
    const guest = cookies[GUEST_COOKIE];
    const chatId = await chatForCookies(this.db, tenantId, account, guest);
    if (!chatId) return false;
    socket.data.tenantId = tenantId;
    socket.data.chatId = chatId;
    socket.data.account = account;
    socket.data.guest = guest;
    socket.data.host = this.hostOf(socket);
    return true;
  }

  private async customerConnection(socket: Socket, tenantId: string) {
    const chatId = socket.data.chatId as string;
    await socket.join([chatRoom(tenantId, chatId), tenantAllRoom(tenantId)]);
    socket.emit('ready', { chat: true, cacheEpoch: await this.cacheEpoch(tenantId) });
    // A cada minuto: a conversa ainda é deste aparelho (saiu da conta) e a loja segue ativa.
    const timer = setInterval(() => {
      Promise.all([
        chatForCookies(
          this.db,
          tenantId,
          socket.data.account as string | undefined,
          socket.data.guest as string | undefined,
        ),
        this.resolver.resolve(socket.data.host as string | undefined),
      ])
        .then(([c, t]) => {
          if (c !== chatId || (t.ok && !tenantAcceptsTraffic(t.tenant.status)))
            socket.disconnect(true);
        })
        .catch(() => undefined);
    }, REVALIDATE_MS);
    timer.unref();
    this.timers.set(socket.id, timer);
  }

  async handleConnection(socket: Socket) {
    const tenantId = socket.data.tenantId as string | undefined;
    if (!tenantId) {
      socket.disconnect(true);
      return;
    }
    if (socket.data.chatId) return this.customerConnection(socket, tenantId);
    const own = userRoom(tenantId, socket.data.userId as string);
    const all = tenantAllRoom(tenantId);
    await socket.join(socket.data.personal ? [own, all] : [tenantRoom(tenantId), own, all]);
    socket.emit('ready', { tenantId, cacheEpoch: await this.cacheEpoch(tenantId) });
    // A cada minuto: sessão ainda válida e restaurante ainda ativo (suspenso desconecta).
    const timer = setInterval(() => {
      Promise.all([
        this.sessions.validate(tenantId, socket.data.token as string),
        this.resolver.resolve(socket.data.host as string | undefined),
      ])
        .then(([u, t]) => {
          if (!u || (t.ok && !tenantAcceptsTraffic(t.tenant.status))) socket.disconnect(true);
        })
        .catch(() => undefined);
    }, REVALIDATE_MS);
    timer.unref();
    this.timers.set(socket.id, timer);
  }

  handleDisconnect(socket: Socket) {
    const t = this.timers.get(socket.id);
    if (t) clearInterval(t);
    this.timers.delete(socket.id);
  }
}
