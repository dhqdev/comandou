import { Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useLoad } from './OverviewPages';
import type { Plan } from './types';

const limitText = (v: number | null) => (v === null ? 'sem limite' : String(v));

export function PlansPage() {
  const { data, error, reload } = useLoad<Plan[]>('/platform/plans');
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Planos</h1>
          <p className="page-sub">
            Preço, limites e recursos. Trocar o plano de um restaurante nunca apaga dados: os
            limites só impedem criar mais.
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => setEditing('new')}>
          Novo plano
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Card bodyless>
        {!data ? (
          <div className="cm-card__body">
            <Spinner />
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            title="Nenhum plano"
            description="Sem planos, os restaurantes não têm limites. Crie o primeiro para começar a cobrar."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table cm-table--click">
              <thead>
                <tr>
                  <th>Plano</th>
                  <th className="cm-num">Mensal</th>
                  <th>Limites (equipe · produtos · pedidos/mês)</th>
                  <th>Recursos</th>
                  <th className="cm-num">Assinantes</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id} onClick={() => setEditing(p)}>
                    <td>
                      <strong>{p.name}</strong> <span className="cm-hint">{p.code}</span>
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        {p.isDefault && <Badge tone="brand">padrão</Badge>}
                        {!p.active && <Badge>inativo</Badge>}
                        {p.trialDays > 0 && <Badge tone="info">{p.trialDays} dias de teste</Badge>}
                      </div>
                    </td>
                    <td className="cm-num">{brl(p.priceMonthly)}</td>
                    <td>
                      {limitText(p.maxUsers)} · {limitText(p.maxProducts)} ·{' '}
                      {limitText(p.maxOrdersMonth)}
                    </td>
                    <td>
                      {[
                        p.featureFiscal && 'NFC-e',
                        p.featureWhatsapp && 'WhatsApp',
                        p.featureCustomDomain && 'Domínio próprio',
                      ]
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </td>
                    <td className="cm-num">{p.subscribers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <PlanModal
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function PlanModal({
  plan,
  onClose,
  onSaved,
}: {
  plan: Plan | null;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    code: plan?.code ?? '',
    name: plan?.name ?? '',
    price: plan ? plan.priceMonthly.replace('.', ',') : '',
    maxUsers: plan?.maxUsers?.toString() ?? '',
    maxProducts: plan?.maxProducts?.toString() ?? '',
    maxOrdersMonth: plan?.maxOrdersMonth?.toString() ?? '',
    trialDays: String(plan?.trialDays ?? 0),
    featureFiscal: plan?.featureFiscal ?? false,
    featureWhatsapp: plan?.featureWhatsapp ?? false,
    featureCustomDomain: plan?.featureCustomDomain ?? false,
    isDefault: plan?.isDefault ?? false,
    active: plan?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  // "1.234,56" (padrão brasileiro) ou "99.90".
  const raw = f.price.trim();
  const price = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const priceOk = /^\d+(\.\d{1,2})?$/.test(price);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: f.name,
      priceMonthly: price.includes('.') ? price : `${price}.00`,
      maxUsers: num(f.maxUsers),
      maxProducts: num(f.maxProducts),
      maxOrdersMonth: num(f.maxOrdersMonth),
      trialDays: Number(f.trialDays || 0),
      featureFiscal: f.featureFiscal,
      featureWhatsapp: f.featureWhatsapp,
      featureCustomDomain: f.featureCustomDomain,
      isDefault: f.isDefault,
      active: f.active,
    };
    try {
      if (plan) await api(`/platform/plans/${plan.id}`, { method: 'PUT', json: body });
      else await api('/platform/plans', { method: 'POST', json: { ...body, code: f.code } });
      toast(plan ? 'Plano atualizado' : 'Plano criado', 'success');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const check = (k: keyof typeof f, label: string) => (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="checkbox" checked={f[k] as boolean} onChange={(e) => set(k)(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <Modal open title={plan ? `Plano ${plan.name}` : 'Novo plano'} onClose={onClose} size="lg">
      <form onSubmit={submit}>
        <div className="form-grid">
          <TextField
            label="Código"
            value={f.code}
            disabled={!!plan}
            onChange={(e) => set('code')(e.target.value.toLowerCase())}
            hint={plan ? 'Não muda depois de criado' : 'Ex.: basico, pro'}
          />
          <TextField label="Nome" value={f.name} onChange={(e) => set('name')(e.target.value)} />
          <TextField
            label="Preço mensal (R$)"
            inputMode="decimal"
            value={f.price}
            onChange={(e) => set('price')(e.target.value)}
            error={f.price && !priceOk ? 'Ex.: 99,90' : undefined}
          />
          <TextField
            label="Dias de teste"
            inputMode="numeric"
            value={f.trialDays}
            onChange={(e) => set('trialDays')(e.target.value.replace(/\D/g, ''))}
          />
          <TextField
            label="Máx. pessoas na equipe"
            inputMode="numeric"
            value={f.maxUsers}
            onChange={(e) => set('maxUsers')(e.target.value.replace(/\D/g, ''))}
            hint="Vazio = sem limite"
          />
          <TextField
            label="Máx. produtos ativos"
            inputMode="numeric"
            value={f.maxProducts}
            onChange={(e) => set('maxProducts')(e.target.value.replace(/\D/g, ''))}
            hint="Vazio = sem limite"
          />
          <TextField
            label="Máx. pedidos por mês"
            inputMode="numeric"
            value={f.maxOrdersMonth}
            onChange={(e) => set('maxOrdersMonth')(e.target.value.replace(/\D/g, ''))}
            hint="Vazio = sem limite"
          />
        </div>
        <div style={{ display: 'grid', gap: 8, margin: '16px 0' }}>
          {check('featureFiscal', 'Inclui nota fiscal (NFC-e)')}
          {check('featureWhatsapp', 'Inclui mensagens no WhatsApp')}
          {check('featureCustomDomain', 'Inclui domínio próprio')}
          {check('isDefault', 'Plano padrão dos novos restaurantes')}
          {check('active', 'Ativo (aceita novas assinaturas)')}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="cm-modal__footer" style={{ padding: 0 }}>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={!f.name || !priceOk || (!plan && !f.code)}>
            Salvar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
