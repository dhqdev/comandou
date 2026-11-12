/**
 * Cliente mínimo da API do PagBank (https://developer.pagbank.com.br): Connect (aplicação, troca e
 * renovação do token), chave pública do cartão, pedido com split (cartão e Pix), consulta e
 * cancelamento. Tokens vão só no cabeçalho e nunca em log. Algumas respostas do PagBank não são
 * detalhadas na documentação: os campos são lidos de forma tolerante (`pick`).
 */
export type PagBankEnvironment = 'sandbox' | 'production';

/** O que o Comandou pede ao restaurante no Connect. */
export const PAGBANK_SCOPES = [
  'payments.read',
  'payments.create',
  'payments.refund',
  'accounts.read',
];

export class PagBankError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface PagBankTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  accountId: string | null;
}

export interface PagBankCharge {
  id: string;
  status: string;
  reference_id?: string;
  amount?: { value?: number; summary?: { total?: number; paid?: number; refunded?: number } };
  payment_response?: { code?: string; message?: string; reference?: string };
  payment_method?: {
    type?: string;
    card?: { brand?: string; last_digits?: string; first_digits?: string };
  };
}

export interface PagBankOrder {
  id: string;
  reference_id?: string;
  charges?: PagBankCharge[];
  qr_codes?: { id?: string; text?: string; expiration_date?: string }[];
  qr_code?: { id?: string; text?: string; expiration_date?: string }[];
}

/** Primeiro valor de texto entre os nomes possíveis (respostas do PagBank variam por produto). */
function pick(o: unknown, ...keys: string[]): string | null {
  if (!o || typeof o !== 'object') return null;
  for (const k of keys) {
    const v = (o as Record<string, unknown>)[k];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

/** Tokens do Connect a partir da resposta (nomes tolerantes; expires_in em segundos). */
export function tokensOf(body: unknown, now = Date.now()): PagBankTokens {
  const accessToken = pick(body, 'access_token', 'accessToken');
  if (!accessToken) throw new PagBankError('PagBank não devolveu o token de acesso', 502);
  const expiresIn = Number(pick(body, 'expires_in', 'expiresIn'));
  const expiresAtRaw = pick(body, 'expires_at', 'expiration_date', 'expiresAt');
  const expiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(now + expiresIn * 1000)
      : expiresAtRaw && !Number.isNaN(Date.parse(expiresAtRaw))
        ? new Date(expiresAtRaw)
        : null;
  const account = pick(body, 'account_id', 'accountId');
  return {
    accessToken,
    refreshToken: pick(body, 'refresh_token', 'refreshToken'),
    expiresAt,
    accountId: account && /^ACCO_[A-Za-z0-9-]{4,60}$/.test(account) ? account : null,
  };
}

/** Situação da cobrança no PagBank → situação no Comandou (null = continua esperando). */
export function chargeStatusOf(s: string | undefined): 'paid' | 'declined' | 'expired' | null {
  switch ((s ?? '').toUpperCase()) {
    case 'PAID':
      return 'paid';
    case 'DECLINED':
      return 'declined';
    case 'CANCELED':
    case 'CANCELLED':
      return 'expired';
    default:
      // AUTHORIZED (sem captura), IN_ANALYSIS, WAITING: espera.
      return null;
  }
}

/** Motivo da recusa para o cliente (sem códigos internos). */
export function declineReasonOf(c: PagBankCharge | undefined): string {
  const m = c?.payment_response?.message?.trim();
  return (m ? `Cartão recusado: ${m}` : 'Cartão recusado pelo banco').slice(0, 300);
}

export interface SplitReceiver {
  accountId: string;
  cents: number;
  reason: string;
}

export class PagBankClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 20_000,
  ) {}

  private async call<T>(
    method: string,
    path: string,
    opts: { token?: string; headers?: Record<string, string>; body?: unknown; idem?: string },
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
          ...(opts.idem ? { 'x-idempotency-key': opts.idem } : {}),
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'Comandou',
          ...opts.headers,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new PagBankError(`PagBank fora do ar ou sem resposta: ${(e as Error).message}`, 0);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const errs = (
        json as {
          error_messages?: { code?: string; description?: string; parameter_name?: string }[];
        } | null
      )?.error_messages;
      const msg = errs
        ?.map((e) => [e.description, e.parameter_name].filter(Boolean).join(': '))
        .filter(Boolean)
        .join('; ');
      throw new PagBankError(
        res.status === 401
          ? 'Token do PagBank recusado (confira a conta e o ambiente)'
          : `PagBank: ${msg || `erro ${res.status}`}`.slice(0, 280),
        res.status,
        errs?.[0]?.code,
      );
    }
    return json as T;
  }

  /** Aplicação do Connect (feita uma vez, com o token da conta da Comandou). */
  async createApplication(
    platformToken: string,
    a: { name: string; redirectUri: string; site?: string },
  ) {
    const r = await this.call<Record<string, unknown>>('POST', '/oauth2/application', {
      token: platformToken,
      body: {
        name: a.name,
        description: 'Pagamentos do cardápio online',
        site: a.site,
        redirect_uri: a.redirectUri,
      },
    });
    const clientId = pick(r, 'client_id', 'clientId', 'id');
    const clientSecret = pick(r, 'client_secret', 'clientSecret', 'secret');
    if (!clientId || !clientSecret)
      throw new PagBankError('PagBank não devolveu client_id e client_secret da aplicação', 502);
    return { clientId, clientSecret, accountId: pick(r, 'account_id') };
  }

  private appHeaders(app: { clientId: string; clientSecret: string }) {
    return { X_CLIENT_ID: app.clientId, X_CLIENT_SECRET: app.clientSecret };
  }

  /** Troca o código do Connect pelos tokens do restaurante. */
  async exchangeCode(
    app: { platformToken: string; clientId: string; clientSecret: string },
    code: string,
    redirectUri: string,
  ) {
    const r = await this.call<unknown>('POST', '/oauth2/token', {
      token: app.platformToken,
      headers: this.appHeaders(app),
      body: { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
    });
    return tokensOf(r);
  }

  async refresh(
    app: { platformToken: string; clientId: string; clientSecret: string },
    refreshToken: string,
  ) {
    const r = await this.call<unknown>('POST', '/oauth2/refresh', {
      token: app.platformToken,
      headers: this.appHeaders(app),
      body: { grant_type: 'refresh_token', refresh_token: refreshToken },
    });
    return tokensOf(r);
  }

  /** Chave pública para cifrar o cartão no navegador (da conta do restaurante). */
  async publicKey(sellerToken: string) {
    const r = await this.call<unknown>('POST', '/public-keys', {
      token: sellerToken,
      body: { type: 'card' },
    });
    const key = pick(r, 'public_key', 'publicKey', 'key');
    if (!key) throw new PagBankError('PagBank não devolveu a chave pública do cartão', 502);
    return key;
  }

  private splits(receivers: SplitReceiver[]) {
    return {
      method: 'FIXED',
      receivers: receivers.map((r) => ({
        account: { id: r.accountId },
        amount: { value: r.cents },
        reason: r.reason.slice(0, 255),
      })),
    };
  }

  /** Pedido pago com cartão cifrado (captura na hora). */
  cardOrder(
    sellerToken: string,
    o: {
      referenceId: string;
      description: string;
      customer: { name: string; email: string; taxId: string; phone: string };
      cents: number;
      encryptedCard: string;
      holder: { name: string; taxId: string };
      receivers: SplitReceiver[] | null;
      notifyUrl: string;
    },
  ) {
    return this.call<PagBankOrder>('POST', '/orders', {
      token: sellerToken,
      idem: o.referenceId,
      body: {
        reference_id: o.referenceId,
        customer: customerOf(o.customer),
        items: [
          { reference_id: o.referenceId, name: o.description, quantity: 1, unit_amount: o.cents },
        ],
        notification_urls: [o.notifyUrl],
        charges: [
          {
            reference_id: o.referenceId,
            description: o.description,
            amount: { value: o.cents, currency: 'BRL' },
            payment_method: {
              type: 'CREDIT_CARD',
              installments: 1,
              capture: true,
              card: {
                encrypted: o.encryptedCard,
                holder: { name: o.holder.name, tax_id: o.holder.taxId },
                store: false,
              },
            },
            ...(o.receivers ? { splits: this.splits(o.receivers) } : {}),
          },
        ],
      },
    });
  }

  /** Pedido com QR Code do Pix (vence em `expiresAt`). */
  pixOrder(
    sellerToken: string,
    o: {
      referenceId: string;
      description: string;
      customer: { name: string; email: string; taxId: string; phone: string };
      cents: number;
      expiresAt: Date;
      receivers: SplitReceiver[] | null;
      notifyUrl: string;
    },
  ) {
    return this.call<PagBankOrder>('POST', '/orders', {
      token: sellerToken,
      idem: o.referenceId,
      body: {
        reference_id: o.referenceId,
        customer: customerOf(o.customer),
        items: [
          { reference_id: o.referenceId, name: o.description, quantity: 1, unit_amount: o.cents },
        ],
        qr_codes: [
          {
            amount: { value: o.cents },
            expiration_date: o.expiresAt.toISOString().replace(/\.\d{3}Z$/, '-00:00'),
            ...(o.receivers ? { splits: this.splits(o.receivers) } : {}),
          },
        ],
        notification_urls: [o.notifyUrl],
      },
    });
  }

  order(sellerToken: string, id: string) {
    return this.call<PagBankOrder>('GET', `/orders/${encodeURIComponent(id)}`, {
      token: sellerToken,
    });
  }

  /** Estorno (total ou parcial) de uma cobrança paga; o split é desfeito na mesma proporção. */
  cancelCharge(sellerToken: string, chargeId: string, cents: number, idem: string) {
    return this.call<PagBankCharge>('POST', `/charges/${encodeURIComponent(chargeId)}/cancel`, {
      token: sellerToken,
      idem,
      body: { amount: { value: cents } },
    });
  }
}

function customerOf(c: { name: string; email: string; taxId: string; phone: string }) {
  const digits = c.phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  return {
    name: c.name,
    email: c.email,
    tax_id: c.taxId,
    phones: [{ country: '55', area: digits.slice(0, 2), number: digits.slice(2), type: 'MOBILE' }],
  };
}

/** Situação da cobrança mais recente de um pedido do PagBank. */
export function lastCharge(o: PagBankOrder): PagBankCharge | undefined {
  const cs = o.charges ?? [];
  return cs[cs.length - 1];
}

/** Texto do Pix copia e cola do pedido do PagBank. */
export function pixOf(o: PagBankOrder): { text: string; expiresAt: string | null } | null {
  const q = (o.qr_codes ?? o.qr_code ?? [])[0];
  return q?.text ? { text: q.text, expiresAt: q.expiration_date ?? null } : null;
}
