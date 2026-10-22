import { removeAuthState, savedTenants, useEncryptedAuthState } from './auth-store.js';

export type SessionStatus = 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged_out';

export interface ConnectionUpdate {
  connection?: 'open' | 'close' | 'connecting';
  qr?: string;
  lastDisconnect?: { error?: unknown };
}

/** O mínimo do socket do Baileys que usamos (permite um socket falso nos testes). */
export interface SocketLike {
  ev: {
    on(event: 'connection.update', fn: (u: ConnectionUpdate) => void): void;
    on(event: 'creds.update', fn: () => void): void;
  };
  user?: { id: string } | null;
  sendMessage(
    jid: string,
    content: { text: string },
  ): Promise<{ key?: { id?: string | null } } | undefined>;
  logout(): Promise<void>;
  end(err?: Error): void;
}

export type SocketFactory = (
  auth: Awaited<ReturnType<typeof useEncryptedAuthState>>['state'],
) => SocketLike;

interface Session {
  sock?: SocketLike;
  status: SessionStatus;
  qr?: string;
  phone?: string;
  retries: number;
  timer?: NodeJS.Timeout;
}

const LOGGED_OUT = 401;

function statusCode(err: unknown): number | undefined {
  const e = err as { output?: { statusCode?: number } } | undefined;
  return e?.output?.statusCode;
}

/**
 * Uma conexão do WhatsApp por restaurante. A sessão (credenciais) fica cifrada em disco e é
 * reaberta ao iniciar o serviço. Desconexão comum reconecta com espera crescente; "deslogado"
 * (o celular removeu o aparelho) apaga a sessão e pede novo QR Code.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private closed = false;

  constructor(
    private readonly dataDir: string,
    private readonly key: Buffer,
    private readonly factory: SocketFactory,
    private readonly log: (msg: string) => void = () => undefined,
  ) {}

  async restoreAll() {
    for (const t of await savedTenants(this.dataDir)) await this.start(t);
  }

  status(tenantId: string) {
    const s = this.sessions.get(tenantId);
    return {
      status: s?.status ?? 'disconnected',
      qr: s?.status === 'qr' ? s.qr : undefined,
      phone: s?.phone,
    };
  }

  async start(tenantId: string) {
    const cur = this.sessions.get(tenantId);
    if (cur && cur.status !== 'disconnected' && cur.status !== 'logged_out')
      return this.status(tenantId);
    const s: Session = cur ?? { status: 'connecting', retries: 0 };
    s.status = 'connecting';
    this.sessions.set(tenantId, s);
    await this.connect(tenantId, s);
    return this.status(tenantId);
  }

  private async connect(tenantId: string, s: Session) {
    if (this.closed) return;
    const { state, saveCreds } = await useEncryptedAuthState(this.dataDir, tenantId, this.key);
    const sock = this.factory(state);
    s.sock = sock;
    sock.ev.on(
      'creds.update',
      () => void saveCreds().catch((e: Error) => this.log(`creds: ${e.message}`)),
    );
    sock.ev.on('connection.update', (u) => {
      if (s.sock !== sock) return; // evento de um socket antigo
      if (u.qr) {
        s.status = 'qr';
        s.qr = u.qr;
      }
      if (u.connection === 'open') {
        s.status = 'connected';
        s.qr = undefined;
        s.retries = 0;
        s.phone = sock.user?.id?.split(':')[0]?.split('@')[0];
      }
      if (u.connection === 'close') {
        s.sock = undefined;
        if (statusCode(u.lastDisconnect?.error) === LOGGED_OUT) {
          s.status = 'logged_out';
          s.phone = undefined;
          void removeAuthState(this.dataDir, tenantId);
          this.log(`restaurante ${tenantId}: aparelho desconectado no celular`);
          return;
        }
        s.status = 'connecting';
        const delay = Math.min(60_000, 1000 * 2 ** Math.min(s.retries++, 6));
        s.timer = setTimeout(() => void this.connect(tenantId, s), delay);
      }
    });
  }

  async logout(tenantId: string) {
    const s = this.sessions.get(tenantId);
    if (s?.timer) clearTimeout(s.timer);
    const sock = s?.sock;
    if (s) {
      s.sock = undefined;
      s.status = 'logged_out';
      s.phone = undefined;
      s.qr = undefined;
    }
    try {
      await sock?.logout();
    } catch {
      sock?.end();
    }
    await removeAuthState(this.dataDir, tenantId);
    return this.status(tenantId);
  }

  async send(tenantId: string, to: string, text: string) {
    const s = this.sessions.get(tenantId);
    if (!s?.sock || s.status !== 'connected') throw new NotConnectedError();
    const r = await s.sock.sendMessage(`${to}@s.whatsapp.net`, { text });
    return { id: r?.key?.id ?? null };
  }

  close() {
    this.closed = true;
    for (const s of this.sessions.values()) {
      if (s.timer) clearTimeout(s.timer);
      s.sock?.end();
    }
  }
}

export class NotConnectedError extends Error {
  constructor() {
    super('WhatsApp do restaurante não está conectado');
  }
}
