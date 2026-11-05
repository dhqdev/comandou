import { ExternalLink, Plus } from 'lucide-react';
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
import { baseDomain } from './TenantsPages';
import type { Plan } from './types';
import { PageHead } from './ui';

/** Página pública de preços: www.<domínio>/precos (a mesma página abre em qualquer restaurante). */
export const pricingUrl = () =>
  `${window.location.protocol}//www.${baseDomain()}${window.location.port ? `:${window.location.port}` : ''}/precos`;

const limitText = (v: number | null) => (v === null ? 'sem limite' : String(v));

export function PlansPage() {
  const { data, error, reload } = useLoad<Plan[]>('/platform/plans');
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  return (
    <>
      <PageHead
        page
        title="Planos"
        sub={
          <span>
            Preço, limites e recursos. Trocar o plano nunca apaga dados: os limites só impedem criar
            mais.
          </span>
        }
        actions={
          <>
            <a className="adm-action" href={pricingUrl()} target="_blank" rel="noreferrer">
              <ExternalLink size={15} /> Ver página de preços
            </a>
            <button className="adm-action adm-action--primary" onClick={() => setEditing('new')}>
              <Plus size={15} /> Novo plano
            </button>
          </>
        }
      />
      <Alert tone="info">
        <strong>O que você mudar aqui aparece na hora em dois lugares:</strong> na página pública de
        preços (<code>/precos</code>, com os cartões e a tabela de comparação) e na tela{' '}
        <strong>Assinatura</strong> de cada restaurante, onde o cliente sobe ou desce de plano.
        Planos inativos ou com “Mostrar na página de preços” desmarcado não aparecem para quem ainda
        não assina. Mudar o preço vale para a <strong>próxima mensalidade</strong> de quem já está
        no plano; as faturas já geradas não mudam.
      </Alert>
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
                      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                        {p.isDefault && <Badge tone="brand">padrão</Badge>}
                        {p.featured && <Badge tone="success">mais escolhido</Badge>}
                        {p.active && !p.showPublic && <Badge>fora da página de preços</Badge>}
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
    tagline: plan?.tagline ?? '',
    highlights: (plan?.highlights ?? []).join('\n'),
    featured: plan?.featured ?? false,
    showPublic: plan?.showPublic ?? true,
    sortOrder: String(plan?.sortOrder ?? 0),
  });
  const highlights = f.highlights
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
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
      tagline: f.tagline.trim(),
      highlights,
      featured: f.featured,
      showPublic: f.showPublic,
      sortOrder: Number(f.sortOrder || 0),
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
    <Modal
      open
      title={plan ? `Plano ${plan.name}` : 'Novo plano'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="plano-form"
            loading={busy}
            disabled={!f.name || !priceOk || (!plan && !f.code) || highlights.length > 8}
          >
            Salvar
          </Button>
        </>
      }
    >
      <form id="plano-form" onSubmit={submit}>
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
        <p className="adm-sub" style={{ whiteSpace: 'normal', margin: '8px 0 0' }}>
          Limites: o restaurante não consegue <strong>criar</strong> além disso (nada é apagado).
          Vazio = sem limite. Teste grátis: dias liberados sem pagar para quem começa neste plano.
        </p>
        <h4 style={{ margin: '20px 0 8px' }}>Recursos e situação</h4>
        <div style={{ display: 'grid', gap: 8 }}>
          {check('featureFiscal', 'Inclui nota fiscal (NFC-e)')}
          {check('featureWhatsapp', 'Inclui mensagens no WhatsApp')}
          {check('featureCustomDomain', 'Inclui domínio próprio')}
          {check('isDefault', 'Plano padrão dos novos restaurantes')}
          {check('active', 'Ativo (aceita novas assinaturas)')}
        </div>
        <h4 style={{ margin: '20px 0 4px' }}>Página de preços e tela Assinatura</h4>
        <p className="adm-sub" style={{ whiteSpace: 'normal', margin: '0 0 12px' }}>
          Como este plano aparece para o cliente em <code>/precos</code> e na tela Assinatura. A
          tabela de comparação usa o preço, o teste, os limites e os recursos acima sozinha.
        </p>
        <div className="form-grid">
          <TextField
            label="Frase curta"
            value={f.tagline}
            maxLength={160}
            onChange={(e) => set('tagline')(e.target.value)}
            hint="Ex.: Para quem está começando. Aparece embaixo do preço."
          />
          <TextField
            label="Ordem na página"
            inputMode="numeric"
            value={f.sortOrder}
            onChange={(e) => set('sortOrder')(e.target.value.replace(/\D/g, '').slice(0, 3))}
            hint="Menor aparece primeiro; empate ordena pelo preço"
          />
        </div>
        <label className="cm-field" style={{ display: 'grid', gap: 4, marginTop: 12 }}>
          <span className="cm-label">Destaques do cartão (um por linha, até 8)</span>
          <textarea
            className="cm-input"
            rows={4}
            value={f.highlights}
            onChange={(e) => set('highlights')(e.target.value)}
            placeholder={'Até 5 pessoas na equipe\nCardápio online\nNota fiscal (NFC-e)'}
          />
          <span className={highlights.length > 8 ? 'cm-error-text' : 'cm-hint'}>
            {highlights.length > 8
              ? `São ${highlights.length} linhas: deixe no máximo 8`
              : 'Vazio = o sistema monta sozinho com os limites e recursos acima.'}
          </span>
        </label>
        <div style={{ display: 'grid', gap: 8, margin: '12px 0 16px' }}>
          {check('showPublic', 'Mostrar na página de preços (/precos)')}
          {check('featured', 'Destacar como “Mais escolhido”')}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Modal>
  );
}
