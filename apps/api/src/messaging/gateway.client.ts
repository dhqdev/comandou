import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { WhatsAppUnavailableError } from './whatsapp.client';

export interface GatewaySession {
  status: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged_out';
  qr?: string;
  phone?: string;
}

/**
 * Cliente do serviço interno de WhatsApp (Baileys). O restaurante vai na URL e vem sempre do
 * contexto resolvido pela API (Host), nunca do navegador. Autenticação por token interno.
 */
@Injectable()
export class GatewayClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  get configured() {
    return !!(this.env.WHATSAPP_GATEWAY_URL && this.env.WHATSAPP_GATEWAY_TOKEN);
  }

  private async call<T>(tenantId: string, method: 'GET' | 'POST', path = '', body?: unknown) {
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
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new WhatsAppUnavailableError(
        `Serviço de WhatsApp indisponível: ${(err as Error).message}`,
      );
    }
    if (res.status >= 500)
      throw new WhatsAppUnavailableError(`Serviço de WhatsApp respondeu ${res.status}`);
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
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
  /** 409 = WhatsApp do restaurante desconectado (tentar de novo mais tarde). */
  async send(tenantId: string, to: string, text: string) {
    const r = await this.call<{ id?: string | null }>(tenantId, 'POST', '/messages', { to, text });
    if (r.http === 200) return { ok: true as const, messageId: r.body.id ?? undefined };
    if (r.http === 409) throw new WhatsAppUnavailableError(r.body.error ?? 'WhatsApp desconectado');
    return { ok: false as const, error: r.body.error ?? `HTTP ${r.http}` };
  }
}
