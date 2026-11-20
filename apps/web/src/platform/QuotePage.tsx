import {
  type FiscalCosts,
  fiscalEstimate,
  fiscalExtraText,
  fiscalPackageText,
  formatBRL,
  formatUnitBRL,
  toCents,
} from '@comandou/shared';
import { Building2, Download, FileText, Plus, Settings2, Trash2 } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Modal,
  TextField,
  useToast,
  Skeleton,
} from '../design-system';
import { SelectField } from '../features/forms';
import { api } from '../lib/api';
import { downloadFile } from '../lib/download';
import { brl, parseBrlInput } from '../lib/money';
import { useLoad } from './OverviewPages';
import { ContractSettingsModal } from './TenantContracts';
import { PageHead, Section } from './ui';

interface ExtraCost {
  label: string;
  value: string;
}

interface QuoteSettings {
  fiscal: FiscalCosts;
  setupFee: string;
  validityDays: number;
  extraCosts: ExtraCost[];
  notes: string;
}

interface QuoteOverview {
  settings: QuoteSettings;
  plan: {
    name: string;
    priceMonthly: string;
    trialDays: number;
    featureFiscal: boolean;
    included: string[];
  } | null;
  onlinePay: { percent: string; fixed: string } | null;
  providerReady: boolean;
  quotes: {
    id: string;
    number: string;
    clientName: string;
    totalMonthly: string;
    createdAt: string;
    createdBy: string | null;
  }[];
}

const comma = (v: string) => v.replace('.', ',');
const digitsOnly = (v: string) => v.replace(/\D/g, '');
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
/** "0,055" → "0.055" (até 3 casas). */
const parseUnit = (v: string) => {
  const s = v.replace(/\s|R\$/g, '').replace(',', '.');
  return /^\d{1,3}(\.\d{1,3})?$/.test(s) ? s : null;
};

const pdfUrl = (id: string) => `/api/v1/platform/quotes/${id}/pdf?download=1`;

/** Super Admin → Orçamento: monta o orçamento do cliente e gera o PDF. */
export function QuotePage() {
  const { data, error, reload } = useLoad<QuoteOverview>('/platform/quotes');
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState(false);
  return (
    <>
      <PageHead
        page
        title="Orçamento"
        sub="Monte a proposta do cliente com o plano, a nota fiscal e os custos de terceiros, e baixe em PDF."
        actions={
          <>
            <button className="adm-action" onClick={() => setProvider(true)}>
              <Building2 size={15} /> Dados da sua empresa
            </button>
            <button className="adm-action" onClick={() => setEditing(true)} disabled={!data}>
              <Settings2 size={15} /> Valores padrão
            </button>
          </>
        }
      />
      {provider && (
        <ContractSettingsModal
          onClose={() => setProvider(false)}
          onSaved={() => {
            setProvider(false);
            reload();
          }}
        />
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {!data ? (
        <Card>
          <Skeleton variant="form" />
        </Card>
      ) : (
        <>
          {!data.providerReady && (
            <Alert tone="warning">
              Os dados da sua empresa (nome e CNPJ) ainda estão vazios. Preencha em{' '}
              <button type="button" className="adm-link" onClick={() => setProvider(true)}>
                Dados da sua empresa
              </button>{' '}
              para eles saírem no cabeçalho do PDF (e nos contratos).
            </Alert>
          )}
          {!data.plan ? (
            <Card>
              <EmptyState
                title="Nenhum plano ativo"
                description="Crie ou ative o plano em Preço para montar o orçamento."
              />
            </Card>
          ) : (
            <QuoteForm data={data} onCreated={reload} />
          )}
          <History quotes={data.quotes} />
        </>
      )}
      {editing && data && (
        <SettingsModal
          settings={data.settings}
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

function QuoteForm({ data, onCreated }: { data: QuoteOverview; onCreated(): void }) {
  const plan = data.plan!;
  const s = data.settings;
  const toast = useToast();
  const blank = () => ({
    clientName: '',
    clientDocument: '',
    contactName: '',
    email: '',
    phone: '',
    city: '',
    price: comma(plan.priceMonthly),
    setupFee: comma(s.setupFee),
    fiscal: plan.featureFiscal ? 'yes' : 'no',
    nfce: '1500',
    nfe: '0',
    validity: String(s.validityDays),
    trial: String(plan.trialDays),
    term: '12',
    implementation: '5',
    notes: s.notes,
  });
  const [f, setF] = useState(blank);
  // Valores padrão salvos de novo: o formulário acompanha (sem perder o cliente digitado).
  useEffect(() => {
    setF((x) => ({
      ...x,
      setupFee: comma(s.setupFee),
      validity: String(s.validityDays),
      notes: s.notes,
    }));
  }, [s.setupFee, s.validityDays, s.notes]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const price = parseBrlInput(f.price);
  const setup = f.setupFee.trim() === '' ? '0' : parseBrlInput(f.setupFee);
  const fiscalOn = f.fiscal === 'yes' && plan.featureFiscal;
  const nfce = Number(f.nfce || 0);
  const nfe = Number(f.nfe || 0);
  const est = useMemo(() => fiscalEstimate(s.fiscal, nfce, nfe), [s.fiscal, nfce, nfe]);
  const monthly = (price ? toCents(price) : 0) + (fiscalOn ? est.totalCents : 0);
  const first = monthly + (setup ? toCents(setup) : 0);
  const docLen = digitsOnly(f.clientDocument).length;
  const docOk = docLen === 0 || docLen === 11 || docLen === 14;
  const trialDays = Number(f.trial || 0);
  const valid =
    !!f.clientName.trim() &&
    !!price &&
    !!setup &&
    docOk &&
    Number(f.validity) >= 1 &&
    Number(f.validity) <= 90 &&
    trialDays <= 90 &&
    Number(f.implementation) >= 1;
  const validUntil = new Date(Date.now() + Number(f.validity || 0) * 86_400_000);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ id: string; number: string }>('/platform/quotes', {
        method: 'POST',
        json: {
          clientName: f.clientName.trim(),
          clientDocument: f.clientDocument,
          contactName: f.contactName.trim(),
          email: f.email.trim(),
          phone: f.phone.trim(),
          city: f.city.trim(),
          priceMonthly: price,
          setupFee: setup,
          fiscal: fiscalOn,
          nfcePerMonth: nfce,
          nfePerMonth: nfe,
          validityDays: Number(f.validity),
          trialDays,
          termMonths: Number(f.term),
          implementationDays: Number(f.implementation),
          notes: f.notes.trim(),
        },
      });
      await downloadFile(pdfUrl(r.id), `orcamento-${r.number}.pdf`);
      toast(`Orçamento ${r.number} gerado`, 'success');
      setF(blank());
      onCreated();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-two adm-quote">
      <Card title="Novo orçamento">
        <form id="orcamento-form" className="cm-form" onSubmit={submit}>
          <h3 className="cm-form__section">Cliente</h3>
          <TextField
            label="Nome do restaurante ou razão social"
            value={f.clientName}
            maxLength={160}
            onChange={(e) => set('clientName')(e.target.value)}
            wrapClass="cm-form__wide"
          />
          <TextField
            label="CPF ou CNPJ"
            inputMode="numeric"
            value={f.clientDocument}
            onChange={(e) => set('clientDocument')(e.target.value)}
            error={docOk ? undefined : 'CPF tem 11 dígitos e CNPJ 14'}
          />
          <TextField
            label="Responsável"
            value={f.contactName}
            maxLength={120}
            onChange={(e) => set('contactName')(e.target.value)}
          />
          <TextField
            label="E-mail"
            type="email"
            value={f.email}
            onChange={(e) => set('email')(e.target.value)}
          />
          <TextField
            label="Telefone"
            inputMode="tel"
            value={f.phone}
            maxLength={30}
            onChange={(e) => set('phone')(e.target.value)}
          />
          <TextField
            label="Cidade/UF"
            value={f.city}
            maxLength={80}
            onChange={(e) => set('city')(e.target.value)}
          />

          <h3 className="cm-form__section">Valores</h3>
          <TextField
            label="Mensalidade (R$)"
            inputMode="decimal"
            value={f.price}
            onChange={(e) => set('price')(e.target.value)}
            error={price ? undefined : 'Ex.: 400,00'}
          />
          <TextField
            label="Implantação (R$)"
            inputMode="decimal"
            value={f.setupFee}
            onChange={(e) => set('setupFee')(e.target.value)}
            error={setup ? undefined : 'Ex.: 0,00'}
            hint="0 = sem custo"
          />

          <h3 className="cm-form__section">Prazos</h3>
          <TextField
            label="Validade da proposta (dias)"
            inputMode="numeric"
            value={f.validity}
            onChange={(e) => set('validity')(digitsOnly(e.target.value).slice(0, 2))}
            error={
              Number(f.validity) >= 1 && Number(f.validity) <= 90 ? undefined : 'De 1 a 90 dias'
            }
            hint={
              Number(f.validity) >= 1
                ? `Vale até ${validUntil.toLocaleDateString('pt-BR')}`
                : undefined
            }
          />
          <div className="adm-chips adm-quote__chips" role="group" aria-label="Validade rápida">
            {[7, 15, 30, 60].map((d) => (
              <button
                key={d}
                type="button"
                className="adm-chip"
                aria-pressed={Number(f.validity) === d}
                onClick={() => set('validity')(String(d))}
              >
                {d} dias
              </button>
            ))}
          </div>
          <TextField
            label="Teste grátis (dias)"
            inputMode="numeric"
            value={f.trial}
            onChange={(e) => set('trial')(digitsOnly(e.target.value).slice(0, 2))}
            error={trialDays <= 90 ? undefined : 'Até 90 dias'}
            hint={`0 = sem teste · plano: ${plan.trialDays} dias`}
          />
          <SelectField
            label="Vigência do contrato"
            value={f.term}
            onChange={(e) => set('term')(e.target.value)}
          >
            {[1, 3, 6, 12].map((m) => (
              <option key={m} value={String(m)}>
                {m === 1 ? '1 mês' : `${m} meses`}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Prazo de implantação (dias úteis)"
            inputMode="numeric"
            value={f.implementation}
            onChange={(e) => set('implementation')(digitsOnly(e.target.value).slice(0, 2))}
            error={Number(f.implementation) >= 1 ? undefined : 'Pelo menos 1 dia'}
          />

          <h3 className="cm-form__section">Nota fiscal (Focus NFe)</h3>
          <SelectField
            label="Vai emitir nota?"
            value={fiscalOn ? 'yes' : 'no'}
            disabled={!plan.featureFiscal}
            onChange={(e) => set('fiscal')(e.target.value)}
          >
            <option value="yes">Sim</option>
            <option value="no">Não por enquanto</option>
          </SelectField>
          <TextField
            label="NFC-e por mês (estimativa)"
            inputMode="numeric"
            value={f.nfce}
            disabled={!fiscalOn}
            onChange={(e) => set('nfce')(digitsOnly(e.target.value).slice(0, 7))}
            hint="Em geral, uma por venda"
          />
          <TextField
            label="NF-e por mês (estimativa)"
            inputMode="numeric"
            value={f.nfe}
            disabled={!fiscalOn}
            onChange={(e) => set('nfe')(digitsOnly(e.target.value).slice(0, 7))}
            hint="Vendas para empresas"
          />
          <label className="cm-field">
            <span className="cm-label">Observações no PDF</span>
            <textarea
              className="cm-input"
              rows={3}
              maxLength={2000}
              value={f.notes}
              onChange={(e) => set('notes')(e.target.value)}
              placeholder="Ex.: condição especial de lançamento, prazo de implantação..."
            />
          </label>
          {err && <Alert tone="danger">{err}</Alert>}
        </form>
      </Card>

      <Card title="Resumo">
        <div className="adm-quote__sum">
          <div className="adm-quote__price">
            <span>{price ? brl(price) : '—'}</span>
            <small>por mês, valor fixo</small>
          </div>
          <dl className="adm-quote__rows">
            <dt>Plano {plan.name}</dt>
            <dd>{price ? brl(price) : '—'}</dd>
            {fiscalOn && (
              <>
                <dt>Nota fiscal (estimativa)</dt>
                <dd>{formatBRL(est.totalCents)}</dd>
              </>
            )}
            <dt className="adm-quote__total">Total mensal estimado</dt>
            <dd className="adm-quote__total">{formatBRL(monthly)}</dd>
            <dt>Implantação</dt>
            <dd>{setup && toCents(setup) > 0 ? brl(setup) : 'sem custo'}</dd>
            <dt>Teste grátis</dt>
            <dd>{trialDays > 0 ? `${trialDays} dias` : 'sem teste'}</dd>
            <dt>Primeiro pagamento</dt>
            <dd>{formatBRL(first)}</dd>
            <dt>Validade da proposta</dt>
            <dd>
              {Number(f.validity) >= 1 ? `até ${validUntil.toLocaleDateString('pt-BR')}` : '—'}
            </dd>
            <dt>Vigência</dt>
            <dd>{f.term === '1' ? '1 mês' : `${f.term} meses`}</dd>
          </dl>
          {fiscalOn && (
            <p className="adm-quote__note">
              {s.fiscal.mode === 'included'
                ? `Nota incluída na mensalidade: ${fiscalPackageText(s.fiscal)}.`
                : `Nota repassada pelo custo da Focus: ${formatUnitBRL(s.fiscal.monthly)}/mês com ${fiscalPackageText(s.fiscal)}.`}{' '}
              Acima disso, {fiscalExtraText(s.fiscal)}.
              {est.nfceExtraCount + est.nfeExtraCount > 0 &&
                ` Neste volume: ${est.nfceExtraCount.toLocaleString('pt-BR')} NFC-e e ${est.nfeExtraCount.toLocaleString('pt-BR')} NF-e a mais (${formatBRL(est.extraCents)}).`}
            </p>
          )}
          {data.onlinePay && (
            <p className="adm-quote__note">
              Pagamento pelo app: {comma(data.onlinePay.percent)}% por pagamento
              {toCents(data.onlinePay.fixed) > 0 ? ` + ${brl(data.onlinePay.fixed)}` : ''}, além da
              tarifa do PagBank.
            </p>
          )}
          <Button
            type="submit"
            form="orcamento-form"
            variant="primary"
            size="lg"
            loading={busy}
            disabled={!valid}
          >
            <FileText size={16} /> Gerar PDF
          </Button>
          <p className="adm-quote__note">
            O PDF sai como proposta comercial formal: apresentação, escopo, investimento,
            implantação, nota fiscal, condições, nível de serviço, validade e campo de aceite. Fica
            salvo na lista abaixo.
          </p>
        </div>
      </Card>
    </div>
  );
}

function History({ quotes }: { quotes: QuoteOverview['quotes'] }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function get(q: QuoteOverview['quotes'][number]) {
    setBusy(q.id);
    try {
      await downloadFile(pdfUrl(q.id), `orcamento-${q.number}.pdf`);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }
  return (
    <Section
      title="Orçamentos gerados"
      sub={quotes.length ? `${quotes.length} mais recentes` : undefined}
    >
      <Card bodyless>
        {quotes.length === 0 ? (
          <EmptyState
            title="Nenhum orçamento ainda"
            description="Os orçamentos gerados aparecem aqui para baixar de novo."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Cliente</th>
                  <th className="cm-num">Mensal</th>
                  <th>Gerado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <strong>{q.number}</strong>
                    </td>
                    <td>{q.clientName}</td>
                    <td className="cm-num">{brl(q.totalMonthly)}</td>
                    <td>
                      {dateTime(q.createdAt)}
                      {q.createdBy && <span className="cm-hint"> · {q.createdBy}</span>}
                    </td>
                    <td className="cm-num">
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy === q.id}
                        onClick={() => void get(q)}
                      >
                        <Download size={14} /> PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Section>
  );
}

function SettingsModal({
  settings: s,
  onClose,
  onSaved,
}: {
  settings: QuoteSettings;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    mode: s.fiscal.mode,
    monthly: comma(s.fiscal.monthly),
    nfceIncluded: String(s.fiscal.nfceIncluded),
    nfeIncluded: String(s.fiscal.nfeIncluded),
    nfceExtra: comma(s.fiscal.nfceExtra),
    nfeExtra: comma(s.fiscal.nfeExtra),
    setupFee: comma(s.setupFee),
    validity: String(s.validityDays),
    notes: s.notes,
  });
  const [extras, setExtras] = useState<ExtraCost[]>(s.extraCosts);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const monthly = parseBrlInput(f.monthly);
  const setup = f.setupFee.trim() === '' ? '0' : parseBrlInput(f.setupFee);
  const nfceExtra = parseUnit(f.nfceExtra);
  const nfeExtra = parseUnit(f.nfeExtra);
  const cleanExtras = extras
    .map((x) => ({ label: x.label.trim(), value: x.value.trim() }))
    .filter((x) => x.label && x.value);
  const valid = !!monthly && !!setup && !!nfceExtra && !!nfeExtra && Number(f.validity) >= 1;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      await api('/platform/quotes/settings', {
        method: 'PUT',
        json: {
          fiscal: {
            mode: f.mode,
            monthly,
            nfceIncluded: Number(f.nfceIncluded || 0),
            nfeIncluded: Number(f.nfeIncluded || 0),
            nfceExtra,
            nfeExtra,
          },
          setupFee: setup,
          validityDays: Number(f.validity),
          extraCosts: cleanExtras,
          notes: f.notes.trim(),
        },
      });
      toast('Valores padrão salvos', 'success');
      onSaved();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Valores padrão do orçamento"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="orcamento-padrao" loading={busy} disabled={!valid}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="orcamento-padrao" className="cm-form" onSubmit={submit}>
        <h3 className="cm-form__section">Nota fiscal (Focus NFe)</h3>
        <p className="cm-hint">
          Estes valores saem no orçamento e entram na cláusula da nota fiscal dos contratos novos. O
          padrão é o preço público do plano Retail da Focus (R$ 62,90 com 500 NFC-e e 100 NF-e; R$
          0,055 por NFC-e e R$ 0,16 por NF-e a mais): o restaurante paga o mesmo que pagaria lá.
        </p>
        <SelectField
          label="Como cobrar a nota"
          value={f.mode}
          onChange={(e) => set('mode')(e.target.value)}
        >
          <option value="passthrough">À parte da mensalidade</option>
          <option value="included">Incluída na mensalidade</option>
        </SelectField>
        <TextField
          label="Mensalidade da nota por CNPJ (R$)"
          inputMode="decimal"
          value={f.monthly}
          disabled={f.mode === 'included'}
          onChange={(e) => set('monthly')(e.target.value)}
          error={monthly ? undefined : 'Ex.: 62,90'}
        />
        <TextField
          label="NFC-e no pacote"
          inputMode="numeric"
          value={f.nfceIncluded}
          onChange={(e) => set('nfceIncluded')(digitsOnly(e.target.value).slice(0, 7))}
        />
        <TextField
          label="NF-e no pacote"
          inputMode="numeric"
          value={f.nfeIncluded}
          onChange={(e) => set('nfeIncluded')(digitsOnly(e.target.value).slice(0, 7))}
        />
        <TextField
          label="Por NFC-e a mais (R$)"
          inputMode="decimal"
          value={f.nfceExtra}
          onChange={(e) => set('nfceExtra')(e.target.value)}
          error={nfceExtra ? undefined : 'Ex.: 0,055'}
        />
        <TextField
          label="Por NF-e a mais (R$)"
          inputMode="decimal"
          value={f.nfeExtra}
          onChange={(e) => set('nfeExtra')(e.target.value)}
          error={nfeExtra ? undefined : 'Ex.: 0,16'}
        />

        <h3 className="cm-form__section">Orçamento</h3>
        <TextField
          label="Implantação padrão (R$)"
          inputMode="decimal"
          value={f.setupFee}
          onChange={(e) => set('setupFee')(e.target.value)}
          error={setup ? undefined : 'Ex.: 0,00'}
        />
        <TextField
          label="Validade padrão (dias)"
          inputMode="numeric"
          value={f.validity}
          onChange={(e) => set('validity')(digitsOnly(e.target.value).slice(0, 2))}
        />
        <label className="cm-field">
          <span className="cm-label">Observações padrão</span>
          <textarea
            className="cm-input"
            rows={2}
            maxLength={2000}
            value={f.notes}
            onChange={(e) => set('notes')(e.target.value)}
          />
        </label>

        <h3 className="cm-form__section">Outros custos (de terceiros)</h3>
        <div className="adm-quote__extras">
          {extras.map((x, i) => (
            <div key={i} className="adm-quote__extra">
              <TextField
                label="Item"
                value={x.label}
                maxLength={80}
                onChange={(e) =>
                  setExtras((l) => l.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))
                }
              />
              <TextField
                label="Quanto custa / observação"
                value={x.value}
                maxLength={300}
                onChange={(e) =>
                  setExtras((l) => l.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))
                }
              />
              <Button
                variant="ghost"
                type="button"
                aria-label={`Tirar ${x.label || 'item'}`}
                onClick={() => setExtras((l) => l.filter((_, j) => j !== i))}
              >
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
          {extras.length < 12 && (
            <Button
              variant="secondary"
              type="button"
              onClick={() => setExtras((l) => [...l, { label: '', value: '' }])}
            >
              <Plus size={15} /> Adicionar custo
            </Button>
          )}
        </div>
        {err && <Alert tone="danger">{err}</Alert>}
      </form>
    </Modal>
  );
}
