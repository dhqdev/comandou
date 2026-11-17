import nodemailer from 'nodemailer';
import { Address, cleanHeader, formatAddress } from './address';

/**
 * Quem leva o e-mail até a caixa do destinatário. O Comandou monta a mensagem e um destes
 * serviços entrega: Cloudflare Email Sending (API), Resend (API) ou qualquer servidor SMTP.
 */

export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  contentId?: string | null;
  data: Buffer;
}

export interface OutgoingMail {
  from: Address;
  replyTo?: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html?: string;
  text?: string;
  /** Message-ID já com < > (Resend e SMTP usam; a Cloudflare cria o dela). */
  rfcId?: string;
  /** In-Reply-To, References e cabeçalhos X-. */
  headers: Record<string, string>;
  attachments: OutgoingAttachment[];
}

export type ProviderConfig =
  | { provider: 'cloudflare'; accountId: string; token: string }
  | { provider: 'resend'; apiKey: string }
  | {
      provider: 'smtp';
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
    };

export type ProviderName = ProviderConfig['provider'];

/** `permanent`: tentar de novo não adianta (endereço recusado, domínio sem liberação, chave errada). */
export class MailSendError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message.slice(0, 480));
  }
}

export interface SendResult {
  /** Message-ID que o provedor deu ao e-mail (quando informa). */
  rfcId: string | null;
  providerId: string | null;
}

export type Fetcher = typeof fetch;

const TIMEOUT_MS = 30_000;

function timeoutError(e: unknown, who: string): MailSendError {
  const err = e as Error;
  return new MailSendError(
    `${who} não respondeu (${err.name === 'TimeoutError' ? 'tempo esgotado' : err.message})`,
    false,
  );
}

/** Erro do servidor ou limite de envio: vale tentar depois. O resto é erro do pedido. */
const retryable = (status: number) => status === 408 || status === 429 || status >= 500;

async function viaCloudflare(
  cfg: Extract<ProviderConfig, { provider: 'cloudflare' }>,
  m: OutgoingMail,
  fetcher: Fetcher,
): Promise<SendResult> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfg.accountId)}/email/sending/send`;
  const body = (from: string) =>
    JSON.stringify({
      from,
      to: m.to.map((a) => a.email),
      ...(m.cc.length ? { cc: m.cc.map((a) => a.email) } : {}),
      ...(m.bcc.length ? { bcc: m.bcc.map((a) => a.email) } : {}),
      ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      subject: m.subject,
      ...(m.html ? { html: m.html } : {}),
      ...(m.text ? { text: m.text } : {}),
      ...(Object.keys(m.headers).length ? { headers: m.headers } : {}),
      ...(m.attachments.length
        ? {
            attachments: m.attachments.map((a) => ({
              content: a.data.toString('base64'),
              filename: a.filename,
              type: a.contentType,
              disposition: a.contentId ? 'inline' : 'attachment',
              ...(a.contentId ? { content_id: a.contentId } : {}),
            })),
          }
        : {}),
    });
  const post = async (from: string) => {
    let res: Response;
    try {
      res = await fetcher(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
        body: body(from),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw timeoutError(e, 'A Cloudflare');
    }
    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      errors?: { code?: number; message?: string }[];
      result?: { message_id?: string; permanent_bounces?: string[] } | null;
    } | null;
    return { res, json };
  };
  let { res, json } = await post(formatAddress(m.from));
  // Remetente com nome recusado pelo formato: tenta só com o endereço.
  if (res.status === 400 && m.from.name) ({ res, json } = await post(m.from.email));
  if (!res.ok || !json?.success) {
    const why = json?.errors?.map((e) => `${e.code ?? ''} ${e.message ?? ''}`.trim()).join('; ');
    throw new MailSendError(
      `A Cloudflare recusou o envio (HTTP ${res.status}${why ? `: ${why}` : ''})`,
      !retryable(res.status),
    );
  }
  const bounced = json.result?.permanent_bounces ?? [];
  if (bounced.length && bounced.length >= m.to.length + m.cc.length + m.bcc.length)
    throw new MailSendError(`Endereço recusado: ${bounced.join(', ')}`, true);
  const id = json.result?.message_id ?? null;
  return { rfcId: id ? (id.startsWith('<') ? id : `<${id}>`) : null, providerId: id };
}

async function viaResend(
  cfg: Extract<ProviderConfig, { provider: 'resend' }>,
  m: OutgoingMail,
  fetcher: Fetcher,
): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: formatAddress(m.from),
        to: m.to.map((a) => a.email),
        ...(m.cc.length ? { cc: m.cc.map((a) => a.email) } : {}),
        ...(m.bcc.length ? { bcc: m.bcc.map((a) => a.email) } : {}),
        ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        subject: m.subject,
        ...(m.html ? { html: m.html } : {}),
        ...(m.text ? { text: m.text } : {}),
        headers: { ...m.headers, ...(m.rfcId ? { 'Message-ID': m.rfcId } : {}) },
        ...(m.attachments.length
          ? {
              attachments: m.attachments.map((a) => ({
                filename: a.filename,
                content: a.data.toString('base64'),
                content_type: a.contentType,
                ...(a.contentId ? { content_id: a.contentId } : {}),
              })),
            }
          : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw timeoutError(e, 'O Resend');
  }
  const json = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!res.ok)
    throw new MailSendError(
      `O Resend recusou o envio (HTTP ${res.status}${json?.message ? `: ${json.message}` : ''})`,
      !retryable(res.status),
    );
  return { rfcId: m.rfcId ?? null, providerId: json?.id ?? null };
}

async function viaSmtp(
  cfg: Extract<ProviderConfig, { provider: 'smtp' }>,
  m: OutgoingMail,
): Promise<SendResult> {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: TIMEOUT_MS,
  });
  const addr = (a: Address) => ({ name: cleanHeader(a.name ?? ''), address: a.email });
  try {
    const info = await transport.sendMail({
      from: addr(m.from),
      to: m.to.map(addr),
      cc: m.cc.map(addr),
      bcc: m.bcc.map(addr),
      replyTo: m.replyTo || undefined,
      subject: m.subject,
      html: m.html,
      text: m.text,
      messageId: m.rfcId,
      headers: m.headers,
      attachments: m.attachments.map((a) => ({
        filename: a.filename,
        content: a.data,
        contentType: a.contentType,
        ...(a.contentId ? { cid: a.contentId } : {}),
      })),
    });
    return { rfcId: info.messageId ?? m.rfcId ?? null, providerId: info.messageId ?? null };
  } catch (e) {
    const err = e as Error & { responseCode?: number; code?: string };
    // 5xx do SMTP é recusa definitiva (caixa não existe, remetente não autorizado).
    const permanent =
      (typeof err.responseCode === 'number' && err.responseCode >= 500) || err.code === 'EAUTH';
    throw new MailSendError(`O servidor SMTP recusou o envio: ${err.message}`, permanent);
  } finally {
    transport.close();
  }
}

export async function sendThrough(
  cfg: ProviderConfig,
  mail: OutgoingMail,
  fetcher: Fetcher = fetch,
): Promise<SendResult> {
  if (!mail.to.length && !mail.cc.length && !mail.bcc.length)
    throw new MailSendError('E-mail sem destinatário', true);
  if (!mail.html && !mail.text) throw new MailSendError('E-mail sem conteúdo', true);
  if (cfg.provider === 'cloudflare') return viaCloudflare(cfg, mail, fetcher);
  if (cfg.provider === 'resend') return viaResend(cfg, mail, fetcher);
  return viaSmtp(cfg, mail);
}
