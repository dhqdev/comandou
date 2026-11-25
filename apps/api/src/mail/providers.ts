import { Address, formatAddress } from './address';

/**
 * Quem leva o e-mail até a caixa do destinatário: o Comandou monta a mensagem e o Resend (API)
 * entrega.
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
  /** Message-ID já com < >. */
  rfcId?: string;
  /**
   * Mesma chave em toda tentativa do mesmo e-mail: o provedor não manda duas vezes quando a resposta
   * do primeiro envio se perdeu (tempo esgotado depois de aceitar).
   */
  idempotencyKey?: string;
  /** In-Reply-To, References e cabeçalhos X-. */
  headers: Record<string, string>;
  attachments: OutgoingAttachment[];
}

export type ProviderConfig = { provider: 'resend'; apiKey: string };

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

async function viaResend(
  cfg: ProviderConfig,
  m: OutgoingMail,
  fetcher: Fetcher,
): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        ...(m.idempotencyKey ? { 'Idempotency-Key': m.idempotencyKey } : {}),
      },
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

export async function sendThrough(
  cfg: ProviderConfig,
  mail: OutgoingMail,
  fetcher: Fetcher = fetch,
): Promise<SendResult> {
  if (!mail.to.length && !mail.cc.length && !mail.bcc.length)
    throw new MailSendError('E-mail sem destinatário', true);
  if (!mail.html && !mail.text) throw new MailSendError('E-mail sem conteúdo', true);
  return viaResend(cfg, mail, fetcher);
}
