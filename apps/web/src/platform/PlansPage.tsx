import { SINGLE_PLAN_CODE } from '@comandou/shared';
import { Check, ExternalLink, Minus, Pencil } from 'lucide-react';
import { FormEvent, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  TextField,
  useToast,
  Skeleton,
} from '../design-system';
import { CheckField } from '../features/forms';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import { useLoad } from './OverviewPages';
import { baseDomain } from './TenantsPages';
import type { Plan } from './types';
import { PageHead, Tile } from './ui';

/**
 * Serviços que o plano liga ou desliga (pedido do David, 0.267.0). Cada um é conferido pela API
 * na hora de usar (`PlanService.assertFeature`/`hasFeature`): desligado aqui, nenhum restaurante
 * do valor único consegue usar, a partir de agora. `words` acha o serviço nos destaques.
 */
export const PLAN_SERVICES = [
  {
    key: 'featureFiscal',
    label: 'Nota fiscal (NFC-e e NF-e)',
    off: 'ninguém do valor único emite nota fiscal',
    words: /nota fiscal|nfc-?e|nf-?e/i,
  },
  {
    key: 'featureWhatsapp',
    label: 'WhatsApp (mensagens e atendimento com IA)',
    off: 'nenhuma mensagem sai pelo WhatsApp dos restaurantes',
    words: /whats/i,
  },
  {
    key: 'featureCustomDomain',
    label: 'Domínio próprio',
    off: 'ninguém liga um domínio próprio',
    words: /dom[ií]nio/i,
  },
] as const;
type ServiceKey = (typeof PLAN_SERVICES)[number]['key'];

/** O que está sempre no plano: a base do sistema, sem caixinha. */
export const CORE_SERVICES = [
  'PDV, salão, cozinha, caixa e entregas',
  'Cardápio online e loja virtual próprios',
  'Estoque, fichas técnicas e financeiro',
  'Reservas, clientes e fidelidade',
];

/** Página pública de preços: www.<domínio>/precos (a mesma página abre em qualquer restaurante). */
export const pricingUrl = () =>
  `${window.location.protocol}//www.${baseDomain()}${window.location.port ? `:${window.location.port}` : ''}/precos`;

/**
 * Super Admin → Preço. O Comandou tem um valor único (plano "comandou"): o mesmo preço para
 * qualquer restaurante, com tudo incluso e sem limites. Os planos antigos ficam só como histórico
 * e quem ainda está neles passa para o valor único na próxima mensalidade.
 */
export function PlansPage() {
  const { data, error, reload } = useLoad<Plan[]>('/platform/plans');
  const [editing, setEditing] = useState(false);
  const single = data?.find((p) => p.code === SINGLE_PLAN_CODE) ?? null;
  const legacy = (data ?? []).filter(
    (p) => p.code !== SINGLE_PLAN_CODE && (p.subscribers > 0 || p.active),
  );
  const moving = single?.scheduledIn ?? 0;
  return (
    <>
      <PageHead
        page
        title="Preço"
        sub={
          <span>
            Valor único: o mesmo preço e os mesmos serviços para qualquer restaurante, sem cobrança
            por pessoa, produto ou pedido.
          </span>
        }
        actions={
          <>
            <a className="adm-action" href={pricingUrl()} target="_blank" rel="noreferrer">
              <ExternalLink size={15} /> Ver página de preços
            </a>
            {single && (
              <button className="adm-action adm-action--primary" onClick={() => setEditing(true)}>
                <Pencil size={15} /> Mudar valor e serviços
              </button>
            )}
          </>
        }
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {!data ? (
        <Skeleton variant="cards" />
      ) : !single ? (
        <Card>
          <EmptyState
            title="Valor único ainda não criado"
            description="Ele é criado sozinho quando o banco é atualizado. Atualize o sistema e abra esta tela de novo."
          />
        </Card>
      ) : (
        <>
          <div className="adm-grid">
            <Tile
              label="Mensalidade"
              value={brl(single.priceMonthly)}
              sub="por mês, para qualquer restaurante"
            />
            <Tile
              label="Teste grátis"
              value={single.trialDays > 0 ? `${single.trialDays} dias` : 'Sem teste'}
              sub="para todo restaurante novo"
            />
            <Tile
              label="No valor único"
              value={single.subscribers}
              sub={single.subscribers === 1 ? 'restaurante' : 'restaurantes'}
            />
            <Tile
              label="Mudando na próxima mensalidade"
              value={moving}
              sub={moving === 1 ? 'restaurante em plano antigo' : 'restaurantes em plano antigo'}
              level={moving > 0 ? 'info' : 'off'}
            />
          </div>
          <Alert tone="info">
            <strong>Este valor aparece na hora</strong> no site do Comandou, na página de preços (
            <code>/precos</code>) e na tela <strong>Assinatura</strong> de cada restaurante. Quem
            está em teste paga este valor quando o teste vencer. Mudar o valor vale para a{' '}
            <strong>próxima mensalidade</strong> de todo mundo; as faturas já geradas não mudam.
          </Alert>
          <Card title="Serviços do plano">
            <p className="adm-sub" style={{ whiteSpace: 'normal', margin: '0 0 10px' }}>
              Valem para todos os restaurantes do valor único. Troque em Mudar valor e teste.
            </p>
            <ul className="adm-plan-services">
              {CORE_SERVICES.map((x) => (
                <li key={x} data-on>
                  <Check size={14} aria-hidden /> {x}
                  <small>sempre</small>
                </li>
              ))}
              {PLAN_SERVICES.map((x) => (
                <li key={x.key} data-on={single[x.key] || undefined}>
                  {single[x.key] ? (
                    <Check size={14} aria-hidden />
                  ) : (
                    <Minus size={14} aria-hidden />
                  )}{' '}
                  {x.label}
                  <small>{single[x.key] ? 'incluso' : 'fora do plano'}</small>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="O que aparece na página de preços">
            <p className="adm-sub" style={{ whiteSpace: 'normal', margin: '0 0 8px' }}>
              {single.tagline || 'Tudo do sistema por um valor fixo.'}
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              {/* Igual à página de preços: a primeira linha é fixa e não se repete. */}
              {[...new Set(['Sem limite de equipe, produtos e pedidos', ...single.highlights])].map(
                (h) => (
                  <li key={h}>{h}</li>
                ),
              )}
            </ul>
          </Card>
          {legacy.length > 0 && (
            <Card title="Planos antigos" bodyless>
              <p className="adm-sub" style={{ whiteSpace: 'normal', margin: '12px 16px' }}>
                Não aparecem mais para ninguém. Quem ainda está num deles continua com o período já
                pago e passa para o valor único na próxima mensalidade.
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table className="cm-table">
                  <thead>
                    <tr>
                      <th>Plano</th>
                      <th className="cm-num">Preço antigo</th>
                      <th className="cm-num">Restaurantes ainda nele</th>
                    </tr>
                  </thead>
                  <tbody>
                    {legacy.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong> <span className="cm-hint">{p.code}</span>{' '}
                          {p.active && <Badge tone="warning">ainda ativo</Badge>}
                        </td>
                        <td className="cm-num">{brl(p.priceMonthly)}</td>
                        <td className="cm-num">{p.subscribers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
      {editing && single && (
        <PlanModal
          plan={single}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function PlanModal({ plan, onClose, onSaved }: { plan: Plan; onClose(): void; onSaved(): void }) {
  const toast = useToast();
  const [f, setF] = useState({
    price: plan.priceMonthly.replace('.', ','),
    trialDays: String(plan.trialDays ?? 0),
    tagline: plan.tagline ?? '',
    highlights: (plan.highlights ?? []).join('\n'),
  });
  const [services, setServices] = useState<Record<ServiceKey, boolean>>({
    featureFiscal: plan.featureFiscal,
    featureWhatsapp: plan.featureWhatsapp,
    featureCustomDomain: plan.featureCustomDomain,
  });
  const off = PLAN_SERVICES.filter((x) => !services[x.key]);
  const turningOff = off.filter((x) => plan[x.key]);
  const highlights = f.highlights
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // Destaque que ainda fala de um serviço que saiu do plano (a página de preços mentiria).
  const stale = highlights.filter((h) => off.some((x) => x.words.test(h)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  // "1.234,56" (padrão brasileiro) ou "99.90".
  const raw = f.price.trim();
  const price = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const priceOk = /^\d+(\.\d{1,2})?$/.test(price) && Number(price) > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Valor único: sempre sem limites, ativo, padrão e na página de preços; os serviços saem das
    // caixinhas.
    const body = {
      name: plan.name,
      priceMonthly: price.includes('.') ? price : `${price}.00`,
      maxUsers: null,
      maxProducts: null,
      maxOrdersMonth: null,
      trialDays: Number(f.trialDays || 0),
      featureFiscal: services.featureFiscal,
      featureWhatsapp: services.featureWhatsapp,
      featureCustomDomain: services.featureCustomDomain,
      isDefault: true,
      active: true,
      tagline: f.tagline.trim(),
      highlights,
      featured: true,
      showPublic: true,
      sortOrder: plan.sortOrder,
    };
    try {
      await api(`/platform/plans/${plan.id}`, { method: 'PUT', json: body });
      toast('Valor atualizado', 'success');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Valor único"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="preco-form"
            loading={busy}
            disabled={!priceOk || highlights.length > 8 || Number(f.trialDays || 0) > 90}
          >
            Salvar
          </Button>
        </>
      }
    >
      <form id="preco-form" onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <TextField
          label="Mensalidade (R$)"
          inputMode="decimal"
          value={f.price}
          onChange={(e) => set('price')(e.target.value)}
          error={f.price && !priceOk ? 'Ex.: 400,00' : undefined}
          hint="Vale para a próxima mensalidade de todos os restaurantes"
        />
        <TextField
          label="Dias de teste"
          inputMode="numeric"
          value={f.trialDays}
          onChange={(e) => set('trialDays')(e.target.value.replace(/\D/g, '').slice(0, 2))}
          hint="Teste grátis de todo restaurante novo, inclusive quem se cadastra pelo site (comandou.com). 0 fecha o cadastro pelo site."
        />
        <TextField
          label="Frase curta"
          value={f.tagline}
          maxLength={160}
          onChange={(e) => set('tagline')(e.target.value)}
          hint="Aparece embaixo do preço"
        />
        <fieldset className="adm-plan-pick">
          <legend>Serviços do plano</legend>
          <p className="cm-hint">
            Valem para todos os restaurantes do valor único, inclusive quem já assina: desligado,
            ninguém consegue usar o serviço a partir de agora.
          </p>
          <ul className="adm-plan-core" aria-label="Sempre no plano">
            {CORE_SERVICES.map((x) => (
              <li key={x}>
                <Check size={14} aria-hidden /> {x}
              </li>
            ))}
          </ul>
          {PLAN_SERVICES.map((x) => (
            <CheckField
              key={x.key}
              label={x.label}
              checked={services[x.key]}
              onChange={(v) => setServices((cur) => ({ ...cur, [x.key]: v }))}
              description={services[x.key] ? undefined : `Fora do plano: ${x.off}.`}
            />
          ))}
          {turningOff.length > 0 && (
            <Alert tone="warning">Ao salvar, {turningOff.map((x) => x.off).join('; ')}.</Alert>
          )}
        </fieldset>
        <label className="cm-field" style={{ display: 'grid', gap: 4 }}>
          <span className="cm-label">Destaques (um por linha, até 8)</span>
          <textarea
            className="cm-input"
            rows={4}
            value={f.highlights}
            onChange={(e) => set('highlights')(e.target.value)}
            placeholder={'PDV, salão, cozinha, caixa e entregas\nNota fiscal (NFC-e e NF-e)'}
          />
          <span className={highlights.length > 8 ? 'cm-error-text' : 'cm-hint'}>
            {highlights.length > 8
              ? `São ${highlights.length} linhas: deixe no máximo 8`
              : '"Sem limite de equipe, produtos e pedidos" sempre aparece primeiro.'}
          </span>
        </label>
        {stale.length > 0 && (
          <Alert tone="info">
            Estes destaques falam de um serviço que está fora do plano: {stale.join('; ')}. Tire ou
            ajuste para a página de preços não prometer o que não tem.
          </Alert>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Modal>
  );
}
