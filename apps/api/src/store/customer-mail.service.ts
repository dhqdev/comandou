import { Inject, Injectable, Logger } from '@nestjs/common';
import { open } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import { PlatformDb } from '../platform/platform-db.service';

/** Contexto do segredo do webhook de e-mail para os clientes (Super Admin › Site). */
export const CUSTOMER_EMAIL_SECRET_CONTEXT = 'site:customer-email';

export interface CustomerEmail {
  event: string;
  to: string;
  toName?: string | null;
  /** Nome do remetente: o restaurante. */
  fromName: string;
  subject: string;
  html: string;
  text: string;
  [k: string]: unknown;
}

/**
 * E-mails para os clientes dos restaurantes pelo webhook do n8n configurado em Super Admin › Site
 * ("E-mail para os clientes"). O Comandou monta o e-mail pronto e o n8n só envia. Sem webhook,
 * não manda nada.
 */
@Injectable()
export class CustomerMailService {
  private readonly logger = new Logger('CustomerMail');

  constructor(
    private readonly platform: PlatformDb,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async config() {
    if (!this.platform.enabled) return null;
    const [s] = await this.platform
      .query<{ url: string; token_enc: Buffer | null }>(
        `SELECT customer_email_webhook_url AS url, customer_email_token_enc AS token_enc
           FROM platform_site_settings WHERE id`,
      )
      .catch(() => []);
    return s?.url ? s : null;
  }

  /** Tem webhook para mandar e-mail ao cliente? */
  async ready() {
    return !!(await this.config());
  }

  /** Envia; devolve false se não tem webhook ou se o n8n não aceitou. Nunca registra o código. */
  async send(mail: CustomerEmail): Promise<boolean> {
    const s = await this.config();
    if (!s) return false;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (s.token_enc && this.env.INTEGRATIONS_KEY) {
      try {
        headers['X-Comandou-Token'] = open(
          this.env.INTEGRATIONS_KEY,
          s.token_enc,
          CUSTOMER_EMAIL_SECRET_CONTEXT,
        );
      } catch {
        this.logger.warn('o segredo do webhook de e-mail dos clientes precisa ser salvo de novo');
        return false;
      }
    }
    try {
      const res = await fetch(s.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(mail),
        signal: AbortSignal.timeout(15_000),
      });
      await res.body?.cancel().catch(() => undefined);
      if (!res.ok) this.logger.warn(`webhook de e-mail dos clientes respondeu ${res.status}`);
      return res.ok;
    } catch (e) {
      this.logger.warn(
        `não deu para chamar o webhook de e-mail dos clientes: ${(e as Error).message}`,
      );
      return false;
    }
  }
}
