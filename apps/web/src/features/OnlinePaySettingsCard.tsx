import { ONLINE_CHARGE_LABELS, type OnlineChargeStatus } from '@comandou/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../app/auth';
import { Alert, Badge, Button, Card, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { useLinkParam } from '../lib/deep-link';
import { brl } from '../lib/money';
import type { CashRegister } from '../lib/types';
import { CheckField, SelectField } from './forms';

interface OnlinePayView {
  available: boolean;
  environment: 'sandbox' | 'production';
  connected: boolean;
  needsAccountId: boolean;
  otherEnvironment: boolean;
  sellerAccountId: string | null;
  cardEnabled: boolean;
  pixEnabled: boolean;
  cashRegisterId: string | null;
  connectedAt: string | null;
  lastError: string | null;
  fee: { percent: string; fixed: string } | null;
  month: { paid: string; fees: string; n: number };
  charges: {
    id: string;
    method: 'card' | 'pix';
    status: OnlineChargeStatus;
    amount: string;
    feeAmount: string;
    refundedAmount: string;
    cardBrand: string | null;
    cardLast4: string | null;
    declineReason: string | null;
    inCash: boolean;
    createdAt: string;
    orderNumber: number;
  }[];
}

const TONE: Record<OnlineChargeStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  paid: 'success',
  pending: 'warning',
  declined: 'danger',
  expired: 'neutral',
  refund_due: 'warning',
  refunded: 'neutral',
};

const feeText = (f: { percent: string; fixed: string }) =>
  `${Number(f.percent).toLocaleString('pt-BR')}%${Number(f.fixed) > 0 ? ` + ${brl(f.fixed)}` : ''} por pagamento`;

/**
 * Pagamento pelo app (PagBank): o dono conecta a conta PagBank do restaurante; o cliente paga
 * cartão de crédito ou Pix no cardápio e o dinheiro cai direto na conta do restaurante. A taxa da
 * Comandou é separada na hora pelo PagBank.
 */
export function OnlinePaySettingsCard({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const { me } = useAuth();
  const owner = me?.user.role === 'owner';
  const [v, setV] = useState<OnlinePayView | null>(null);
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState('');

  useEffect(() => {
    api<OnlinePayView>('/online-pay')
      .then(setV)
      .catch((e) => setError((e as Error).message));
    api<CashRegister[]>('/cash-registers').then(setRegisters, () => undefined);
  }, []);

  // Volta do PagBank: ?pagbank=ok|conta|erro|cancelado (&motivo=...).
  useLinkParam('pagbank', (r) => {
    const reason = new URLSearchParams(window.location.search).get('motivo');
    if (r === 'ok') toast('Conta PagBank conectada', 'success');
    else if (r === 'conta') toast('Conectada. Falta informar o id da conta PagBank.', 'danger');
    else if (r === 'cancelado') toast('Conexão com o PagBank cancelada');
    else toast(reason ?? 'Não deu para conectar ao PagBank', 'danger');
  });

  async function run<T>(fn: () => Promise<T>, ok?: string) {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast(ok, 'success');
      return r;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    const r = await run(() => api<{ url: string }>('/online-pay/connect', { method: 'POST' }));
    if (r) window.location.assign(r.url);
  }

  const patch = (json: object, ok = 'Salvo') =>
    run(async () => setV(await api<OnlinePayView>('/online-pay', { method: 'PATCH', json })), ok);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!v) return null;

  return (
    <Card
      searchId="secao-pagamentos"
      title={
        <span className="pix-set__title">
          Pagamento pelo app{' '}
          <Badge tone={v.connected ? 'success' : 'neutral'}>
            {v.connected ? 'conectado' : 'desconectado'}
          </Badge>
          {v.environment === 'sandbox' && v.available && <Badge tone="warning">teste</Badge>}
        </span>
      }
    >
      <div className="cm-form">
        <p className="cm-hint cm-form__wide">
          O cliente paga com cartão de crédito ou Pix direto no cardápio, e o dinheiro cai na conta
          PagBank do restaurante. O pedido só vai para a cozinha depois de pago e o pagamento entra
          no caixa sozinho. Sem a conta conectada, o cardápio continua como antes (Pix com
          comprovante e pagamento na entrega).
        </p>

        {!v.available ? (
          <Alert tone="info">O pagamento pelo app ainda não está liberado para esta loja.</Alert>
        ) : !v.connected ? (
          <div className="cm-form__block">
            {v.otherEnvironment && (
              <Alert tone="warning">
                A conexão anterior era de outro ambiente. Conecte de novo.
              </Alert>
            )}
            {v.needsAccountId ? (
              <>
                <Alert tone="warning">
                  O PagBank não informou o id da conta. Copie no app do PagBank (começa com ACCO_) e
                  cole aqui.
                </Alert>
                <TextField
                  label="Id da conta PagBank"
                  value={account}
                  placeholder="ACCO_..."
                  disabled={!owner}
                  onChange={(e) => setAccount(e.target.value.trim())}
                />
                <Button
                  variant="primary"
                  disabled={!owner || busy || !/^ACCO_/.test(account)}
                  onClick={() => void patch({ sellerAccountId: account }, 'Conta PagBank salva')}
                >
                  Salvar id da conta
                </Button>
              </>
            ) : (
              <Button variant="primary" disabled={!owner || busy} onClick={() => void connect()}>
                Conectar conta PagBank
              </Button>
            )}
            {!owner && (
              <p className="cm-hint">Só o administrador do restaurante conecta a conta.</p>
            )}
          </div>
        ) : (
          <>
            <CheckField
              label="Cartão de crédito pelo app"
              description="O cliente digita o cartão no cardápio. À vista."
              checked={v.cardEnabled}
              disabled={!canManage || busy}
              onChange={(c) => void patch({ cardEnabled: c })}
            />
            <CheckField
              label="Pix pelo app"
              description="QR Code com o valor, confirmado sozinho. Toma o lugar do Pix com comprovante na entrega e na retirada."
              checked={v.pixEnabled}
              disabled={!canManage || busy}
              onChange={(c) => void patch({ pixEnabled: c })}
            />
            <SelectField
              label="Caixa que recebe os pagamentos do app"
              value={v.cashRegisterId ?? ''}
              disabled={!canManage || busy}
              onChange={(e) => void patch({ cashRegisterId: e.target.value || null })}
            >
              <option value="">O caixa aberto há mais tempo</option>
              {registers
                .filter((r) => r.active)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </SelectField>
            <div className="cm-form__block">
              <p className="cm-hint">
                Conta {v.sellerAccountId}
                {v.fee ? ` · taxa da Comandou: ${feeText(v.fee)}` : ''}
                {' · '}este mês: {v.month.n} pagamento{v.month.n === 1 ? '' : 's'},{' '}
                {brl(v.month.paid)}
              </p>
              {v.lastError && <Alert tone="warning">{v.lastError}</Alert>}
              {owner && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      async () =>
                        setV(
                          await api<OnlinePayView>('/online-pay/disconnect', { method: 'POST' }),
                        ),
                      'Conta PagBank desconectada',
                    )
                  }
                >
                  Desconectar
                </Button>
              )}
            </div>
          </>
        )}

        {v.charges.length > 0 && (
          <div className="cm-form__wide">
            <h3 className="cm-form__section">Últimos pagamentos pelo app</h3>
            <ul className="opay-list">
              {v.charges.map((c) => (
                <li key={c.id} className="opay-list__row">
                  <span>
                    Pedido #{c.orderNumber} · {c.method === 'card' ? 'Cartão' : 'Pix'}
                    {c.cardLast4 ? ` final ${c.cardLast4}` : ''}
                  </span>
                  <span className="opay-list__amount">{brl(c.amount)}</span>
                  <Badge tone={TONE[c.status]}>
                    {c.status === 'paid' && !c.inCash
                      ? 'Pago, falta lançar no caixa'
                      : ONLINE_CHARGE_LABELS[c.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
