import { Inject, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import { parse as parseCookie } from 'cookie';
import type { Server, Socket } from 'socket.io';
import { tenantAcceptsTraffic } from '@pedemais/shared';
import { SESSION_COOKIE, SessionService } from '../auth/session.service';
import { ENV, Env } from '../config/env';
import { TenantResolverService } from '../tenancy/tenant-resolver.service';
import { RealtimeService, tenantRoom } from './realtime.service';

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
    @Inject(ENV) private readonly env: Env,
  ) {}

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
    const token = parseCookie(socket.handshake.headers.cookie ?? '')[SESSION_COOKIE];
    if (!token) return false;
    const user = await this.sessions.validate(outcome.tenant.id, token);
    if (!user) return false;
    socket.data.tenantId = outcome.tenant.id;
    socket.data.userId = user.id;
    socket.data.token = token;
    return true;
  }

  async handleConnection(socket: Socket) {
    const tenantId = socket.data.tenantId as string | undefined;
    if (!tenantId) {
      socket.disconnect(true);
      return;
    }
    await socket.join(tenantRoom(tenantId));
    socket.emit('ready', { tenantId });
    const timer = setInterval(() => {
      this.sessions
        .validate(tenantId, socket.data.token as string)
        .then((u) => {
          if (!u) socket.disconnect(true);
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
