import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { WhatsAppUnavailableError } from './whatsapp.client';

export interface GatewaySession {
  status: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged_out';
  qr?: string;
  phone?: string;
  error?: string;
  /** "connecting" de uma sessão já pareada: caiu e está religando sozinha */
  reconnecting?: boolean;
  /** conectado: último sinal recebido do WhatsApp (ISO) */
  lastActivityAt?: string;
  /** última mensagem de cliente que chegou e foi repassada à API (ISO) */
  lastInboundAt?: string;
  /** mensagens de cliente seguidas que chegaram sem abrir neste aparelho */
  unreadable?: number;
  /** o gateway está sem INBOUND_URL: as mensagens dos clientes não chegam à API (nem à IA) */
  inboundOff?: boolean;
}

/**
 * O envio pode ter saído (o WhatsApp não confirmou a tempo, ou o gateway não respondeu): marca como
 * falha e NÃO tenta de novo sozinho, senão o cliente recebe o aviso duas vezes.
 */
export const UNCERTAIN_SEND =
  'Envio incerto: o WhatsApp não confirmou a tempo. Confira na conversa antes de reenviar.';

/**
 * Espera do envio pela API: acima do pior caso do gateway (religação 12 s + consulta do número
 * 15 s + digitando 9 s + fila do número 15 s + confirmação 15 s).
 */
const SEND_TIMEOUT_MS = 75_000;

type SendResult =
  { ok: true; messageId?: string; jid?: string } | { ok: false; error: string; uncertain?: true };

/** Destino: número só com dígitos (o gateway acha o JID) ou o JID de uma conversa recebida. */
const dest = (to: string) => (to.includes('@') ? { jid: to } : { to });

/**
 * Cliente do serviço interno de WhatsApp (Baileys). O restaurante vai na URL e vem sempre do
 * contexto resolvido pela API (Host), nunca do navegador. Autenticação por token interno.
 */
type Uncertain = { error?: string; uncertain?: boolean };

@Injectable()
export class GatewayClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  get configured() {
    return !!(this.env.WHATSAPP_GATEWAY_URL && this.env.WHATSAPP_GATEWAY_TOKEN);
  }

  private async call<T>(
    tenantId: string,
    method: 'GET' | 'POST',
    path = '',
    body?: unknown,
    timeoutMs = 20_000,
    /** Envio de mensagem: passou do prazo depois de mandar = "incerto" (pode ter saído). */
    sending = false,
  ) {
    if (!this.configured)
      throw new ServiceUnavailableException('Serviço de WhatsApp não configurado no servidor');
    const base = this.env.WHATSAPP_GATEWAY_URL!.replace(/\/+$/, '');
    let res: Response;
    try {
      res = await fetch(`${base}/v1/sessions/${encodeURIComponent(tenantId)}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.env.WHATSAPP_GATEWAY_TOKEN}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Sem resposta no prazo: o gateway recebeu o pedido e pode ter enviado (falha de conexão
      // antes disso, como gateway fora do ar, responde na hora e segue "indisponível").
      if (sending && (err as Error).name === 'TimeoutError')
        return { http: 504, body: { error: UNCERTAIN_SEND, uncertain: true } as T & Uncertain };
      throw new WhatsAppUnavailableError(
        `Serviço de WhatsApp indisponível: ${(err as Error).message}`,
      );
    }
    const json = (await res.json().catch(() => ({}))) as T & Uncertain;
    if (sending && res.status === 504 && json.uncertain === true)
      return { http: 504, body: { ...json, error: UNCERTAIN_SEND } };
    // 429: o número do restaurante já tem muitas mensagens na fila (ritmo contra bloqueio).
    if (res.status >= 500 || res.status === 429)
      throw new WhatsAppUnavailableError(`Serviço de WhatsApp respondeu ${res.status}`);
    return { http: res.status, body: json };
  }

  async session(tenantId: string) {
    return (await this.call<GatewaySession>(tenantId, 'GET')).body;
  }
  async start(tenantId: string) {
    return (await this.call<GatewaySession>(tenantId, 'POST', '/start')).body;
  }
  async logout(tenantId: string) {
    return (await this.call<GatewaySession>(tenantId, 'POST', '/logout')).body;
  }
  /**
   * 409 = WhatsApp do restaurante desconectado (tentar de novo mais tarde). Se a conexão estiver
   * religando, o gateway espera ela voltar (alguns segundos) antes de responder.
   * `to`: número (dígitos) ou o JID de uma conversa recebida (WhatsAppInbound.jid).
   * `typingMs`: mostra "digitando..." por esse tempo (até 8 s) antes de enviar.
   */
  async send(
    tenantId: string,
    to: string,
    text: string,
    opts: { typingMs?: number } = {},
  ): Promise<SendResult> {
    const r = await this.call<{ id?: string | null; jid?: string }>(
      tenantId,
      'POST',
      '/messages',
      { ...dest(to), text, ...(opts.typingMs ? { typingMs: opts.typingMs } : {}) },
      SEND_TIMEOUT_MS,
      true,
    );
    // jid: a conversa de verdade que o gateway achou para o número (ex.: com ou sem o 9).
    if (r.http === 200) return { ok: true, messageId: r.body.id ?? undefined, jid: r.body.jid };
    if (r.http === 409) throw new WhatsAppUnavailableError(r.body.error ?? 'WhatsApp desconectado');
    if (r.body.uncertain) return { ok: false, error: UNCERTAIN_SEND, uncertain: true };
    return { ok: false, error: r.body.error ?? `HTTP ${r.http}` };
  }

  /**
   * Manda um PDF (cardápio, calendário de reservas) na conversa, até 3 MB. Mesmos códigos do
   * envio de texto (409 = desconectado, `uncertain` = pode ter saído).
   */
  async sendDocument(
    tenantId: string,
    to: string,
    doc: { data: Uint8Array; fileName: string; caption?: string },
  ): Promise<SendResult> {
    const r = await this.call<{ id?: string | null }>(
      tenantId,
      'POST',
      '/document',
      {
        ...dest(to),
        fileName: doc.fileName,
        caption: doc.caption,
        data: Buffer.from(doc.data).toString('base64'),
      },
      SEND_TIMEOUT_MS,
      true,
    );
    if (r.http === 200) return { ok: true, messageId: r.body.id ?? undefined };
    if (r.http === 409) throw new WhatsAppUnavailableError(r.body.error ?? 'WhatsApp desconectado');
    if (r.body.uncertain) return { ok: false, error: UNCERTAIN_SEND, uncertain: true };
    return { ok: false, error: r.body.error ?? `HTTP ${r.http}` };
  }

  /** Ações acessórias (digitando, lido, reação, online): falha não interrompe a conversa. */
  private async extra(tenantId: string, path: string, body: unknown) {
    const r = await this.call<{ ok?: boolean }>(tenantId, 'POST', path, body, 10_000);
    return r.http === 200;
  }

  /** "digitando..." (ou "gravando áudio...") na conversa por ms (até 25 s); chamar de novo renova. */
  typing(tenantId: string, to: string, ms = 5000, kind: 'typing' | 'recording' = 'typing') {
    return this.extra(tenantId, '/typing', { ...dest(to), ms, kind });
  }

  /** Marca a mensagem recebida como lida (tiques azuis). */
  markRead(tenantId: string, jid: string, messageId: string) {
    return this.extra(tenantId, '/read', { jid, id: messageId });
  }

  /** Reage com um emoji (vazio tira a reação). */
  react(tenantId: string, jid: string, messageId: string, emoji: string) {
    return this.extra(tenantId, '/react', { jid, id: messageId, emoji });
  }

  /**
   * "online" por ms (padrão: 1 min) ou "offline". Depois de cada resposta com typingMs o número já
   * fica online um minuto e volta sozinho a offline (para o celular da loja seguir notificando).
   */
  presence(tenantId: string, state: 'available' | 'unavailable', ms?: number) {
    return this.extra(tenantId, '/presence', { state, ...(ms ? { ms } : {}) });
  }
}
