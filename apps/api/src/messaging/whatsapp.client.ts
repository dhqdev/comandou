import { Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../config/env';

/** Erro de rede/servidor da Meta: o envio deve ser tentado de novo. */
export class WhatsAppUnavailableError extends Error {}

export interface WhatsAppSend {
  phoneNumberId: string;
  token: string;
  to: string;
  template: string;
  language: string;
  params: string[];
}

export interface WhatsAppResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Envio de mensagem-modelo (template) pela WhatsApp Cloud API (oficial da Meta).
 * POST {graph}/{phone-number-id}/messages com Authorization: Bearer <token>.
 * Mensagens iniciadas pelo restaurante precisam de modelo aprovado na Meta.
 */
@Injectable()
export class WhatsAppClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async sendTemplate(m: WhatsAppSend): Promise<WhatsAppResult> {
    const base = this.env.WHATSAPP_GRAPH_URL.replace(/\/+$/, '');
    let res: Response;
    try {
      res = await fetch(`${base}/${encodeURIComponent(m.phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${m.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: m.to,
          type: 'template',
          template: {
            name: m.template,
            language: { code: m.language },
            ...(m.params.length
              ? {
                  components: [
                    { type: 'body', parameters: m.params.map((text) => ({ type: 'text', text })) },
                  ],
                }
              : {}),
          },
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new WhatsAppUnavailableError(`WhatsApp indisponível: ${(err as Error).message}`);
    }
    if (res.status >= 500 || res.status === 429)
      throw new WhatsAppUnavailableError(`WhatsApp respondeu ${res.status}`);
    const body = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { message?: string; code?: number };
    };
    const id = body.messages?.[0]?.id;
    if (res.ok && id) return { ok: true, messageId: id };
    const err = body.error?.message ?? `HTTP ${res.status}`;
    return { ok: false, error: body.error?.code ? `${err} (código ${body.error.code})` : err };
  }
}
