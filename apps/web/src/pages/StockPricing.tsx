import { formatBRL, fromCents, toCents } from '@comandou/shared';
import { Calculator, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Segmented,
  TextField,
  useToast,
  Skeleton,
} from '../design-system';
import { useCan } from '../app/auth';
import {
  analyzePrice,
  costToCents,
  deductions,
  fmtFactor,
  fmtPct,
  markupFactor,
  type PricingAnalysis,
  type PricingParams,
  type PricingStatus,
} from '../features/pricing';
import { api } from '../lib/api';
import { useDebounced, useRealtime } from '../lib/realtime';
import { brl, parseBrlInput } from '../lib/money';
import type { PricingData, PricingProduct, PricingSettings } from '../lib/types';
import { CostChangesCard } from './stock/CostChanges';

const STATUS: Record<
  PricingStatus,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  ok: { label: 'Saudável', tone: 'success' },
  below: { label: 'Abaixo do sugerido', tone: 'warning' },
  loss: { label: 'Prejuízo', tone: 'danger' },
  'no-recipe': { label: 'Sem ficha técnica', tone: 'neutral' },
};
type Filter = 'all' | 'attention' | 'loss' | 'no-recipe';

const toParams = (s: PricingSettings, targetMargin?: string | null): PricingParams => ({
  taxPercent: Number(s.taxPercent),
  feePercent: Number(s.feePercent),
  fixedPercent: Number(s.fixedPercent),
  targetMargin: Number(targetMargin ?? s.targetMargin),
});
/** "6.50" → "6,5" para o campo. */
const pctInput = (v: string) => String(Number(v)).replace('.', ',');
const parsePct = (v: string) => {
  const c = v.trim().replace(',', '.');
  return /^\d{1,2}(\.\d{1,2})?$/.test(c) ? c : null;
};

/**
 * Precificação: custo de cada produto pela ficha técnica, CMV, markup, margem de contribuição,
 * lucro e o preço sugerido pelo markup divisor, com simulador por produto.
 */
export function PricingTab() {
  const [data, setData] = useState<PricingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [sim, setSim] = useState<PricingProduct | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<PricingData>('/stock/pricing'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Custo automático: mudou o custo de um insumo, os custos e margens daqui já mudam.
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'stock.changed') reload();
  }, load);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.products
      .filter((p) => p.active)
      .map((p) => ({
        p,
        a: analyzePrice(
          toCents(p.price),
          p.hasRecipe ? costToCents(p.cost) : null,
          toParams(data.settings, p.targetMargin),
        ),
      }));
  }, [data]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <Skeleton variant="table" />;

  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = fold(query.trim());
  const shown = rows.filter(({ p, a }) => {
    if (filter === 'attention' && a.status !== 'below' && a.status !== 'loss') return false;
    if (filter === 'loss' && a.status !== 'loss') return false;
    if (filter === 'no-recipe' && a.status !== 'no-recipe') return false;
    return !q || fold(`${p.name} ${p.categoryName}`).includes(q);
  });
  const count = (s: PricingStatus) => rows.filter((r) => r.a.status === s).length;
  const revenue = toCents(data.summary.revenue30);
  const cogs = toCents(data.summary.cogs30);

  return (
    <>
      <div className="st-kpis">
        <div className="st-kpi">
          <span className="st-kpi__label">Faturamento (30 dias)</span>
          <strong className="st-kpi__value">{brl(data.summary.revenue30)}</strong>
          <span className="st-kpi__hint">Pedidos não cancelados</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi__label">CMV real (30 dias)</span>
          <strong className="st-kpi__value">{brl(data.summary.cogs30)}</strong>
          <span className="st-kpi__hint">
            {revenue > 0
              ? `${fmtPct((cogs / revenue) * 100)} do faturamento`
              : 'Sem vendas no período'}
          </span>
        </div>
        <div
          className="st-kpi"
          data-tone={toCents(data.summary.losses30) > 0 ? 'warning' : undefined}
        >
          <span className="st-kpi__label">Perdas (30 dias)</span>
          <strong className="st-kpi__value">{brl(data.summary.losses30)}</strong>
          <span className="st-kpi__hint">Vencidos, quebras, erros</span>
        </div>
        <button
          type="button"
          className="st-kpi"
          data-tone={count('loss') ? 'danger' : count('below') ? 'warning' : undefined}
          onClick={() => setFilter('attention')}
        >
          <span className="st-kpi__label">Produtos para revisar</span>
          <strong className="st-kpi__value">{count('loss') + count('below')}</strong>
          <span className="st-kpi__hint">
            {count('loss')} com prejuízo · {count('no-recipe')} sem ficha
          </span>
        </button>
      </div>

      <SettingsCard settings={data.settings} onSaved={load} />

      <Card title="Produtos" bodyless>
        <div className="st-toolbar">
          <TextField
            label="Buscar"
            placeholder="Produto ou categoria"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            wrapClass="st-toolbar__search"
          />
          <div className="cm-field">
            <span className="cm-label">Mostrar</span>
            <Segmented<Filter>
              label="Filtro de produtos"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'attention', label: 'Revisar' },
                { value: 'loss', label: 'Prejuízo' },
                { value: 'no-recipe', label: 'Sem ficha' },
              ]}
            />
          </div>
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={<Search size={20} />} title="Nenhum produto com esses filtros" />
        ) : (
          <div className="st-scroll">
            <table className="cm-table st-table st-pricing">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="cm-num">Preço</th>
                  <th className="cm-num">Custo</th>
                  <th className="cm-num">CMV</th>
                  <th className="cm-num">Markup</th>
                  <th className="cm-num">Margem contrib.</th>
                  <th className="cm-num">Lucro</th>
                  <th className="cm-num">Sugerido</th>
                  <th>Situação</th>
                  <th className="cm-num" />
                </tr>
              </thead>
              <tbody>
                {shown.map(({ p, a }) => (
                  <tr key={p.id}>
                    <td>
                      <div className="st-name">
                        <strong>{p.name}</strong>
                        <span className="st-name__meta">
                          {p.categoryName}
                          {Number(p.sold30) > 0 &&
                            ` · ${Number(p.sold30).toLocaleString('pt-BR')} vendidos em 30 dias`}
                        </span>
                      </div>
                    </td>
                    <td className="cm-num">
                      <strong>{brl(p.price)}</strong>
                    </td>
                    <td className="cm-num">
                      <span className="st-stack">
                        {p.hasRecipe ? formatBRL(costToCents(p.cost)!) : '—'}
                        {p.missingCost && <span className="cm-hint">insumo sem custo</span>}
                      </span>
                    </td>
                    <td className="cm-num">{fmtPct(a.cmvPercent)}</td>
                    <td className="cm-num">{fmtFactor(a.markup)}</td>
                    <td className="cm-num">
                      {p.hasRecipe ? (
                        <span className="st-stack">
                          {formatBRL(a.contributionCents)}
                          <span className="cm-hint">{fmtPct(a.contributionPercent)}</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="cm-num">
                      {p.hasRecipe ? (
                        <span className="st-stack st-delta" data-neg={a.netCents < 0 || undefined}>
                          {formatBRL(a.netCents)}
                          <span className="cm-hint">{fmtPct(a.netPercent)}</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="cm-num">
                      <span className="st-stack">
                        {a.suggestedRoundCents !== null ? (
                          <strong>{formatBRL(a.suggestedRoundCents)}</strong>
                        ) : (
                          '—'
                        )}
                        {p.targetMargin && (
                          <span className="cm-hint">lucro {fmtPct(Number(p.targetMargin), 0)}</span>
                        )}
                      </span>
                    </td>
                    <td>
                      <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                    </td>
                    <td className="cm-num" data-label="">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Calculator size={15} />}
                        onClick={() => setSim(p)}
                      >
                        Simular
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data.options.length > 0 && (
        <Card title="Adicionais" bodyless>
          <div className="st-scroll">
            <table className="cm-table st-table">
              <thead>
                <tr>
                  <th>Adicional</th>
                  <th className="cm-num">Preço</th>
                  <th className="cm-num">Custo</th>
                  <th className="cm-num">CMV</th>
                  <th className="cm-num">Margem contrib.</th>
                  <th className="cm-num">Sugerido</th>
                </tr>
              </thead>
              <tbody>
                {data.options
                  .filter((o) => o.active)
                  .map((o) => {
                    const a = analyzePrice(
                      toCents(o.price),
                      o.hasRecipe ? costToCents(o.cost) : null,
                      toParams(data.settings),
                    );
                    return (
                      <tr key={o.id}>
                        <td>
                          <div className="st-name">
                            <strong>{o.name}</strong>
                            <span className="st-name__meta">{o.groupName}</span>
                          </div>
                        </td>
                        <td className="cm-num">{brl(o.price)}</td>
                        <td className="cm-num">
                          {o.hasRecipe ? formatBRL(costToCents(o.cost)!) : '—'}
                        </td>
                        <td className="cm-num">{fmtPct(a.cmvPercent)}</td>
                        <td className="cm-num">
                          {o.hasRecipe ? formatBRL(a.contributionCents) : '—'}
                        </td>
                        <td className="cm-num">
                          {a.suggestedRoundCents !== null ? formatBRL(a.suggestedRoundCents) : '—'}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CostChangesCard />

      {sim && (
        <SimulatorModal
          product={sim}
          settings={data.settings}
          onClose={() => setSim(null)}
          onSaved={() => {
            setSim(null);
            void load();
          }}
        />
      )}
    </>
  );
}

/** Parâmetros do restaurante: o que sai de cada venda além dos insumos. */
function SettingsCard({ settings, onSaved }: { settings: PricingSettings; onSaved(): void }) {
  const toast = useToast();
  const canWrite = useCan('stock:write');
  const [form, setForm] = useState({
    taxPercent: pctInput(settings.taxPercent),
    feePercent: pctInput(settings.feePercent),
    fixedPercent: pctInput(settings.fixedPercent),
    targetMargin: pctInput(settings.targetMargin),
  });
  const [busy, setBusy] = useState(false);
  const parsed = {
    taxPercent: parsePct(form.taxPercent),
    feePercent: parsePct(form.feePercent),
    fixedPercent: parsePct(form.fixedPercent),
    targetMargin: parsePct(form.targetMargin),
  };
  const ok = Object.values(parsed).every((v) => v !== null);
  const params: PricingParams | null = ok
    ? {
        taxPercent: Number(parsed.taxPercent),
        feePercent: Number(parsed.feePercent),
        fixedPercent: Number(parsed.fixedPercent),
        targetMargin: Number(parsed.targetMargin),
      }
    : null;
  const sum = params ? deductions(params) : null;
  const tooHigh = sum !== null && sum > 90;
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some(
    (k) => form[k] !== pctInput(settings[k]),
  );

  async function save() {
    setBusy(true);
    try {
      await api('/stock/pricing/settings', { method: 'PUT', json: parsed });
      toast('Parâmetros de preço salvos', 'success');
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof typeof form, label: string, hint: string) => (
    <TextField
      label={label}
      inputMode="decimal"
      value={form[k]}
      disabled={!canWrite}
      hint={hint}
      error={parsed[k] === null ? 'Ex.: 6 ou 6,5' : undefined}
      onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
    />
  );

  return (
    <Card
      title="Como o preço é formado"
      actions={
        canWrite && (
          <Button loading={busy} disabled={!ok || tooHigh || !dirty} onClick={save}>
            Salvar parâmetros
          </Button>
        )
      }
    >
      <div className="cm-form">
        <p className="cm-hint" style={{ margin: 0 }}>
          Percentuais sobre o preço de venda. Preço sugerido = custo da ficha ÷ (1 − soma). Ajuste
          com os números do seu negócio: impostos do seu regime, taxa média das maquininhas e apps e
          quanto as despesas fixas (aluguel, salários, contas) pesam no faturamento.
        </p>
        <div className="st-grid st-grid--4">
          {field('taxPercent', 'Impostos (%)', 'Ex.: Simples Nacional')}
          {field('feePercent', 'Taxas de venda (%)', 'Cartão, apps, delivery')}
          {field('fixedPercent', 'Despesas fixas (%)', 'Aluguel, folha, contas')}
          {field('targetMargin', 'Lucro desejado (%)', 'O que sobra limpo')}
        </div>
        {params && <FormationBar params={params} />}
        <div className="st-preview st-preview--compact">
          <div data-tone="brand">
            <span>Markup multiplicador</span>
            <strong>{params ? fmtFactor(markupFactor(params)) : '—'}</strong>
          </div>
          <div>
            <span>CMV ideal (insumos)</span>
            <strong>{sum !== null ? fmtPct(100 - sum) : '—'}</strong>
          </div>
          <div data-tone={tooHigh ? 'danger' : undefined}>
            <span>Soma dos percentuais</span>
            <strong>{sum !== null ? fmtPct(sum) : '—'}</strong>
          </div>
        </div>
        {tooHigh && (
          <Alert tone="warning">A soma passa de 90%: não sobra espaço para o custo.</Alert>
        )}
      </div>
    </Card>
  );
}

/** Para onde vai cada real do preço: barra empilhada colorida. */
function FormationBar({
  params,
  analysis,
  priceCents,
}: {
  params: PricingParams;
  analysis?: PricingAnalysis;
  priceCents?: number;
}) {
  const cmv = analysis ? (analysis.cmvPercent ?? 0) : 100 - deductions(params);
  const profit = analysis ? (analysis.netPercent ?? 0) : params.targetMargin;
  const parts = [
    { key: 'cost', label: 'Insumos', pct: cmv },
    { key: 'tax', label: 'Impostos', pct: params.taxPercent },
    { key: 'fee', label: 'Taxas', pct: params.feePercent },
    { key: 'fixed', label: 'Despesas fixas', pct: params.fixedPercent },
    { key: profit < 0 ? 'loss' : 'profit', label: profit < 0 ? 'Prejuízo' : 'Lucro', pct: profit },
  ];
  return (
    <div className="st-formation">
      <div className="st-formation__bar" aria-hidden>
        {parts
          .filter((p) => p.pct > 0 && p.key !== 'loss')
          .map((p) => (
            <span key={p.key} data-part={p.key} style={{ flexGrow: p.pct }} />
          ))}
      </div>
      <ul className="st-formation__legend">
        {parts.map((p) => (
          <li key={p.key} data-part={p.key}>
            <i aria-hidden />
            <span>{p.label}</span>
            <strong>
              {fmtPct(p.pct)}
              {priceCents !== undefined && ` · ${formatBRL((priceCents * p.pct) / 100)}`}
            </strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SimulatorModal({
  product,
  settings,
  onClose,
  onSaved,
}: {
  product: PricingProduct;
  settings: PricingSettings;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const canWrite = useCan('stock:write');
  const canCatalog = useCan('catalog:write');
  const [price, setPrice] = useState(product.price.replace('.', ','));
  const [margin, setMargin] = useState(pctInput(product.targetMargin ?? settings.targetMargin));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const priceStr = parseBrlInput(price);
  const marginStr = parsePct(margin);
  const params = toParams(settings, marginStr ?? settings.targetMargin);
  const priceCents = priceStr ? toCents(priceStr) : 0;
  const cost = product.hasRecipe ? costToCents(product.cost) : null;
  const a = analyzePrice(priceCents, cost, params);
  const sold = Number(product.sold30);
  const priceChanged = priceStr !== null && toCents(priceStr) !== toCents(product.price);
  const marginOverride =
    marginStr !== null && Number(marginStr) !== Number(settings.targetMargin) ? marginStr : null;
  const marginChanged =
    (marginOverride === null ? null : Number(marginOverride)) !==
    (product.targetMargin === null ? null : Number(product.targetMargin));
  const tooHigh = deductions(params) > 90;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (marginChanged && canWrite) {
        await api(`/stock/pricing/products/${product.id}`, {
          method: 'PUT',
          json: { targetMargin: marginOverride },
        });
      }
      if (priceChanged && canCatalog) {
        await api(`/products/${product.id}`, { method: 'PATCH', json: { price: priceStr } });
      }
      toast(
        priceChanged && canCatalog ? 'Preço atualizado no cardápio' : 'Precificação salva',
        'success',
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canSave =
    !tooHigh &&
    priceStr !== null &&
    marginStr !== null &&
    ((priceChanged && canCatalog) || (marginChanged && canWrite));

  return (
    <Modal
      open
      size="lg"
      title={`Simular preço · ${product.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button loading={busy} disabled={!canSave} onClick={save}>
            {priceChanged && canCatalog
              ? `Aplicar ${priceStr ? formatBRL(toCents(priceStr)) : ''}`
              : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="cm-form">
        {error && <Alert tone="danger">{error}</Alert>}
        {!product.hasRecipe && (
          <Alert tone="warning">
            Este produto não tem ficha técnica: sem ela não dá para saber o custo. Monte a ficha na
            aba Ficha técnica.
          </Alert>
        )}
        {product.missingCost && (
          <Alert tone="info">
            Algum insumo da ficha está sem custo: registre uma entrada com valor.
          </Alert>
        )}
        <div className="st-grid">
          <TextField
            label="Preço de venda (R$)"
            inputMode="decimal"
            value={price}
            hint={`Atual: ${brl(product.price)}${!canCatalog ? ' · só quem edita o cardápio aplica' : ''}`}
            error={price && priceStr === null ? 'Valor inválido' : undefined}
            onChange={(e) => setPrice(e.target.value)}
          />
          <TextField
            label="Lucro desejado deste produto (%)"
            inputMode="decimal"
            value={margin}
            disabled={!canWrite}
            hint={`Padrão do restaurante: ${fmtPct(Number(settings.targetMargin), 0)}`}
            error={
              marginStr === null
                ? 'Ex.: 15'
                : tooHigh
                  ? 'Soma dos percentuais acima de 90%'
                  : undefined
            }
            onChange={(e) => setMargin(e.target.value)}
          />
        </div>
        <div className="st-preview">
          <div>
            <span>Custo da ficha</span>
            <strong>{cost !== null ? formatBRL(cost) : '—'}</strong>
          </div>
          <div>
            <span>CMV · Markup</span>
            <strong>
              {fmtPct(a.cmvPercent)} · {fmtFactor(a.markup)}
            </strong>
          </div>
          <div data-tone={a.netCents < 0 ? 'danger' : 'success'}>
            <span>Lucro por unidade</span>
            <strong>
              {cost !== null ? `${formatBRL(a.netCents)} (${fmtPct(a.netPercent)})` : '—'}
            </strong>
          </div>
        </div>
        {cost !== null && priceCents > 0 && (
          <FormationBar params={params} analysis={a} priceCents={priceCents} />
        )}
        {a.suggestedCents !== null && a.suggestedRoundCents !== null && (
          <div className="st-suggest">
            <div>
              <span className="cm-hint">
                Preço sugerido para {fmtPct(params.targetMargin, 0)} de lucro
              </span>
              <strong>{formatBRL(a.suggestedRoundCents)}</strong>
              <span className="cm-hint">exato: {formatBRL(a.suggestedCents)}</span>
            </div>
            <Button
              variant="secondary"
              onClick={() => setPrice(fromCents(a.suggestedRoundCents!).replace('.', ','))}
            >
              Usar sugerido
            </Button>
          </div>
        )}
        {cost !== null && sold > 0 && (
          <p className="cm-hint" style={{ margin: 0 }}>
            Nos últimos 30 dias saíram {sold.toLocaleString('pt-BR')} unidades. Com este preço, o
            lucro estimado no mês seria {formatBRL(a.netCents * sold)} e a margem de contribuição{' '}
            {formatBRL(a.contributionCents * sold)}.
          </p>
        )}
      </div>
    </Modal>
  );
}
