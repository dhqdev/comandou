import { removeAuthState, savedTenants, useEncryptedAuthState } from './auth-store.js';
import {
  parseInbound,
  unreadableReason,
  type InboundMessage,
  type WAMessageLike,
  type WAKey,
} from './inbound.js';

export type { InboundMessage, WAMessageLike, WAKey } from './inbound.js';

export type SessionStatus = 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged_out';

export interface ConnectionUpdate {
  connection?: 'open' | 'close' | 'connecting';
  qr?: string;
  lastDisconnect?: { error?: unknown };
}

/** Conteúdo de uma mensagem já enviada (para o Baileys reenviar quando o destino pedir). */
export type SentContent = { conversation: string };

export type PresenceType = 'available' | 'unavailable' | 'composing' | 'recording' | 'paused';

type MessageContent =
  | { text: string }
  | { react: { text: string; key: WAKey } }
  | { document: Buffer; mimetype: string; fileName: string; caption?: string }
  | { image: Buffer; mimetype: string; caption?: string };

/** Maior arquivo que a API pode mandar pelo WhatsApp (cardápio do restaurante, calendário). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Arquivo que a API manda: PDF vai como documento; foto (JPEG/PNG) vai como imagem. */
export type OutgoingFile = {
  data: Buffer;
  fileName: string;
  mimetype: 'application/pdf' | 'image/jpeg' | 'image/png';
  caption?: string;
};

/** O mínimo do socket do Baileys que usamos (permite um socket falso nos testes). */
export interface SocketLike {
  ev: {
    on(event: 'connection.update', fn: (u: ConnectionUpdate) => void): void;
    on(event: 'creds.update', fn: () => void): void;
    on(
      event: 'messages.upsert',
      fn: (u: { messages: WAMessageLike[]; type: string }) => void,
    ): void;
  };
  /** WebSocket por baixo: qualquer quadro recebido prova que a conexão está viva. */
  ws?: { isOpen?: boolean; on?(event: 'message', fn: () => void): unknown };
  user?: { id: string } | null;
  sendMessage(
    jid: string,
    content: MessageContent,
  ): Promise<{ key?: { id?: string | null } } | undefined>;
  /** Descobre o JID real do número (no Brasil, com ou sem o 9). */
  onWhatsApp?(...jids: string[]): Promise<{ jid: string; exists: unknown }[] | undefined>;
  /** "online", "digitando...", "gravando áudio..." e "parou de digitar". */
  sendPresenceUpdate?(type: PresenceType, jid?: string): Promise<void>;
  /** Marca como lida (os dois tiques azuis no celular do cliente). */
  readMessages?(keys: WAKey[]): Promise<void>;
  /** Consulta crua ao servidor (usada para o ping antes de enviar). */
  query?(node: unknown, timeoutMs?: number): Promise<unknown>;
  generateMessageTag?(): string;
  logout(): Promise<void>;
  end(err?: Error): void;
}

type AuthState = Awaited<ReturnType<typeof useEncryptedAuthState>>['state'];

export interface SocketOptions {
  /** O Baileys chama quando o celular do cliente pede o reenvio de uma mensagem. */
  getMessage(key: { id?: string | null }): Promise<SentContent | undefined>;
}

export type SocketFactory = (auth: AuthState, opts: SocketOptions) => SocketLike;

/** Tempos da conexão. Os padrões valem para produção; os testes encurtam. */
export interface Timings {
  /** de quanto em quanto tempo o vigia confere as conexões */
  heartbeatMs: number;
  /** ping do próprio Baileys (também passado ao socket em main.ts) */
  keepAliveMs: number;
  /** conexão aberta sem receber NADA do servidor por esse tempo = meio-aberta: derruba e religa */
  staleMs: number;
  /** sem QR nem conexão aberta nesse tempo = o servidor não respondeu: tenta de novo */
  openTimeoutMs: number;
  /** espera entre tentativas: base * 2^tentativa, até o máximo (nunca desiste) */
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** quanto um envio espera a religação em andamento antes de responder "desconectado" */
  sendWaitMs: number;
  /** depois de responder, o número fica "online" por esse tempo e volta a "offline" */
  onlineMs: number;
  /**
   * Religação "na hora" (o vigia achou a conexão morta) espalhada num sorteio de até esse tempo:
   * quando a internet do servidor cai, todas as sessões caem juntas e não podem voltar todas no
   * mesmo milissegundo (o WhatsApp vê centenas de logins do mesmo IP de uma vez).
   */
  reconnectSpreadMs: number;
  /** ao iniciar o serviço, espera entre reabrir uma sessão salva e a próxima */
  restoreGapMs: number;
  /** intervalo mínimo entre duas mensagens do mesmo número (ritmo de gente, contra bloqueio) */
  sendGapMs: number;
  /** fila de envio do número maior que isso: responde "muitas mensagens" em vez de esperar */
  sendQueueMaxMs: number;
  /** espera pela confirmação do WhatsApp; passou disso, o envio fica "incerto" (pode ter saído) */
  sendTimeoutMs: number;
}

export const DEFAULT_TIMINGS: Timings = {
  heartbeatMs: 15_000,
  keepAliveMs: 20_000,
  staleMs: 90_000,
  openTimeoutMs: 45_000,
  backoffBaseMs: 1_000,
  backoffMaxMs: 60_000,
  sendWaitMs: 12_000,
  onlineMs: 60_000,
  reconnectSpreadMs: 5_000,
  restoreGapMs: 250,
  sendGapMs: 700,
  sendQueueMaxMs: 15_000,
  sendTimeoutMs: 15_000,
};

export interface ManagerOptions {
  timings?: Partial<Timings>;
  /** Mensagem de cliente que chegou (só conversas individuais; grupos e status ficam de fora). */
  onInbound?: (msg: InboundMessage) => void;
  /** O WhatsApp recusou a versão anunciada (405): quem montou o socket busca a atual. */
  onVersionRejected?: () => void;
}

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
  /** Sem QR nem "open" nesse prazo: o servidor não respondeu. */
  openTimer?: NodeJS.Timeout;
  /** Lendo as credenciais do disco (o socket ainda não existe). */
  opening?: boolean;
  /** Já pareado (leu o QR Code alguma vez): queda vira religação, nunca QR novo. */
  registered: boolean;
  /** Último quadro recebido do servidor (ping, mensagem, qualquer coisa). */
  lastRecvAt: number;
  /** Última mensagem de cliente repassada à API (mostrada na tela, para saber se chega). */
  lastInboundAt?: number;
  /** Mensagens de cliente seguidas que chegaram sem abrir (ver unreadableReason); zera na próxima que abre. */
  unreadable: number;
  /** Remoção da sessão em disco em andamento (um start novo espera terminar). */
  removing?: Promise<void>;
  /**
   * Gravação das credenciais em andamento. Reabrir a conexão espera por ela: logo depois de ler o
   * QR Code o WhatsApp pede para reiniciar, e ler o arquivo antes de gravar traria as credenciais
   * de antes do pareamento (o celular conectado e a tela pedindo outro QR Code).
   */
  saving?: Promise<void>;
  /** Número → JID confirmado no WhatsApp. */
  jids: Map<string, string | null>;
  /** Últimas mensagens enviadas (id → texto), para reenvio a pedido do destino. */
  recent: Map<string, string>;
  /** Envios esperando a conexão voltar. */
  waiters: Set<() => void>;
  /** "online" ligado e o timer que volta para "offline". */
  online: boolean;
  onlineTimer?: NodeJS.Timeout;
  /** "digitando..." pendente por conversa: chamar de novo renova em vez de piscar. */
  pauseTimers: Map<string, NodeJS.Timeout>;
  /** Quando o próximo envio deste número pode sair (ritmo mínimo entre mensagens). */
  nextSendAt: number;
}

/** Códigos de desconexão do Baileys (DisconnectReason). */
const R = {
  timedOut: 408,
  loggedOut: 401,
  forbidden: 403,
  multideviceMismatch: 411,
  connectionReplaced: 440,
  restartRequired: 515,
  /** "Connection Failure": em geral a versão do WhatsApp Web ficou velha */
  versionRejected: 405,
} as const;

/** Tentativas seguidas de abrir o QR Code (sessão ainda não pareada) antes de parar e avisar. */
const QR_MAX_RETRIES = 3;

const RECENT_MAX = 300;
const JID_CACHE_MAX = 2000;
const SEND_TIMEOUT_MS = 15_000;
const EXTRA_TIMEOUT_MS = 5_000;
export const MAX_TYPING_MS = 25_000;

function statusCode(err: unknown): number | undefined {
  const e = err as { output?: { statusCode?: number } } | undefined;
  return e?.output?.statusCode;
}

/** Erro de envio que significa "o socket morreu por baixo" (vale derrubar, religar e tentar de novo). */
export function isConnectionError(err: unknown) {
  const code = statusCode(err);
  if (code !== undefined && [428, 408, 440, 503].includes(code)) return true;
  return /^connection (closed|terminated|was lost|failure)/i.test((err as Error)?.message ?? '');
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

function withTimeout<T>(p: Promise<T>, ms: number, msg: string | (() => Error)): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(typeof msg === 'string' ? new Error(msg) : msg()), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Destino de um envio: número (o gateway acha o JID) ou o JID de uma conversa que chegou. */
export type Target = { to: string } | { jid: string };

/**
 * Uma conexão do WhatsApp por restaurante. A sessão (credenciais) fica cifrada em disco e é
 * reaberta ao iniciar o serviço. Paradas definitivas não reconectam: "deslogado"/"bloqueado"
 * (apaga a sessão e pede novo QR Code), QR Code que ninguém leu (apaga a sessão incompleta) e
 * "sessão aberta em outro lugar".
 *
 * Religação (a mesma do Planejai): qualquer outra queda de uma sessão pareada tenta de novo com
 * espera crescente, sem desistir. A cada 15 s um vigia confere cada conexão: socket fechado sem
 * aviso ou mudo há mais de 90 s (meio-aberto, comum depois de horas sem conversa, quando NAT ou
 * proxy derrubam a conexão TCP ociosa sem avisar) é derrubado e religado; sessão pareada sem
 * socket também. Um envio com a conexão parada há mais tempo que o ping manda um ping antes, e
 * com a conexão caída espera a religação (até sendWaitMs) em vez de falhar na hora.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  /** Restaurantes já avisados no log de que a mensagem recebida não tem para onde ir. */
  private readonly warnedNoInbound = new Set<string>();
  private closed = false;
  private readonly t: Timings;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    private readonly dataDir: string,
    private readonly key: Buffer,
    private readonly factory: SocketFactory,
    private readonly log: (msg: string) => void = () => undefined,
    private readonly opts: ManagerOptions = {},
  ) {
    this.t = { ...DEFAULT_TIMINGS, ...opts.timings };
    this.heartbeat = setInterval(() => this.watchdog(), this.t.heartbeatMs);
    this.heartbeat.unref();
  }

  /**
   * Reabre as sessões salvas, uma de cada vez com um respiro entre elas (com centenas de
   * restaurantes, abrir tudo junto pesa na CPU e o WhatsApp vê uma rajada de logins do mesmo IP).
   * Uma sessão com problema não impede as outras.
   */
  async restoreAll() {
    const all = await savedTenants(this.dataDir);
    for (const [i, t] of all.entries()) {
      if (this.closed) return;
      if (i > 0 && this.t.restoreGapMs > 0) await sleep(this.t.restoreGapMs);
      try {
        await this.start(t, true);
      } catch (e) {
        this.log(`restaurante ${t}: sessão não reaberta (${(e as Error).message})`);
      }
    }
    if (all.length) this.log(`${all.length} sessões salvas reabertas`);
  }

  /** Quantas sessões em cada situação (monitoramento). */
  stats() {
    const by: Record<SessionStatus, number> = {
      connected: 0,
      connecting: 0,
      qr: 0,
      disconnected: 0,
      logged_out: 0,
    };
    for (const s of this.sessions.values()) by[s.status]++;
    return { total: this.sessions.size, ...by };
  }

  status(tenantId: string) {
    const s = this.sessions.get(tenantId);
    const reconnecting = s?.status === 'connecting' && s.registered;
    return {
      status: s?.status ?? 'disconnected',
      qr: s?.status === 'qr' ? s.qr : undefined,
      phone: s?.phone,
      error: s?.status === 'disconnected' || s?.status === 'logged_out' ? s.error : undefined,
      ...(reconnecting ? { reconnecting: true } : {}),
      ...(s?.status === 'connected' && s.sock
        ? { lastActivityAt: new Date(s.lastRecvAt).toISOString() }
        : {}),
      ...(s?.lastInboundAt ? { lastInboundAt: new Date(s.lastInboundAt).toISOString() } : {}),
      // Sem INBOUND_URL as mensagens dos clientes não vão para a API (a IA nunca responde).
      ...(this.opts.onInbound ? {} : { inboundOff: true }),
      ...(s?.unreadable ? { unreadable: s.unreadable } : {}),
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
      registered: false,
      lastRecvAt: Date.now(),
      unreadable: 0,
      jids: new Map(),
      recent: new Map(),
      waiters: new Set(),
      online: false,
      pauseTimers: new Map(),
      nextSendAt: 0,
    };
    s.status = 'connecting';
    s.error = undefined;
    s.retries = 0;
    s.unreadable = 0;
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
    s.opening = true;
    let auth: Awaited<ReturnType<typeof useEncryptedAuthState>>;
    try {
      await s.saving; // credenciais da conexão anterior gravadas antes de ler (ver `saving`)
      auth = await useEncryptedAuthState(this.dataDir, tenantId, this.key);
    } finally {
      s.opening = false;
    }
    const { state, saveCreds } = auth;
    if (this.closed || s.gen !== gen) return; // logout durante a leitura
    if (restoring && !state.creds.me) {
      // Pasta de um QR Code que nunca foi lido: não fica gerando QR sozinho a cada reinício.
      this.sessions.delete(tenantId);
      await removeAuthState(this.dataDir, tenantId);
      return;
    }
    if (state.creds.me) s.registered = true;
    this.dropSocket(s); // nunca dois sockets da mesma conta (o WhatsApp derruba um com 440)
    const sock = this.factory(state, {
      getMessage: async (k) => {
        const text = k.id ? s.recent.get(k.id) : undefined;
        return text === undefined ? undefined : { conversation: text };
      },
    });
    s.sock = sock;
    s.online = false;
    s.lastRecvAt = Date.now();
    const current = () => s.sock === sock && s.gen === gen;
    // Qualquer quadro do servidor (inclusive a resposta do ping) prova que o socket está vivo.
    sock.ws?.on?.('message', () => {
      if (current()) s.lastRecvAt = Date.now();
    });
    s.openTimer = setTimeout(() => {
      if (!current() || s.status === 'connected' || s.status === 'qr') return;
      this.dropSocket(s);
      if (s.registered) {
        this.log(`restaurante ${tenantId}: o WhatsApp não respondeu; tentando de novo`);
        this.scheduleReconnect(tenantId, s, gen);
      } else {
        s.gen++;
        s.status = 'disconnected';
        s.error = 'O WhatsApp não respondeu. Verifique a internet do servidor e tente de novo.';
        this.wake(s);
      }
    }, this.t.openTimeoutMs);
    s.openTimer.unref();
    sock.ev.on('creds.update', () => {
      if (!current()) return; // socket antigo não grava por cima (nem recria pasta apagada)
      // As gravações saem na ordem (uma trava por arquivo): esperar a última espera todas.
      s.saving = saveCreds().catch((e: Error) => this.log(`creds: ${e.message}`));
    });
    sock.ev.on('connection.update', (u) => {
      if (!current()) return; // evento de um socket antigo
      if ((u.qr || u.connection === 'open' || u.connection === 'close') && s.openTimer) {
        clearTimeout(s.openTimer);
        s.openTimer = undefined;
      }
      if (u.qr) {
        s.status = 'qr';
        s.qr = u.qr;
      }
      if (u.connection === 'open') {
        const after = s.retries;
        s.status = 'connected';
        s.qr = undefined;
        s.error = undefined;
        s.retries = 0;
        s.registered = true;
        s.lastRecvAt = Date.now();
        s.phone = sock.user?.id?.split(':')[0]?.split('@')[0];
        if (after) this.log(`restaurante ${tenantId}: WhatsApp de volta (${after} tentativas)`);
        this.wake(s);
      }
      if (u.connection === 'close') this.onClose(tenantId, s, gen, u, !!state.creds.me);
    });
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (!current()) return;
      s.lastRecvAt = Date.now();
      if (type !== 'notify') return;
      for (const raw of messages) {
        const why = unreadableReason(raw);
        if (why) {
          s.unreadable++;
          this.log(
            `restaurante ${tenantId}: mensagem de cliente chegou sem abrir (${why}); o WhatsApp vai pedir de novo ao celular dele`,
          );
          continue;
        }
        const msg = parseInbound(tenantId, raw);
        if (!msg) continue;
        if (!this.opts.onInbound) {
          if (!this.warnedNoInbound.has(tenantId)) {
            this.warnedNoInbound.add(tenantId);
            this.log(
              `restaurante ${tenantId}: mensagem de cliente recebida e descartada: INBOUND_URL não está configurada (a IA não fica sabendo)`,
            );
          }
          continue;
        }
        s.lastInboundAt = Date.now();
        s.unreadable = 0;
        try {
          this.opts.onInbound(msg);
        } catch (e) {
          this.log(
            `restaurante ${tenantId}: mensagem recebida não repassada (${(e as Error).message})`,
          );
        }
      }
    });
  }

  /** Larga o socket atual sem tratar a queda dele (os eventos de um socket antigo são ignorados). */
  private dropSocket(s: Session) {
    if (s.openTimer) clearTimeout(s.openTimer);
    s.openTimer = undefined;
    if (s.onlineTimer) clearTimeout(s.onlineTimer);
    s.onlineTimer = undefined;
    for (const t of s.pauseTimers.values()) clearTimeout(t);
    s.pauseTimers.clear();
    s.online = false;
    const sock = s.sock;
    s.sock = undefined;
    try {
      sock?.end();
    } catch {
      /* já fechado */
    }
  }

  private wake(s: Session) {
    for (const w of [...s.waiters]) w();
  }

  private waitChange(s: Session, ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        s.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      s.waiters.add(done);
    });
  }

  /**
   * Nova tentativa com espera crescente, ou logo (sorteada em até reconnectSpreadMs), ou já
   * (pedido do próprio WhatsApp depois do QR Code). Nunca desiste de uma sessão pareada.
   * A espera crescente também é sorteada (metade fixa + metade sorteada): depois de uma queda
   * geral, as sessões não ficam tentando todas no mesmo instante.
   */
  private scheduleReconnect(
    tenantId: string,
    s: Session,
    gen: number,
    when: 'backoff' | 'soon' | 'now' = 'backoff',
  ) {
    if (this.closed || s.gen !== gen) return;
    if (s.timer) clearTimeout(s.timer);
    s.status = 'connecting';
    const backoff = () => {
      const d = Math.min(
        this.t.backoffMaxMs,
        this.t.backoffBaseMs * 2 ** Math.min(s.retries++, 16),
      );
      return d / 2 + Math.random() * (d / 2);
    };
    const delay =
      when === 'now' ? 0 : when === 'soon' ? Math.random() * this.t.reconnectSpreadMs : backoff();
    s.timer = setTimeout(() => {
      s.timer = undefined;
      void this.reconnect(tenantId, s, gen);
    }, delay);
  }

  private onClose(
    tenantId: string,
    s: Session,
    gen: number,
    u: ConnectionUpdate,
    registered: boolean,
  ) {
    this.dropSocket(s); // o Baileys já fechou este
    const code = statusCode(u.lastDisconnect?.error);
    const stop = (status: SessionStatus, error: string, wipe: boolean) => {
      s.gen++;
      s.status = status;
      s.qr = undefined;
      s.error = error;
      if (wipe) {
        s.phone = undefined;
        s.registered = false;
        s.lastInboundAt = undefined;
        s.unreadable = 0;
        s.jids.clear();
        const saving = s.saving;
        s.removing = Promise.resolve(saving)
          .then(() => removeAuthState(this.dataDir, tenantId))
          .catch((e: Error) =>
            this.log(`restaurante ${tenantId}: sessão não apagada (${e.message})`),
          );
      }
      this.log(`restaurante ${tenantId}: ${error}`);
      this.wake(s);
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
    if (code === R.versionRejected) this.opts.onVersionRejected?.();
    // Ainda sem parear (esperando o QR Code): não fica em "Conectando..." para sempre se o
    // WhatsApp recusar de novo e de novo; para, apaga a sessão incompleta e diz o que fazer.
    if (!registered && !s.registered && code !== R.restartRequired && s.retries >= QR_MAX_RETRIES) {
      this.log(
        `restaurante ${tenantId}: QR Code recusado ${s.retries + 1} vezes (código ${code ?? '?'})`,
      );
      return stop(
        'disconnected',
        'O WhatsApp não abriu a conexão para o QR Code. Tente de novo em alguns minutos.',
        true,
      );
    }
    if (code !== R.restartRequired)
      this.log(`restaurante ${tenantId}: conexão caiu (código ${code ?? '?'}); reconectando`);
    // Depois de ler o QR Code o WhatsApp pede para reiniciar a conexão: na hora, sem espera.
    this.scheduleReconnect(tenantId, s, gen, code === R.restartRequired ? 'now' : 'backoff');
  }

  private async reconnect(tenantId: string, s: Session, gen: number) {
    try {
      await this.connect(tenantId, s, gen);
    } catch (e) {
      if (s.gen !== gen) return;
      s.gen++;
      s.status = 'disconnected';
      s.error = 'Não foi possível abrir a sessão salva. Desconecte e conecte de novo.';
      this.log(`restaurante ${tenantId}: reconexão falhou (${(e as Error).message})`);
      this.wake(s);
    }
  }

  /**
   * Vigia (a cada heartbeatMs): conexão aberta mas fechada por baixo ou muda há mais de staleMs
   * é derrubada e religada; sessão pareada sem socket e sem religação agendada volta a tentar.
   */
  watchdog(now = Date.now()) {
    if (this.closed) return;
    for (const [tenantId, s] of this.sessions) {
      if (s.timer || s.opening) continue; // religação já agendada ou em andamento
      if (s.status === 'connected' && s.sock) {
        const wsOpen = s.sock.ws?.isOpen !== false;
        const idle = now - s.lastRecvAt;
        if (wsOpen && idle <= this.t.staleMs) continue;
        this.log(
          `restaurante ${tenantId}: ${
            wsOpen ? `conexão muda há ${Math.round(idle / 1000)}s` : 'websocket fechado sem aviso'
          }; religando`,
        );
        this.dropSocket(s);
        this.scheduleReconnect(tenantId, s, s.gen, 'soon');
      } else if (s.status === 'connecting' && !s.sock && s.registered) {
        this.scheduleReconnect(tenantId, s, s.gen, 'soon');
      }
    }
  }

  /** O socket morreu por baixo (ping ou envio falhou): derruba e religa na hora. */
  private broken(tenantId: string, s: Session, sock: SocketLike, why: string) {
    if (s.sock !== sock) return;
    this.log(`restaurante ${tenantId}: ${why}; religando`);
    this.dropSocket(s);
    this.scheduleReconnect(tenantId, s, s.gen, 'now'); // tem um envio esperando
  }

  private async ping(sock: SocketLike, timeoutMs: number) {
    if (!sock.query || !sock.generateMessageTag) return true;
    try {
      await sock.query(
        {
          tag: 'iq',
          attrs: { id: sock.generateMessageTag(), to: 's.whatsapp.net', type: 'get', xmlns: 'w:p' },
          content: [{ tag: 'ping', attrs: {} }],
        },
        timeoutMs,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Socket pronto para enviar. Conexão caída de uma sessão pareada: espera a religação (até
   * waitMs). Conexão parada há mais tempo que o ping: manda um ping antes, para não mandar
   * mensagem por um socket meio-aberto.
   */
  private async ready(
    tenantId: string,
    waitMs = this.t.sendWaitMs,
  ): Promise<[Session, SocketLike]> {
    const s = this.sessions.get(tenantId);
    if (!s) throw new NotConnectedError();
    const deadline = Date.now() + waitMs;
    for (let probes = 0; ; probes++) {
      const sock = s.sock;
      if (s.status === 'connected' && sock) {
        if (probes > 0 || Date.now() - s.lastRecvAt < this.t.keepAliveMs * 1.5) return [s, sock];
        if (await this.ping(sock, Math.min(8000, Math.max(1000, deadline - Date.now())))) {
          if (s.sock === sock) s.lastRecvAt = Date.now();
          return [s, sock];
        }
        this.broken(tenantId, s, sock, 'sem resposta ao ping antes do envio');
      }
      if (this.closed || !s.registered || s.status !== 'connecting') throw new NotConnectedError();
      const left = deadline - Date.now();
      if (left <= 0)
        throw new NotConnectedError('WhatsApp reconectando; tente de novo em instantes');
      await this.waitChange(s, left);
    }
  }

  /** Roda uma ação no socket; se ele morrer no meio, religa e tenta mais uma vez. */
  private async run<T>(
    tenantId: string,
    fn: (s: Session, sock: SocketLike) => Promise<T>,
    waitMs?: number,
  ): Promise<T> {
    const [s, sock] = await this.ready(tenantId, waitMs);
    try {
      return await fn(s, sock);
    } catch (e) {
      if (!isConnectionError(e)) throw e;
      this.broken(
        tenantId,
        s,
        sock,
        `envio falhou com a conexão quebrada (${(e as Error).message})`,
      );
      const [s2, sock2] = await this.ready(tenantId, waitMs);
      return fn(s2, sock2);
    }
  }

  /**
   * Reinicia a conexão sem desconectar o aparelho (botão "Reiniciar conexão" da tela WhatsApp):
   * derruba o socket e abre de novo na hora com as credenciais salvas. Sessão que não está na
   * memória (ou caiu) e tem credenciais em disco reabre como na subida do serviço; sem
   * credenciais não gera QR Code sozinha.
   */
  async restart(tenantId: string) {
    const s = this.sessions.get(tenantId);
    if (!s || !s.registered) {
      if (!s || s.status === 'disconnected' || s.status === 'logged_out')
        return this.start(tenantId, true);
      return this.status(tenantId);
    }
    if (s.timer) clearTimeout(s.timer);
    s.timer = undefined;
    const gen = ++s.gen;
    this.dropSocket(s);
    s.status = 'connecting';
    s.error = undefined;
    s.retries = 0;
    this.wake(s);
    void this.reconnect(tenantId, s, gen);
    return this.status(tenantId);
  }

  async logout(tenantId: string) {
    const s = this.sessions.get(tenantId);
    const sock = s?.sock;
    if (s) {
      if (s.timer) clearTimeout(s.timer);
      s.timer = undefined;
      s.gen++;
      s.sock = undefined; // dropSocket encerraria o socket antes do logout
      this.dropSocket(s);
      s.status = 'logged_out';
      s.registered = false;
      s.phone = undefined;
      s.lastInboundAt = undefined;
      s.unreadable = 0;
      s.qr = undefined;
      s.error = undefined;
      s.jids.clear();
      s.recent.clear();
      this.wake(s);
    }
    try {
      await sock?.logout();
    } catch {
      sock?.end();
    }
    await s?.saving;
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

  private async target(s: Session, sock: SocketLike, t: Target) {
    if ('jid' in t) return t.jid;
    const jid = await this.resolveJid(s, sock, t.to);
    if (!jid) throw new NotOnWhatsAppError();
    return jid;
  }

  /** Liga o "online" do número por um tempo (e volta para "offline", para o celular notificar). */
  private async goOnline(s: Session, sock: SocketLike, ms = this.t.onlineMs) {
    if (!sock.sendPresenceUpdate) return;
    if (s.onlineTimer) clearTimeout(s.onlineTimer);
    s.onlineTimer = setTimeout(() => {
      s.onlineTimer = undefined;
      if (s.sock !== sock || !s.online) return;
      s.online = false;
      void sock.sendPresenceUpdate?.('unavailable').catch(() => undefined);
    }, ms);
    s.onlineTimer.unref();
    if (s.online) return;
    s.online = true;
    await withTimeout(sock.sendPresenceUpdate('available'), EXTRA_TIMEOUT_MS, 'presença').catch(
      () => undefined,
    );
  }

  private async goOffline(s: Session, sock: SocketLike) {
    if (s.onlineTimer) clearTimeout(s.onlineTimer);
    s.onlineTimer = undefined;
    s.online = false;
    await sock.sendPresenceUpdate?.('unavailable');
  }

  /** "digitando..." (ou "gravando áudio...") na conversa por ms; chamar de novo renova. */
  private async startTyping(
    s: Session,
    sock: SocketLike,
    jid: string,
    ms: number,
    kind: 'typing' | 'recording' = 'typing',
  ) {
    if (!sock.sendPresenceUpdate) return;
    await this.goOnline(s, sock, Math.max(this.t.onlineMs, ms));
    clearTimeout(s.pauseTimers.get(jid));
    await withTimeout(
      sock.sendPresenceUpdate(kind === 'recording' ? 'recording' : 'composing', jid),
      EXTRA_TIMEOUT_MS,
      'presença',
    );
    const t = setTimeout(() => {
      s.pauseTimers.delete(jid);
      if (s.sock === sock) void sock.sendPresenceUpdate?.('paused', jid).catch(() => undefined);
    }, ms);
    t.unref();
    s.pauseTimers.set(jid, t);
  }

  /**
   * Reserva a vez deste número enviar: mensagens do mesmo número saem com pelo menos sendGapMs
   * entre uma e outra (com um pouco de sorteio), como uma pessoa digitando. Muitos envios de uma
   * vez (ex.: uma rajada de avisos) entram na fila; fila longa demais responde "muitas mensagens"
   * e quem chamou tenta de novo mais tarde (a fila de avisos da API já faz isso).
   */
  private async pace(s: Session) {
    if (this.t.sendGapMs <= 0) return;
    const now = Date.now();
    const at = Math.max(now, s.nextSendAt);
    if (at - now > this.t.sendQueueMaxMs) throw new TooManyMessagesError();
    s.nextSendAt = at + this.t.sendGapMs * (0.8 + Math.random() * 0.4);
    if (at > now) await sleep(at - now);
  }

  /**
   * Envia texto. Com typingMs mostra "digitando..." antes (resposta com cara de gente) e o número
   * fica "online" um pouco depois; sem, sai direto (avisos de pedido).
   */
  async send(tenantId: string, dest: Target, text: string, typingMs = 0) {
    return this.run(tenantId, async (s, sock) => {
      const jid = await this.target(s, sock, dest);
      if (typingMs > 0) {
        const ms = Math.min(typingMs, 8000);
        await this.startTyping(s, sock, jid, ms + 1000).catch(() => undefined);
        await sleep(ms);
      }
      await this.pace(s);
      const r = await withTimeout(
        sock.sendMessage(jid, { text }),
        this.t.sendTimeoutMs,
        () => new SendUncertainError(),
      );
      if (typingMs > 0 && s.sock === sock) {
        clearTimeout(s.pauseTimers.get(jid));
        s.pauseTimers.delete(jid);
        void sock.sendPresenceUpdate?.('paused', jid).catch(() => undefined);
        void this.goOnline(s, sock); // fica "online" mais um pouco e volta a "offline"
      }
      const id = r?.key?.id ?? null;
      if (id) remember(s.recent, id, text, RECENT_MAX);
      return { id, jid };
    });
  }

  /**
   * Envia um arquivo (cardápio do restaurante, calendário de reservas) com legenda opcional: PDF
   * como documento, foto como imagem. Respeita o mesmo ritmo do número que o texto. Não entra no
   * cache de reenvio (só texto entra).
   */
  async sendDocument(tenantId: string, dest: Target, doc: OutgoingFile) {
    return this.run(tenantId, async (s, sock) => {
      const jid = await this.target(s, sock, dest);
      await this.pace(s);
      const caption = doc.caption ? { caption: doc.caption } : {};
      const r = await withTimeout(
        sock.sendMessage(
          jid,
          doc.mimetype === 'application/pdf'
            ? { document: doc.data, mimetype: doc.mimetype, fileName: doc.fileName, ...caption }
            : { image: doc.data, mimetype: doc.mimetype, ...caption },
        ),
        this.t.sendTimeoutMs,
        () => new SendUncertainError(),
      );
      return { id: r?.key?.id ?? null, jid };
    });
  }

  async typing(tenantId: string, dest: Target, ms: number, kind?: 'typing' | 'recording') {
    await this.run(
      tenantId,
      async (s, sock) =>
        this.startTyping(
          s,
          sock,
          await this.target(s, sock, dest),
          Math.min(ms, MAX_TYPING_MS),
          kind,
        ),
      EXTRA_TIMEOUT_MS,
    );
    return { ok: true };
  }

  /** Marca a mensagem recebida como lida (tiques azuis no celular do cliente). */
  async markRead(tenantId: string, jid: string, id: string) {
    await this.run(
      tenantId,
      async (_s, sock) => {
        if (!sock.readMessages) return;
        await withTimeout(
          sock.readMessages([{ remoteJid: jid, id, fromMe: false }]),
          EXTRA_TIMEOUT_MS,
          'WhatsApp não confirmou a leitura',
        );
      },
      EXTRA_TIMEOUT_MS,
    );
    return { ok: true };
  }

  /** Reação (emoji) numa mensagem recebida; emoji vazio tira a reação. */
  async react(tenantId: string, jid: string, id: string, emoji: string) {
    await this.run(
      tenantId,
      async (_s, sock) => {
        await withTimeout(
          sock.sendMessage(jid, {
            react: { text: emoji, key: { remoteJid: jid, id, fromMe: false } },
          }),
          EXTRA_TIMEOUT_MS,
          'WhatsApp não confirmou a reação',
        );
      },
      EXTRA_TIMEOUT_MS,
    );
    return { ok: true };
  }

  /** "online" por ms (padrão onlineMs) ou "offline" na hora. */
  async presence(tenantId: string, state: 'available' | 'unavailable', ms?: number) {
    await this.run(
      tenantId,
      async (s, sock) =>
        state === 'available' ? this.goOnline(s, sock, ms) : this.goOffline(s, sock),
      EXTRA_TIMEOUT_MS,
    );
    return { ok: true };
  }

  close() {
    this.closed = true;
    clearInterval(this.heartbeat);
    for (const s of this.sessions.values()) {
      if (s.timer) clearTimeout(s.timer);
      s.timer = undefined;
      s.gen++;
      this.dropSocket(s);
      this.wake(s);
    }
  }
}

export class NotConnectedError extends Error {
  constructor(msg = 'WhatsApp do restaurante não está conectado') {
    super(msg);
  }
}

export class TooManyMessagesError extends Error {
  constructor() {
    super('Muitas mensagens deste número agora; tente de novo em instantes');
  }
}

/**
 * O WhatsApp não confirmou a tempo, mas a mensagem já foi entregue ao socket e pode ter saído.
 * Quem chamou não deve tentar de novo sozinho (o cliente receberia duas vezes).
 */
export class SendUncertainError extends Error {
  constructor() {
    super(
      'Envio incerto: o WhatsApp não confirmou a tempo. Confira na conversa antes de reenviar.',
    );
  }
}

export class NotOnWhatsAppError extends Error {
  constructor() {
    super('Este número não tem WhatsApp');
  }
}
