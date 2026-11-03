import { removeAuthState, savedTenants, useEncryptedAuthState } from './auth-store.js';

export type SessionStatus = 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged_out';

export interface ConnectionUpdate {
  connection?: 'open' | 'close' | 'connecting';
  qr?: string;
  lastDisconnect?: { error?: unknown };
}

/** Conteúdo de uma mensagem já enviada (para o Baileys reenviar quando o destino pedir). */
export type SentContent = { conversation: string };

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
  /** Descobre o JID real do número (no Brasil, com ou sem o 9). */
  onWhatsApp?(...jids: string[]): Promise<{ jid: string; exists: unknown }[] | undefined>;
  logout(): Promise<void>;
  end(err?: Error): void;
}

type AuthState = Awaited<ReturnType<typeof useEncryptedAuthState>>['state'];

export interface SocketOptions {
  /** O Baileys chama quando o celular do cliente pede o reenvio de uma mensagem. */
  getMessage(key: { id?: string | null }): Promise<SentContent | undefined>;
}

export type SocketFactory = (auth: AuthState, opts: SocketOptions) => SocketLike;

interface Session {
  sock?: SocketLike;
  /** Muda a cada conexão nova ou logout: eventos e timers de uma geração antiga são ignorados. */
  gen: number;
  status: SessionStatus;
  qr?: string;
  phone?: string;
  /** Motivo da última parada sem reconexão automática (mostrado na tela). */
  error?: string;
  retries: number;
  timer?: NodeJS.Timeout;
  /** Remoção da sessão em disco em andamento (um start novo espera terminar). */
  removing?: Promise<void>;
  /** Número → JID confirmado no WhatsApp. */
  jids: Map<string, string | null>;
  /** Últimas mensagens enviadas (id → texto), para reenvio a pedido do destino. */
  recent: Map<string, string>;
}

/** Códigos de desconexão do Baileys (DisconnectReason). */
const R = {
  timedOut: 408,
  loggedOut: 401,
  forbidden: 403,
  multideviceMismatch: 411,
  connectionReplaced: 440,
  restartRequired: 515,
} as const;

const RECENT_MAX = 300;
const JID_CACHE_MAX = 2000;
const SEND_TIMEOUT_MS = 15_000;

function statusCode(err: unknown): number | undefined {
  const e = err as { output?: { statusCode?: number } } | undefined;
  return e?.output?.statusCode;
}

function remember<K, V>(map: Map<K, V>, k: K, v: V, max: number) {
  map.delete(k);
  map.set(k, v);
  if (map.size > max) map.delete(map.keys().next().value as K);
}

/** Celular brasileiro: a forma com e sem o 9 (contas antigas existem sem ele). */
export function brazilVariants(to: string): string[] {
  const m = /^55([1-9][0-9])(9?)([0-9]{8})$/.exec(to);
  if (!m || !/^[6-9]/.test(m[3])) return [to];
  const [, ddd, nine, rest] = m;
  return nine ? [to, `55${ddd}${rest}`] : [to, `55${ddd}9${rest}`];
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error(msg)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

/**
 * Uma conexão do WhatsApp por restaurante. A sessão (credenciais) fica cifrada em disco e é
 * reaberta ao iniciar o serviço. Desconexão comum reconecta com espera crescente. Paradas
 * definitivas não reconectam: "deslogado"/"bloqueado" (apaga a sessão e pede novo QR Code),
 * QR Code que ninguém leu (apaga a sessão incompleta) e "sessão aberta em outro lugar".
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

  /** Reabre as sessões salvas. Uma sessão com problema não impede as outras. */
  async restoreAll() {
    for (const t of await savedTenants(this.dataDir)) {
      try {
        await this.start(t, true);
      } catch (e) {
        this.log(`restaurante ${t}: sessão não reaberta (${(e as Error).message})`);
      }
    }
  }

  status(tenantId: string) {
    const s = this.sessions.get(tenantId);
    return {
      status: s?.status ?? 'disconnected',
      qr: s?.status === 'qr' ? s.qr : undefined,
      phone: s?.phone,
      error: s?.status === 'disconnected' || s?.status === 'logged_out' ? s.error : undefined,
    };
  }

  async start(tenantId: string, restoring = false) {
    const cur = this.sessions.get(tenantId);
    if (cur && cur.status !== 'disconnected' && cur.status !== 'logged_out')
      return this.status(tenantId);
    const s: Session = cur ?? {
      gen: 0,
      status: 'connecting',
      retries: 0,
      jids: new Map(),
      recent: new Map(),
    };
    s.status = 'connecting';
    s.error = undefined;
    s.retries = 0;
    this.sessions.set(tenantId, s);
    await s.removing;
    try {
      await this.connect(tenantId, s, ++s.gen, restoring);
    } catch (e) {
      // Sessão ilegível (chave trocada ou arquivo corrompido): "Desconectar" apaga e recomeça.
      s.status = 'disconnected';
      s.error = 'Não foi possível abrir a sessão salva. Desconecte e conecte de novo.';
      throw e;
    }
    return this.status(tenantId);
  }

  private async connect(tenantId: string, s: Session, gen: number, restoring = false) {
    if (this.closed || s.gen !== gen) return;
    const { state, saveCreds } = await useEncryptedAuthState(this.dataDir, tenantId, this.key);
    if (this.closed || s.gen !== gen) return; // logout durante a leitura
    if (restoring && !state.creds.me) {
      // Pasta de um QR Code que nunca foi lido: não fica gerando QR sozinho a cada reinício.
      this.sessions.delete(tenantId);
      await removeAuthState(this.dataDir, tenantId);
      return;
    }
    const sock = this.factory(state, {
      getMessage: async (k) => {
        const text = k.id ? s.recent.get(k.id) : undefined;
        return text === undefined ? undefined : { conversation: text };
      },
    });
    s.sock = sock;
    const current = () => s.sock === sock && s.gen === gen;
    sock.ev.on('creds.update', () => {
      if (!current()) return; // socket antigo não grava por cima (nem recria pasta apagada)
      void saveCreds().catch((e: Error) => this.log(`creds: ${e.message}`));
    });
    sock.ev.on('connection.update', (u) => {
      if (!current()) return; // evento de um socket antigo
      if (u.qr) {
        s.status = 'qr';
        s.qr = u.qr;
      }
      if (u.connection === 'open') {
        s.status = 'connected';
        s.qr = undefined;
        s.error = undefined;
        s.retries = 0;
        s.phone = sock.user?.id?.split(':')[0]?.split('@')[0];
      }
      if (u.connection === 'close') this.onClose(tenantId, s, gen, u, !!state.creds.me);
    });
  }

  private onClose(
    tenantId: string,
    s: Session,
    gen: number,
    u: ConnectionUpdate,
    registered: boolean,
  ) {
    s.sock = undefined;
    const code = statusCode(u.lastDisconnect?.error);
    const stop = (status: SessionStatus, error: string, wipe: boolean) => {
      s.gen++;
      s.status = status;
      s.qr = undefined;
      s.error = error;
      if (wipe) {
        s.phone = undefined;
        s.jids.clear();
        s.removing = removeAuthState(this.dataDir, tenantId).catch((e: Error) =>
          this.log(`restaurante ${tenantId}: sessão não apagada (${e.message})`),
        );
      }
      this.log(`restaurante ${tenantId}: ${error}`);
    };
    if (code === R.loggedOut || code === R.multideviceMismatch)
      return stop('logged_out', 'O aparelho foi desconectado no celular.', true);
    if (code === R.forbidden)
      return stop('logged_out', 'O WhatsApp recusou este número (pode estar bloqueado).', true);
    if (code === R.connectionReplaced)
      return stop(
        'disconnected',
        'A sessão foi aberta em outro lugar. Conecte de novo para voltar a usar aqui.',
        false,
      );
    if (!registered && code === R.timedOut)
      return stop('disconnected', 'O QR Code expirou sem ser lido. Gere outro.', true);
    s.status = 'connecting';
    // Depois de ler o QR Code o WhatsApp pede para reiniciar a conexão: na hora, sem espera.
    const delay =
      code === R.restartRequired ? 0 : Math.min(60_000, 1000 * 2 ** Math.min(s.retries++, 6));
    s.timer = setTimeout(() => void this.reconnect(tenantId, s, gen), delay);
  }

  private async reconnect(tenantId: string, s: Session, gen: number) {
    try {
      await this.connect(tenantId, s, gen);
    } catch (e) {
      if (s.gen !== gen) return;
      s.status = 'disconnected';
      s.error = 'Não foi possível abrir a sessão salva. Desconecte e conecte de novo.';
      this.log(`restaurante ${tenantId}: reconexão falhou (${(e as Error).message})`);
    }
  }

  async logout(tenantId: string) {
    const s = this.sessions.get(tenantId);
    const sock = s?.sock;
    if (s) {
      if (s.timer) clearTimeout(s.timer);
      s.gen++;
      s.sock = undefined;
      s.status = 'logged_out';
      s.phone = undefined;
      s.qr = undefined;
      s.error = undefined;
      s.jids.clear();
      s.recent.clear();
    }
    try {
      await sock?.logout();
    } catch {
      sock?.end();
    }
    await s?.removing;
    await removeAuthState(this.dataDir, tenantId);
    return this.status(tenantId);
  }

  /** JID de verdade do número no WhatsApp, ou null se o número não tem WhatsApp. */
  private async resolveJid(s: Session, sock: SocketLike, to: string): Promise<string | null> {
    if (!sock.onWhatsApp) return `${to}@s.whatsapp.net`;
    if (s.jids.has(to)) return s.jids.get(to)!;
    const forms = brazilVariants(to);
    const found = await withTimeout(
      sock.onWhatsApp(...forms.map((n) => `${n}@s.whatsapp.net`)),
      SEND_TIMEOUT_MS,
      'WhatsApp não respondeu a consulta do número',
    );
    const hit = found?.find((r) => r.exists && r.jid);
    const jid = hit ? hit.jid : null;
    remember(s.jids, to, jid, JID_CACHE_MAX);
    return jid;
  }

  async send(tenantId: string, to: string, text: string) {
    const s = this.sessions.get(tenantId);
    const sock = s?.sock;
    if (!s || !sock || s.status !== 'connected') throw new NotConnectedError();
    const jid = await this.resolveJid(s, sock, to);
    if (!jid) throw new NotOnWhatsAppError();
    const r = await withTimeout(
      sock.sendMessage(jid, { text }),
      SEND_TIMEOUT_MS,
      'WhatsApp não confirmou o envio a tempo',
    );
    const id = r?.key?.id ?? null;
    if (id) remember(s.recent, id, text, RECENT_MAX);
    return { id };
  }

  close() {
    this.closed = true;
    for (const s of this.sessions.values()) {
      if (s.timer) clearTimeout(s.timer);
      s.gen++;
      const sock = s.sock;
      s.sock = undefined;
      sock?.end();
    }
  }
}

export class NotConnectedError extends Error {
  constructor() {
    super('WhatsApp do restaurante não está conectado');
  }
}

export class NotOnWhatsAppError extends Error {
  constructor() {
    super('Este número não tem WhatsApp');
  }
}
