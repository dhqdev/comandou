/**
 * Cliente mínimo da API v3 do Asaas (https://docs.asaas.com). Só o que a cobrança da assinatura
 * usa: cliente, cobrança (boleto, Pix ou cartão na página do Asaas), QR Code do Pix, linha
 * digitável, cancelamento e webhook. A chave vai no cabeçalho access_token e nunca em log.
 */
export type AsaasEnvironment = 'sandbox' | 'production';

export const ASAAS_URLS: Record<AsaasEnvironment, string> = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
};

export interface AsaasPayment {
  id: string;
  customer: string;
  status: string;
  value: number;
  netValue?: number;
  billingType?: string;
  dueDate: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  externalReference?: string | null;
  deleted?: boolean;
}

export class AsaasError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Situação do Asaas → situação da fatura no Comandou. */
export function invoiceStatusOf(p: Pick<AsaasPayment, 'status' | 'deleted'>) {
  if (p.deleted) return 'cancelled' as const;
  switch (p.status) {
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH':
      return 'paid' as const;
    case 'OVERDUE':
      return 'overdue' as const;
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
      return 'refunded' as const;
    default:
      return 'pending' as const;
  }
}

export class AsaasClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs = 15_000,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          access_token: this.apiKey,
          'Content-Type': 'application/json',
          'User-Agent': 'Comandou',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new AsaasError(`Asaas fora do ar ou sem resposta: ${(e as Error).message}`, 0);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const errs = (json as { errors?: { description?: string }[] } | null)?.errors;
      const msg = errs
        ?.map((e) => e.description)
        .filter(Boolean)
        .join('; ');
      throw new AsaasError(
        res.status === 401
          ? 'Chave do Asaas recusada (confira a chave e o ambiente)'
          : `Asaas: ${msg || `erro ${res.status}`}`.slice(0, 280),
        res.status,
      );
    }
    return json as T;
  }

  account() {
    return this.call<{ name?: string; email?: string; cpfCnpj?: string }>('GET', '/myAccount');
  }

  balance() {
    return this.call<{ balance: number }>('GET', '/finance/balance');
  }

  createCustomer(c: {
    name: string;
    cpfCnpj: string;
    email?: string | null;
    mobilePhone?: string | null;
    externalReference: string;
  }) {
    return this.call<{ id: string }>('POST', '/customers', {
      ...c,
      email: c.email || undefined,
      mobilePhone: c.mobilePhone || undefined,
      notificationDisabled: false,
    });
  }

  createPayment(p: {
    customer: string;
    value: number;
    dueDate: string;
    description: string;
    externalReference: string;
    fine?: number;
    interest?: number;
  }) {
    return this.call<AsaasPayment>('POST', '/payments', {
      customer: p.customer,
      // UNDEFINED: o cliente escolhe boleto, Pix ou cartão na hora de pagar.
      billingType: 'UNDEFINED',
      value: p.value,
      dueDate: p.dueDate,
      description: p.description,
      externalReference: p.externalReference,
      fine: p.fine ? { value: p.fine } : undefined,
      interest: p.interest ? { value: p.interest } : undefined,
    });
  }

  payment(id: string) {
    return this.call<AsaasPayment>('GET', `/payments/${encodeURIComponent(id)}`);
  }

  /** Cobrança já criada para esta fatura (envio anterior que caiu antes de gravar a resposta). */
  async paymentByReference(externalReference: string): Promise<AsaasPayment | null> {
    const r = await this.call<{ data?: AsaasPayment[] }>(
      'GET',
      `/payments?externalReference=${encodeURIComponent(externalReference)}&limit=10`,
    );
    return r?.data?.find((p) => !p.deleted && p.externalReference === externalReference) ?? null;
  }

  /** Baixa no Asaas de um pagamento recebido por fora (o cliente para de receber a cobrança). */
  receiveInCash(id: string, r: { paymentDate: string; value: number }) {
    return this.call<AsaasPayment>('POST', `/payments/${encodeURIComponent(id)}/receiveInCash`, {
      paymentDate: r.paymentDate,
      value: r.value,
      notifyCustomer: false,
    });
  }

  /** Desfaz no Asaas a baixa por fora (a cobrança volta a "a pagar"). */
  undoReceivedInCash(id: string) {
    return this.call<AsaasPayment>(
      'POST',
      `/payments/${encodeURIComponent(id)}/undoReceivedInCash`,
    );
  }

  pixQrCode(id: string) {
    return this.call<{ encodedImage: string; payload: string; expirationDate?: string }>(
      'GET',
      `/payments/${encodeURIComponent(id)}/pixQrCode`,
    );
  }

  boletoLine(id: string) {
    return this.call<{ identificationField: string; barCode?: string }>(
      'GET',
      `/payments/${encodeURIComponent(id)}/identificationField`,
    );
  }

  /**
   * Guarda o cartão no Asaas e devolve o token (tokenização precisa estar liberada na conta).
   * Os dados do cartão só passam por aqui a caminho do Asaas: nunca são gravados nem logados.
   */
  tokenizeCard(t: {
    customer: string;
    remoteIp: string;
    card: {
      holderName: string;
      number: string;
      expiryMonth: string;
      expiryYear: string;
      ccv: string;
    };
    holder: {
      name: string;
      email: string;
      cpfCnpj: string;
      postalCode: string;
      addressNumber: string;
      phone: string;
    };
  }) {
    return this.call<{
      creditCardNumber: string;
      creditCardBrand: string;
      creditCardToken: string;
    }>('POST', '/creditCard/tokenize', {
      customer: t.customer,
      creditCard: t.card,
      creditCardHolderInfo: { ...t.holder, mobilePhone: t.holder.phone },
      remoteIp: t.remoteIp,
    });
  }

  /** Paga uma cobrança já criada com o cartão salvo (token). Recusa do banco volta como erro. */
  payWithCardToken(id: string, token: string, remoteIp: string) {
    return this.call<AsaasPayment>(
      'POST',
      `/payments/${encodeURIComponent(id)}/payWithCreditCard`,
      { creditCardToken: token, remoteIp },
    );
  }

  cancelPayment(id: string) {
    return this.call<{ deleted: boolean }>('DELETE', `/payments/${encodeURIComponent(id)}`);
  }

  createWebhook(w: { url: string; email: string; authToken: string }) {
    return this.call<{ id: string }>('POST', '/webhooks', {
      name: 'Comandou',
      url: w.url,
      email: w.email,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: w.authToken,
      sendType: 'SEQUENTIALLY',
      events: [
        'PAYMENT_CREATED',
        'PAYMENT_UPDATED',
        'PAYMENT_CONFIRMED',
        'PAYMENT_RECEIVED',
        'PAYMENT_OVERDUE',
        'PAYMENT_DELETED',
        'PAYMENT_RESTORED',
        'PAYMENT_REFUNDED',
        'PAYMENT_RECEIVED_IN_CASH_UNDONE',
        'PAYMENT_CHARGEBACK_REQUESTED',
      ],
    });
  }
}
