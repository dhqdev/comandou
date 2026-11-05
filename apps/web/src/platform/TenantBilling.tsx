import { BLOCK_LABELS, INVOICE_KIND_LABELS, INVOICE_LABELS } from '@comandou/shared';
import { FormEvent, useState } from 'react';
import { Alert, Button, Spinner, TextField, useToast } from '../design-system';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { AdminInvoice, day, INVOICE_LEVEL } from './BillingPage';
import { useLoad } from './OverviewPages';
import { Dot, Tag } from './ui';

interface View {
  billing: { enabled: boolean; auto: boolean; environment?: string; blockAfterDays: number };
  subscription: {
    billingMode: 'manual' | 'asaas';
    accessUntil: string | null;
    daysLeft: number | null;
    blockOn: string | null;
    blockReason: 'payment' | 'contract' | null;
    blockedAt: string | null;
    priceMonthly: string;
    scheduledPlan?: { name: string; priceMonthly: string; startsAt: string | null } | null;
  } | null;
  payment?: {
    method: 'pix' | 'boleto' | 'card' | null;
    card: { brand: string; last4: string; holderName: string; savedBy?: string | null } | null;
  };
  invoices: AdminInvoice[];
  contract: {
    number: string | null;
    validUntil: string | null;
    daysLeft: number | null;
    phase: string;
    blockOn: string | null;
    renewal: { number: string; status: string; sentTo: string | null } | null;
  };
}

/**
 * Aba Assinatura do restaurante no painel: cobrança automática ou manual, até quando está
 * liberado, bloqueio, contrato anual e as faturas (gerar, conferir, baixar, cancelar).
 */
export function TenantBillingPanel({
  tenantId,
  onChanged,
}: {
  tenantId: string;
  onChanged?(): void;
}) {
  const toast = useToast();
  const data = useLoad<View | null>(`/platform/billing/tenants/${tenantId}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState({ description: '', amount: '', dueDate: '' });
  const v = data.data;
  if (data.error) return <Alert tone="danger">{data.error}</Alert>;
  if (v === null && !data.error) return <Spinner />;
  if (!v) return null;
  const s = v.subscription;

  async function act(
    key: string,
    path: string,
    ok: string,
    init: { method: string; json?: unknown } = { method: 'POST' },
  ) {
    setBusy(key);
    try {
      const n = await api<View>(path, init);
      data.setData(n);
      toast(ok, 'success');
      onChanged?.();
      return true;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return false;
    } finally {
      setBusy(null);
    }
  }
  async function createManual(e: FormEvent) {
    e.preventDefault();
    const amount = form.amount.replace(/\./g, '').replace(',', '.');
    if (
      await act('manual', `/platform/billing/tenants/${tenantId}/invoices`, 'Cobrança criada', {
        method: 'POST',
        json: { ...form, amount },
      })
    ) {
      setManual(false);
      setForm({ description: '', amount: '', dueDate: '' });
    }
  }

  return (
    <div className="adm-billing" style={{ marginTop: 20 }}>
      <h3 className="adm-section__title" style={{ marginBottom: 8 }}>
        Cobrança
      </h3>
      {!s ? (
        <p className="adm-sub">Sem assinatura: escolha o plano acima.</p>
      ) : (
        <>
          {s.blockReason && (
            <Alert tone="danger">
              Bloqueado desde {day(s.blockedAt)}: {BLOCK_LABELS[s.blockReason]}. O restaurante só
              consulta e paga. Libera sozinho quando o pagamento é confirmado
              {s.blockReason === 'contract' ? ' (aqui: quando o contrato novo é assinado)' : ''}.
            </Alert>
          )}
          <div className="adm-kv" style={{ display: 'grid', gap: 6 }}>
            <span>
              Modo:{' '}
              <Tag level={s.billingMode === 'asaas' ? 'ok' : 'off'}>
                {s.billingMode === 'asaas' ? 'automática (Asaas)' : 'manual'}
              </Tag>{' '}
              {s.billingMode === 'asaas' && !v.billing.enabled && (
                <span className="adm-sub">cobrança desligada em Cobrança</span>
              )}
            </span>
            <span>
              Liberado até: <strong>{day(s.accessUntil)}</strong>
              {s.daysLeft !== null && ` (${s.daysLeft} dia(s))`}
              {s.blockOn &&
                v.billing.auto &&
                !s.blockReason &&
                ` · bloqueia em ${day(s.blockOn)} sem pagamento`}
            </span>
            {s.billingMode === 'asaas' && (
              <span>
                Pagamento:{' '}
                {v.payment?.method === 'card' && v.payment.card ? (
                  <>
                    <Tag level="ok">cartão automático</Tag> {v.payment.card.brand} ••••{' '}
                    {v.payment.card.last4} ({v.payment.card.holderName}
                    {v.payment.card.savedBy ? `, cadastrado por ${v.payment.card.savedBy}` : ''})
                  </>
                ) : v.payment?.method === 'boleto' ? (
                  'boleto (o restaurante paga cada fatura)'
                ) : (
                  'Pix (o restaurante paga cada fatura; a fatura sai sozinha antes do fim)'
                )}
              </span>
            )}
            {s.scheduledPlan && (
              <span>
                Troca agendada pelo restaurante: <Tag level="warn">{s.scheduledPlan.name}</Tag> a
                partir de {day(s.scheduledPlan.startsAt)} ({brl(s.scheduledPlan.priceMonthly)} por
                mês). A mensalidade desse período já sai com o preço novo.
              </span>
            )}
            <span>
              Contrato:{' '}
              {v.contract.validUntil
                ? `${v.contract.number} até ${day(v.contract.validUntil)}`
                : 'nenhum assinado'}
              {v.contract.phase === 'renewal' && (
                <>
                  {' '}
                  · <Tag level="warn">renovar</Tag>
                </>
              )}
              {v.contract.phase === 'expired' && (
                <>
                  {' '}
                  · <Tag level="bad">vencido, bloqueia em {day(v.contract.blockOn)}</Tag>
                </>
              )}
              {v.contract.renewal && ` · novo ${v.contract.renewal.number} enviado`}
            </span>
          </div>
          <div className="adm-form-actions" style={{ flexWrap: 'wrap', margin: '12px 0' }}>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === 'mode'}
              onClick={() =>
                act(
                  'mode',
                  `/platform/billing/tenants/${tenantId}/mode`,
                  'Modo de cobrança salvo',
                  { method: 'PUT', json: { mode: s.billingMode === 'asaas' ? 'manual' : 'asaas' } },
                )
              }
            >
              {s.billingMode === 'asaas' ? 'Passar para manual' : 'Ligar cobrança automática'}
            </Button>
            {v.billing.auto && (
              <Button
                size="sm"
                variant="secondary"
                loading={busy === 'charge'}
                onClick={() =>
                  act(
                    'charge',
                    `/platform/billing/tenants/${tenantId}/charge`,
                    'Mensalidade gerada',
                  )
                }
              >
                Gerar mensalidade agora
              </Button>
            )}
            {v.billing.enabled && (
              <Button size="sm" variant="ghost" onClick={() => setManual((x) => !x)}>
                Cobrança avulsa
              </Button>
            )}
          </div>
          {manual && (
            <form className="form-grid" onSubmit={createManual} style={{ marginBottom: 12 }}>
              <TextField
                label="Descrição"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
              />
              <TextField
                label="Valor (R$)"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) =>
                  setForm({ ...form, amount: e.target.value.replace(/[^\d,.]/g, '') })
                }
                required
              />
              <TextField
                label="Vencimento"
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                required
              />
              <div style={{ alignSelf: 'end' }}>
                <Button type="submit" loading={busy === 'manual'}>
                  Criar cobrança
                </Button>
              </div>
            </form>
          )}
        </>
      )}
      <div className="adm-panel">
        <div className="adm-rows">
          {v.invoices.map((i) => (
            <div key={i.id} className="adm-row">
              <Dot level={INVOICE_LEVEL[i.status]} />
              <span className="adm-row__main">
                <span className="adm-row__title">
                  {INVOICE_KIND_LABELS[i.kind]} · {brl(i.amount)}
                </span>
                <span className="adm-row__meta">
                  {INVOICE_LABELS[i.status]} · vence {day(i.dueDate)}
                  {i.paidAt
                    ? ` · paga ${day(i.paidAt)}${i.billingType ? ` (${i.billingType})` : ''}`
                    : ''}
                  {!i.sent && i.status !== 'paid' && i.status !== 'cancelled'
                    ? ' · ainda não enviada ao Asaas'
                    : ''}
                  {i.lastError ? ` · erro: ${i.lastError}` : ''}
                </span>
              </span>
              <span
                className="adm-row__side"
                style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}
              >
                {i.invoiceUrl && (
                  <a
                    href={i.invoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="cm-btn cm-btn--ghost cm-btn--sm"
                  >
                    Abrir
                  </a>
                )}
                {(i.status === 'pending' || i.status === 'overdue') && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `s${i.id}`}
                      onClick={() =>
                        act(
                          `s${i.id}`,
                          `/platform/billing/invoices/${i.id}/sync`,
                          'Conferido no Asaas',
                        )
                      }
                    >
                      Conferir
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `p${i.id}`}
                      onClick={() =>
                        confirm(
                          'Marcar como paga (recebido fora do Asaas)? Isso libera o acesso.',
                        ) &&
                        act(`p${i.id}`, `/platform/billing/invoices/${i.id}/paid`, 'Fatura baixada')
                      }
                    >
                      Baixar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `c${i.id}`}
                      onClick={() =>
                        confirm('Cancelar esta fatura também no Asaas?') &&
                        act(
                          `c${i.id}`,
                          `/platform/billing/invoices/${i.id}/cancel`,
                          'Fatura cancelada',
                        )
                      }
                    >
                      Cancelar
                    </Button>
                  </>
                )}
              </span>
            </div>
          ))}
          {v.invoices.length === 0 && <div className="adm-empty">Nenhuma fatura.</div>}
        </div>
      </div>
    </div>
  );
}
