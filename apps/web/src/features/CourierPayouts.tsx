import {
  COURIER_PAY_MODE_LABELS,
  COURIER_PAY_MODES,
  COURIER_TAX_REGIME_LABELS,
  COURIER_TAX_REGIMES,
  deliveryPay,
  describePayRule,
  formatBRL,
  toCents,
  type CourierPayMode,
  type CourierPayRule,
  type CourierTaxRegime,
  type CourierTaxSettings,
} from '@comandou/shared';
import {
  Bike,
  ChevronLeft,
  ChevronRight,
  Printer,
  Receipt,
  Scale,
  Settings2,
  Wallet,
} from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
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
import { useAuth, useCan } from '../app/auth';
import { api } from '../lib/api';
import { brl, parseBrlInput } from '../lib/money';
import { escapeHtml, printDocument } from '../lib/print-doc';
import { CheckField, SelectField } from './forms';
import { dateTime } from './format';
import { kmLabel } from './live-geo';
import '../pages/reports.css';

interface Settings {
  rule: CourierPayRule;
  taxes: CourierTaxSettings;
  description: string;
}

interface Line {
  courierId: string;
  name: string;
  phone: string | null;
  active: boolean;
  taxRegime: CourierTaxRegime;
  pixKey: string | null;
  ownRule: boolean;
  payRule: CourierPayRule | null;
  rule: string;
  delivered: number;
  failed: number;
  daysWorked: number;
  distanceM: number;
  rides: string;
  daily: string;
  earned: string;
  employerEstimate: string;
  costEstimate: string;
  paidCount: number;
  paidGross: string;
  paidWithheld: string;
  paidNet: string;
  paidEmployer: string;
  pendingRides: number;
  pendingGross: string;
  pendingWithheld: string;
  pendingNet: string;
}

interface Payout {
  id: string;
  courierId: string;
  courierName: string;
  periodFrom: string | null;
  periodTo: string;
  deliveries: number;
  daysWorked: number;
  distanceM: number;
  rides: string;
  daily: string;
  adjustments: string;
  gross: string;
  inss: string;
  irrf: string;
  iss: string;
  net: string;
  employer: string;
  taxRegime: CourierTaxRegime;
  method: string;
  notes: string | null;
  paidAt: string;
  inFinance: boolean;
}

interface Report {
  month: string;
  settings: Settings;
  totals: {
    delivered: number;
    failed: number;
    distanceM: number;
    earned: string;
    costEstimate: string;
    paidNet: string;
    paidWithheld: string;
    paidEmployer: string;
    pendingGross: string;
    pendingNet: string;
    deliveryFees: string;
    deliveryOrders: number;
  };
  couriers: Line[];
  days: { day: string; deliveries: number; cost: string }[];
  payouts: Payout[];
}

interface Draft {
  courierName: string;
  pixKey: string | null;
  taxRegime: CourierTaxRegime;
  periodFrom: string | null;
  periodTo: string;
  deliveries: number;
  failed: number;
  daysWorked: number;
  distanceM: number;
  rides: string;
  daily: string;
  adjustments: string;
  gross: string;
  inss: string;
  irrf: string;
  iss: string;
  withheld: string;
  net: string;
  employer: string;
  cost: string;
  rule: string;
}

const METHOD_LABEL: Record<string, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  transfer: 'Transferência',
  other: 'Outro',
};
const shiftMonth = (m: string, n: number) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (m: string) =>
  new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const br = (v: string) => v.replace('.', ',');
const fmtDay = (d: string) => d.split('-').reverse().join('/');
const nonZero = (v: string) => toCents(v) !== 0;

/**
 * Repasses aos entregadores (Entregas › Repasses): no mês, quanto cada motoboy ganhou, quanto
 * já foi pago e retido, o que falta pagar e quanto custou para a loja, com o custo por dia e
 * a comparação com as taxas de entrega cobradas. Daqui o dono ajusta a regra de pagamento e
 * os impostos, define o regime de cada motoboy e paga (com recibo e lançamento no Financeiro).
 */
export function CourierPayouts() {
  const canWrite = useCan('finance:write');
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState(false);
  const [editing, setEditing] = useState<Line | null>(null);
  const [paying, setPaying] = useState<Line | null>(null);
  const [receipt, setReceipt] = useState<Payout | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  const { me } = useAuth();

  function printReceipt() {
    const el = receiptRef.current;
    if (!el || !receipt) return;
    const store = me?.tenant.name ?? '';
    printDocument({
      title: `Recibo - ${receipt.courierName}`,
      html: `<header class="pr-head">${store ? `<p>${escapeHtml(store)}</p>` : ''}<h1>Recibo de pagamento ao entregador</h1></header>${el.outerHTML}`,
      css: RECEIPT_PRINT_CSS,
    });
  }

  const load = useCallback(async () => {
    try {
      setData(await api<Report>(`/courier-pay/report?month=${month}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [month]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const t = data?.totals;
  const balance = t ? toCents(t.deliveryFees) - toCents(t.costEstimate) : 0;
  const visible = data?.couriers.filter(
    (c) => c.active || c.delivered + c.failed + c.paidCount + c.pendingRides > 0,
  );

  return (
    <div className="rp">
      <div className="rp-monthbar">
        <Button
          variant="ghost"
          aria-label="Mês anterior"
          icon={<ChevronLeft size={18} />}
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
        />
        <h2 className="rp-month">{monthLabel(month)}</h2>
        <Button
          variant="ghost"
          aria-label="Próximo mês"
          icon={<ChevronRight size={18} />}
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
        />
        {canWrite && (
          <Button
            variant="secondary"
            icon={<Settings2 size={16} />}
            onClick={() => setRules(true)}
            style={{ marginLeft: 'auto' }}
          >
            Regras de pagamento
          </Button>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!data || !t ? (
        !error && <Skeleton variant="table" />
      ) : (
        <>
          <div className="dl-kpis">
            <Kpi
              icon={<Bike size={18} />}
              tone="brand"
              label="Ganhos dos entregadores"
              value={brl(t.earned)}
              hint={`${t.delivered} entregas · ${kmLabel(t.distanceM)}`}
            />
            <Kpi
              icon={<Scale size={18} />}
              tone="info"
              label="Custo para a loja"
              value={brl(t.costEstimate)}
              hint={
                balance >= 0
                  ? `Taxas cobradas ${brl(t.deliveryFees)} · sobram ${formatBRL(balance)}`
                  : `Taxas cobradas ${brl(t.deliveryFees)} · faltam ${formatBRL(-balance)}`
              }
            />
            <Kpi
              icon={<Receipt size={18} />}
              tone="success"
              label="Pago no mês"
              value={brl(t.paidNet)}
              hint={
                nonZero(t.paidWithheld)
                  ? `+ ${brl(t.paidWithheld)} retidos a recolher`
                  : 'Sem retenções'
              }
            />
            <Kpi
              icon={<Wallet size={18} />}
              tone="warning"
              label="A pagar agora"
              value={brl(t.pendingNet)}
              hint={
                nonZero(t.pendingGross)
                  ? `Bruto ${brl(t.pendingGross)}, com as retenções estimadas`
                  : 'Tudo acertado'
              }
            />
          </div>

          <Card title="Por entregador" bodyless>
            {!visible?.length ? (
              <EmptyState
                icon={<Bike size={20} />}
                title="Nenhum entregador cadastrado"
                description="Cadastre na aba Entregadores. Os ganhos aparecem aqui conforme as corridas terminam."
              />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="cm-table cp-table">
                  <thead>
                    <tr>
                      <th>Entregador</th>
                      <th className="num">Entregas</th>
                      <th className="num">Km</th>
                      <th className="num">Ganhou no mês</th>
                      <th className="num">Pago no mês</th>
                      <th className="num">A pagar</th>
                      <th aria-label="Ações" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => (
                      <tr key={c.courierId}>
                        <td>
                          <strong>{c.name}</strong>{' '}
                          <Badge tone={c.taxRegime === 'autonomo' ? 'warning' : 'neutral'}>
                            {COURIER_TAX_REGIME_LABELS[c.taxRegime].split(' (')[0]}
                          </Badge>
                          <div className="cm-hint">
                            {c.ownRule ? 'Regra própria: ' : ''}
                            {c.rule}
                          </div>
                        </td>
                        <td className="num">
                          {c.delivered}
                          {c.failed > 0 && <span className="cm-hint"> +{c.failed} falhas</span>}
                        </td>
                        <td className="num">{c.distanceM ? kmLabel(c.distanceM) : '—'}</td>
                        <td className="num">
                          {brl(c.earned)}
                          {nonZero(c.daily) && (
                            <div className="cm-hint">diárias {brl(c.daily)}</div>
                          )}
                        </td>
                        <td className="num">
                          {brl(c.paidNet)}
                          {nonZero(c.paidWithheld) && (
                            <div className="cm-hint">retido {brl(c.paidWithheld)}</div>
                          )}
                        </td>
                        <td className="num">
                          <strong>{brl(c.pendingNet)}</strong>
                          {c.pendingRides > 0 && (
                            <div className="cm-hint">{c.pendingRides} corridas</div>
                          )}
                        </td>
                        <td>
                          {canWrite && (
                            <span className="actions-row" style={{ justifyContent: 'flex-end' }}>
                              <button className="link-btn" onClick={() => setEditing(c)}>
                                ajustar
                              </button>
                              <Button
                                size="sm"
                                disabled={!nonZero(c.pendingGross)}
                                onClick={() => setPaying(c)}
                              >
                                Pagar
                              </Button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Custo com entregadores por dia">
            <DailyCost month={month} days={data.days} />
          </Card>

          <Card title="Pagamentos do mês" bodyless>
            {data.payouts.length === 0 ? (
              <EmptyState
                icon={<Receipt size={20} />}
                title="Nenhum pagamento neste mês"
                description='Use "Pagar" ao lado do entregador para acertar as corridas pendentes.'
              />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="cm-table cp-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Entregador</th>
                      <th>Período</th>
                      <th className="num">Bruto</th>
                      <th className="num">Retido</th>
                      <th className="num">Líquido</th>
                      <th aria-label="Recibo" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.payouts.map((p) => (
                      <tr key={p.id}>
                        <td>{dateTime(p.paidAt)}</td>
                        <td>
                          {p.courierName}{' '}
                          <span className="cm-hint">· {METHOD_LABEL[p.method] ?? p.method}</span>
                        </td>
                        <td>
                          {p.periodFrom ? `${fmtDay(p.periodFrom)} a ` : 'até '}
                          {fmtDay(p.periodTo)} · {p.deliveries} entregas
                        </td>
                        <td className="num">{brl(p.gross)}</td>
                        <td className="num">
                          {formatBRL(toCents(p.inss) + toCents(p.irrf) + toCents(p.iss))}
                        </td>
                        <td className="num">
                          <strong>{brl(p.net)}</strong>
                        </td>
                        <td>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Printer size={14} />}
                            onClick={() => setReceipt(p)}
                          >
                            Recibo
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <TaxNotes settings={data.settings} />
        </>
      )}

      {data && (
        <RulesModal
          open={rules}
          settings={data.settings}
          pending={data.couriers.reduce((n, c) => n + c.pendingRides, 0)}
          onClose={() => setRules(false)}
          onSaved={() => {
            setRules(false);
            void load();
          }}
        />
      )}
      {data && editing && (
        <CourierModal
          line={editing}
          storeRule={data.settings.rule}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {paying && (
        <PayModal
          line={paying}
          onClose={() => setPaying(null)}
          onPaid={(p) => {
            setPaying(null);
            setReceipt(p);
            void load();
          }}
        />
      )}
      <Modal
        open={!!receipt}
        title="Recibo de pagamento ao entregador"
        onClose={() => setReceipt(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReceipt(null)}>
              Fechar
            </Button>
            <Button icon={<Printer size={16} />} onClick={printReceipt}>
              Imprimir
            </Button>
          </>
        }
      >
        {receipt && <ReceiptView ref={receiptRef} p={receipt} />}
      </Modal>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint: string;
  tone: 'brand' | 'success' | 'warning' | 'info';
}) {
  return (
    <div className="dl-kpi" data-tone={tone}>
      <span className="dl-kpi__icon">{icon}</span>
      <span className="dl-kpi__label">{label}</span>
      <strong className="dl-kpi__value">{value}</strong>
      <span className="cm-hint cp-kpi__hint">{hint}</span>
    </div>
  );
}

/** Barras do custo de cada dia do mês (corridas encerradas no dia). */
function DailyCost({ month, days }: { month: string; days: Report['days'] }) {
  const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const max = Math.max(1, ...days.map((d) => toCents(d.cost)));
  if (!days.length) return <p className="cm-hint">Nenhuma corrida encerrada neste mês ainda.</p>;
  return (
    <div className="rp-hours">
      <div className="rp-hours__cols">
        {Array.from({ length: last }, (_, i) => {
          const key = `${month}-${String(i + 1).padStart(2, '0')}`;
          const d = days.find((x) => x.day === key);
          const v = d ? toCents(d.cost) : 0;
          return (
            <span
              key={key}
              className="rp-hours__col"
              data-top={(v === max && v > 0) || undefined}
              title={`${fmtDay(key)}: ${formatBRL(v)}${d ? ` · ${d.deliveries} entregas` : ''}`}
            >
              <span style={{ height: v ? `${Math.max(4, (v / max) * 100)}%` : '0' }} />
              <small>{(i + 1) % 5 === 1 ? i + 1 : ''}</small>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function TaxNotes({ settings }: { settings: Settings }) {
  const tx = settings.taxes;
  return (
    <p className="cm-hint cp-notes">
      <strong>Como calculamos.</strong> Cada corrida guarda o valor da regra no momento em que
      termina ({settings.description}). Km = distância em linha reta da loja ao cliente × 1,3.{' '}
      <strong>MEI</strong>: sem retenção, ele paga o próprio DAS. <strong>Autônomo</strong> (RPA): a
      loja retém INSS de {br(String(tx.inssRate))}% até o teto de {brl(tx.inssCeiling)} no mês
      {tx.withholdIrrf ? ', IRRF pela tabela mensal de 2026 (isento até R$ 5.000)' : ''}
      {tx.issRate ? `, ISS de ${br(String(tx.issRate))}%` : ''}
      {tx.employerRate
        ? ` e paga ${br(String(tx.employerRate))}% de INSS patronal`
        : '; no Simples Nacional não há INSS patronal à parte'}
      . Os retidos vencem no dia 20 do mês seguinte. <strong>CLT</strong>: os encargos vão pela
      folha do contador. Confirme os percentuais com o seu contador.
    </p>
  );
}

// ------------------------------------------------------------------------ regra (form)

interface RuleForm {
  mode: CourierPayMode;
  fixed: string;
  perKm: string;
  kmIncluded: string;
  feePercent: string;
  minPerDelivery: string;
  failedPercent: string;
  dailyRate: string;
}
const ruleToForm = (r: CourierPayRule): RuleForm => ({
  mode: r.mode,
  fixed: br(r.fixed),
  perKm: br(r.perKm),
  kmIncluded: br(String(r.kmIncluded)),
  feePercent: br(String(r.feePercent)),
  minPerDelivery: br(r.minPerDelivery),
  failedPercent: br(String(r.failedPercent)),
  dailyRate: br(r.dailyRate),
});
const num = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
/** Valida o formulário; devolve a regra ou o primeiro erro. */
function formToRule(f: RuleForm): CourierPayRule | string {
  const money = (s: string, label: string) => parseBrlInput(s || '0') ?? `${label}: valor inválido`;
  const pct = (s: string, label: string) => {
    const n = num(s || '0');
    return n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : `${label}: de 0 a 100`;
  };
  const km = num(f.kmIncluded || '0');
  const r = {
    mode: f.mode,
    fixed: money(f.fixed, 'Valor fixo'),
    perKm: money(f.perKm, 'Valor por km'),
    kmIncluded: km >= 0 && km <= 100 ? Math.round(km * 10) / 10 : 'Km incluídos: de 0 a 100',
    feePercent: pct(f.feePercent, '% da taxa'),
    minPerDelivery: money(f.minPerDelivery, 'Mínimo'),
    failedPercent: pct(f.failedPercent, '% quando não entrega'),
    dailyRate: money(f.dailyRate, 'Diária'),
  };
  // Mensagens de erro têm "rótulo: motivo"; valores e o modo nunca têm dois-pontos.
  const bad = Object.values(r).find((v) => typeof v === 'string' && v.includes(':'));
  if (typeof bad === 'string') return bad;
  return r as CourierPayRule;
}

function RuleFields({ f, set }: { f: RuleForm; set(k: keyof RuleForm, v: string): void }) {
  const field = (k: keyof RuleForm) => ({
    value: f[k],
    inputMode: 'decimal' as const,
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
  });
  const rule = formToRule(f);
  return (
    <>
      <SelectField
        label="Como o entregador ganha"
        value={f.mode}
        onChange={(e) => set('mode', e.target.value)}
      >
        {COURIER_PAY_MODES.map((m) => (
          <option key={m} value={m}>
            {COURIER_PAY_MODE_LABELS[m]}
          </option>
        ))}
      </SelectField>
      {(f.mode === 'fixed' || f.mode === 'fixed_plus_km') && (
        <TextField label="Valor fixo por entrega (R$)" {...field('fixed')} />
      )}
      {f.mode === 'fixed_plus_km' && (
        <TextField label="Km já incluídos no fixo" {...field('kmIncluded')} />
      )}
      {(f.mode === 'per_km' || f.mode === 'fixed_plus_km') && (
        <TextField
          label={f.mode === 'per_km' ? 'Valor por km (R$)' : 'Valor por km a mais (R$)'}
          {...field('perKm')}
        />
      )}
      {f.mode === 'fee_percent' && (
        <TextField
          label="% da taxa de entrega"
          hint="100% = o motoboy fica com toda a taxa que o cliente pagou."
          {...field('feePercent')}
        />
      )}
      <TextField
        label="Mínimo por entrega (R$)"
        hint="0 = sem mínimo."
        {...field('minPerDelivery')}
      />
      <TextField
        label="Diária (R$)"
        hint="Fixo por dia trabalhado. 0 = sem diária."
        {...field('dailyRate')}
      />
      <TextField
        label="% pago quando não entrega"
        hint="Cliente ausente, endereço errado… 0 = não paga."
        {...field('failedPercent')}
      />
      <p className="cp-example" aria-live="polite">
        {typeof rule === 'string' ? (
          <span className="cm-error-text">{rule}</span>
        ) : (
          <>
            Exemplo: entrega de 4 km com taxa de R$ 8,00 →{' '}
            <strong>
              {brl(deliveryPay(rule, { fee: '8.00', distanceM: 4000, status: 'delivered' }).amount)}
            </strong>{' '}
            ({describePayRule(rule)}).
          </>
        )}
      </p>
    </>
  );
}

function RulesModal({
  open,
  settings,
  pending,
  onClose,
  onSaved,
}: {
  open: boolean;
  settings: Settings;
  pending: number;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [f, setF] = useState(() => ruleToForm(settings.rule));
  const [tx, setTx] = useState(() => ({
    inssRate: br(String(settings.taxes.inssRate)),
    inssCeiling: br(settings.taxes.inssCeiling),
    withholdIrrf: settings.taxes.withholdIrrf,
    issRate: br(String(settings.taxes.issRate)),
    employerRate: br(String(settings.taxes.employerRate)),
  }));
  const [recalc, setRecalc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setF(ruleToForm(settings.rule));
    setError(null);
  }, [open, settings]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const rule = formToRule(f);
    if (typeof rule === 'string') return setError(rule);
    const p = (s: string) => Math.round(num(s || '0') * 100) / 100;
    const ceiling = parseBrlInput(tx.inssCeiling);
    const taxes = {
      inssRate: p(tx.inssRate),
      inssCeiling: ceiling ?? '',
      withholdIrrf: tx.withholdIrrf,
      issRate: p(tx.issRate),
      employerRate: p(tx.employerRate),
    };
    if (!ceiling) return setError('Teto do INSS: valor inválido');
    if ([taxes.inssRate, taxes.issRate, taxes.employerRate].some((x) => !(x >= 0 && x <= 100)))
      return setError('Percentuais de 0 a 100');
    setBusy(true);
    try {
      await api('/courier-pay/settings', { method: 'PUT', json: { rule, taxes } });
      if (recalc && pending > 0)
        await api('/courier-pay/recalculate', { method: 'POST', json: {} });
      toast('Regras salvas', 'success');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      title="Regras de pagamento dos entregadores"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button type="submit" form="cp-rules" loading={busy}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="cp-rules" className="cm-form" onSubmit={submit}>
        {error && <Alert tone="danger">{error}</Alert>}
        <h3 className="cm-form__section">Quanto ganha por entrega</h3>
        <RuleFields f={f} set={(k, v) => setF((x) => ({ ...x, [k]: v }))} />
        <h3 className="cm-form__section">Impostos do autônomo (sem CNPJ)</h3>
        <TextField
          label="INSS retido (%)"
          hint="Contribuinte individual: 11%."
          inputMode="decimal"
          value={tx.inssRate}
          onChange={(e) => setTx((x) => ({ ...x, inssRate: e.target.value }))}
        />
        <TextField
          label="Teto do INSS no mês (R$)"
          hint="2026: R$ 8.475,55."
          inputMode="decimal"
          value={tx.inssCeiling}
          onChange={(e) => setTx((x) => ({ ...x, inssCeiling: e.target.value }))}
        />
        <TextField
          label="ISS retido (%)"
          hint="Só se a prefeitura exige. 0 = não retém."
          inputMode="decimal"
          value={tx.issRate}
          onChange={(e) => setTx((x) => ({ ...x, issRate: e.target.value }))}
        />
        <TextField
          label="INSS patronal (%)"
          hint="20% fora do Simples Nacional; 0 no Simples."
          inputMode="decimal"
          value={tx.employerRate}
          onChange={(e) => setTx((x) => ({ ...x, employerRate: e.target.value }))}
        />
        <CheckField
          label="Reter IRRF"
          description="Tabela mensal de 2026: isento até R$ 5.000 no mês, redução até R$ 7.350."
          checked={tx.withholdIrrf}
          onChange={(v) => setTx((x) => ({ ...x, withholdIrrf: v }))}
        />
        {pending > 0 && (
          <CheckField
            label={`Aplicar às ${pending} corridas ainda não pagas`}
            description="Recalcula as corridas pendentes com a regra nova. As já pagas não mudam."
            checked={recalc}
            onChange={setRecalc}
          />
        )}
      </form>
    </Modal>
  );
}

function CourierModal({
  line,
  storeRule,
  onClose,
  onSaved,
}: {
  line: Line;
  storeRule: CourierPayRule;
  onClose(): void;
  onSaved(): void;
}) {
  const [regime, setRegime] = useState<CourierTaxRegime>(line.taxRegime);
  const [pix, setPix] = useState(line.pixKey ?? '');
  const [own, setOwn] = useState(line.ownRule);
  const [f, setF] = useState(() => ruleToForm(line.payRule ?? storeRule));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const rule = own ? formToRule(f) : null;
    if (typeof rule === 'string') return setError(rule);
    setBusy(true);
    try {
      await api(`/courier-pay/couriers/${line.courierId}`, {
        method: 'PATCH',
        json: { taxRegime: regime, pixKey: pix.trim() || null, payRule: rule },
      });
      toast('Entregador atualizado', 'success');
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
      size="lg"
      title={`Pagamento de ${line.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button type="submit" form="cp-courier" loading={busy}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="cp-courier" className="cm-form" onSubmit={submit}>
        {error && <Alert tone="danger">{error}</Alert>}
        <SelectField
          label="Regime"
          value={regime}
          onChange={(e) => setRegime(e.target.value as CourierTaxRegime)}
        >
          {COURIER_TAX_REGIMES.map((r) => (
            <option key={r} value={r}>
              {COURIER_TAX_REGIME_LABELS[r]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Chave Pix"
          maxLength={140}
          value={pix}
          onChange={(e) => setPix(e.target.value)}
        />
        <CheckField
          label="Regra própria para este entregador"
          description={`Sem marcar, vale a regra da loja: ${describePayRule(storeRule)}.`}
          checked={own}
          onChange={setOwn}
        />
        {own && <RuleFields f={f} set={(k, v) => setF((x) => ({ ...x, [k]: v }))} />}
      </form>
    </Modal>
  );
}

function PayModal({
  line,
  onClose,
  onPaid,
}: {
  line: Line;
  onClose(): void;
  onPaid(p: Payout): void;
}) {
  const [until, setUntil] = useState(todayIso);
  const [kind, setKind] = useState<'bonus' | 'discount'>('bonus');
  const [adj, setAdj] = useState('');
  const [method, setMethod] = useState('pix');
  const [notes, setNotes] = useState('');
  const [toFinance, setToFinance] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = adj.trim() ? parseBrlInput(adj) : '0';
  const adjustments = amount && kind === 'discount' && amount !== '0' ? `-${amount}` : amount;

  useEffect(() => {
    if (!adjustments || !until) return;
    let stop = false;
    const id = window.setTimeout(() => {
      api<Draft>('/courier-pay/preview', {
        method: 'POST',
        json: { courierId: line.courierId, until, adjustments },
      })
        .then((d) => !stop && (setDraft(d), setError(null)))
        .catch((e) => !stop && setError((e as Error).message));
    }, 250);
    return () => {
      stop = true;
      window.clearTimeout(id);
    };
  }, [line.courierId, until, adjustments]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!adjustments) return setError('Valor do ajuste inválido');
    setBusy(true);
    try {
      const p = await api<Draft & { id: string }>('/courier-pay/payouts', {
        method: 'POST',
        json: {
          courierId: line.courierId,
          until,
          adjustments,
          method,
          notes: notes.trim() || null,
          toFinance,
        },
      });
      onPaid({
        ...p,
        courierId: line.courierId,
        method,
        notes: notes.trim() || null,
        paidAt: new Date().toISOString(),
        inFinance: toFinance,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={`Pagar ${line.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="cp-pay"
            loading={busy}
            disabled={!draft || toCents(draft.gross) <= 0}
          >
            {draft ? `Pagar ${brl(draft.net)}` : 'Pagar'}
          </Button>
        </>
      }
    >
      <form id="cp-pay" className="cm-form" onSubmit={submit}>
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField
          label="Corridas encerradas até"
          type="date"
          value={until}
          max={todayIso()}
          onChange={(e) => setUntil(e.target.value)}
        />
        <SelectField
          label="Forma de pagamento"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          {Object.entries(METHOD_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Ajuste"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'bonus' | 'discount')}
        >
          <option value="bonus">Bônus / gorjeta (+)</option>
          <option value="discount">Vale / desconto (−)</option>
        </SelectField>
        <TextField
          label="Valor do ajuste (R$)"
          inputMode="decimal"
          placeholder="0,00"
          value={adj}
          error={adj.trim() && !amount ? 'Valor inválido' : undefined}
          onChange={(e) => setAdj(e.target.value)}
        />
        <TextField
          label="Observação"
          maxLength={300}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <CheckField
          label="Lançar no Financeiro"
          description="O pagamento entra como despesa paga; as retenções, como conta a pagar no dia 20 do mês seguinte."
          checked={toFinance}
          onChange={setToFinance}
        />
        {draft && <Breakdown d={draft} />}
        {line.pixKey && (
          <p className="cm-hint">
            Chave Pix: <strong>{line.pixKey}</strong>
          </p>
        )}
      </form>
    </Modal>
  );
}

/** Conta do repasse, linha a linha (mesma no pagamento e no recibo). */
function Breakdown({
  d,
}: {
  d: Pick<
    Draft,
    | 'deliveries'
    | 'daysWorked'
    | 'distanceM'
    | 'rides'
    | 'daily'
    | 'adjustments'
    | 'gross'
    | 'inss'
    | 'irrf'
    | 'iss'
    | 'net'
    | 'employer'
    | 'taxRegime'
  > & { failed?: number };
}) {
  const row = (label: string, v: string, sign = '') =>
    nonZero(v) && (
      <div>
        <dt>{label}</dt>
        <dd>
          {sign}
          {brl(v.replace('-', ''))}
        </dd>
      </div>
    );
  const adj = toCents(d.adjustments);
  return (
    <dl className="cp-breakdown">
      <div>
        <dt>
          Corridas ({d.deliveries} entregas{d.failed ? ` + ${d.failed} não entregues` : ''}
          {d.distanceM ? ` · ${kmLabel(d.distanceM)}` : ''})
        </dt>
        <dd>{brl(d.rides)}</dd>
      </div>
      {row(`Diárias (${d.daysWorked} dias)`, d.daily)}
      {adj !== 0 &&
        row(adj > 0 ? 'Bônus' : 'Vale / desconto', d.adjustments, adj > 0 ? '+ ' : '− ')}
      <div className="cp-breakdown__total">
        <dt>Bruto</dt>
        <dd>{brl(d.gross)}</dd>
      </div>
      {row('INSS retido', d.inss, '− ')}
      {row('IRRF retido', d.irrf, '− ')}
      {row('ISS retido', d.iss, '− ')}
      <div className="cp-breakdown__total">
        <dt>Líquido para o entregador</dt>
        <dd>{brl(d.net)}</dd>
      </div>
      {nonZero(d.employer) && (
        <div className="cm-hint">
          <dt>INSS patronal (custo da loja, não sai do entregador)</dt>
          <dd>{brl(d.employer)}</dd>
        </div>
      )}
      {d.taxRegime !== 'autonomo' && (
        <p className="cm-hint">
          {d.taxRegime === 'mei'
            ? 'MEI: sem retenção. Peça a nota fiscal de serviço do entregador.'
            : 'CLT: o valor é comissão; descontos e encargos vão pela folha.'}
        </p>
      )}
    </dl>
  );
}

/** Visual do recibo na folha impressa (o iframe não carrega o CSS do app). */
export const RECEIPT_PRINT_CSS = `
.pr-head{border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:20px}
.pr-head p{margin:0;font-weight:600;color:#444}
.pr-head h1{margin:2px 0 0;font-size:20px}
.cp-receipt{max-width:640px}
.cp-receipt p{margin:0 0 12px}
.cm-hint{color:#555;font-size:12px}
.cp-breakdown{margin:16px 0 0;padding:6px 12px;border:1px solid #bbb;border-radius:6px}
.cp-breakdown>div{display:flex;justify-content:space-between;gap:12px;padding:6px 0}
.cp-breakdown>div+div{border-top:1px solid #e3e3e3}
.cp-breakdown dt{margin:0}
.cp-breakdown dd{margin:0;white-space:nowrap;font-variant-numeric:tabular-nums}
.cp-breakdown__total{font-weight:700}
.cp-breakdown>p{margin:6px 0 0}
.cp-receipt__sign{margin-top:72px;padding-top:6px;border-top:1px solid #111;width:320px;font-size:13px}
`;

export function ReceiptView({ p, ref }: { p: Payout; ref?: Ref<HTMLDivElement> }) {
  return (
    <div className="cp-receipt" ref={ref}>
      <p style={{ marginTop: 0 }}>
        Recebi o valor líquido de <strong>{brl(p.net)}</strong> (
        {METHOD_LABEL[p.method] ?? p.method}) referente às entregas de{' '}
        {p.periodFrom
          ? `${fmtDay(p.periodFrom)} a ${fmtDay(p.periodTo)}`
          : `até ${fmtDay(p.periodTo)}`}
        .
      </p>
      <p className="cm-hint">
        {p.courierName} · {COURIER_TAX_REGIME_LABELS[p.taxRegime]} · pago em {dateTime(p.paidAt)}
        {p.notes && ` · ${p.notes}`}
      </p>
      <Breakdown d={p} />
      <div className="cp-receipt__sign">
        <span>Assinatura do entregador</span>
      </div>
    </div>
  );
}
