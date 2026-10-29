import {
  CFOPS,
  CST_IBS_CBS,
  CST_IPI,
  CST_PIS_COFINS,
  IBS_CBS_CLASSES,
  IBS_CBS_TEST_RATES,
  ICMS_ORIGINS,
  icmsCodesFor,
  icmsMatchesRegime,
  interstateCfop,
  type CodeList,
} from '@comandou/shared';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useCan } from '../../app/auth';
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
} from '../../design-system';
import { CheckField, SelectField } from '../../features/forms';
import { api } from '../../lib/api';
import type { FiscalRule, FiscalRulesResponse, FiscalSettings } from '../../lib/types';
import { FiscalHead } from './common';

const SCOPE_LABEL: Record<FiscalRule['scope'], string> = {
  all: 'NFC-e e NF-e',
  nfce: 'Só NFC-e',
  nfe: 'Só NF-e',
};

/** Estado do formulário: tudo texto, como digitado. */
type Form = Record<
  | 'code'
  | 'name'
  | 'scope'
  | 'cfop'
  | 'cfopInterstate'
  | 'icmsCst'
  | 'icmsOrigin'
  | 'icmsRate'
  | 'icmsBaseReduction'
  | 'pisCst'
  | 'pisRate'
  | 'cofinsCst'
  | 'cofinsRate'
  | 'ipiCst'
  | 'ipiRate'
  | 'ibsCbsCst'
  | 'ibsCbsClass'
  | 'cbsRate'
  | 'ibsUfRate'
  | 'ibsMunRate'
  | 'benefitCode'
  | 'approxTaxRate'
  | 'notes',
  string
> & { active: boolean; isDefault: boolean };

const pct = (v: string | null) => (v ? v.replace('.', ',') : '');
const toForm = (r: FiscalRule | null, regime: number | null): Form => ({
  code: r?.code ?? '',
  name: r?.name ?? '',
  scope: r?.scope ?? 'all',
  active: r?.active ?? true,
  isDefault: r?.isDefault ?? false,
  cfop: r?.cfop ?? '5102',
  cfopInterstate: r?.cfopInterstate ?? '',
  icmsCst: r?.icmsCst ?? (regime === 3 ? '00' : '102'),
  icmsOrigin: String(r?.icmsOrigin ?? 0),
  icmsRate: pct(r?.icmsRate ?? null),
  icmsBaseReduction: pct(r?.icmsBaseReduction ?? null),
  pisCst: r?.pisCst ?? (regime === 3 ? '01' : '49'),
  pisRate: pct(r?.pisRate ?? null),
  cofinsCst: r?.cofinsCst ?? (regime === 3 ? '01' : '49'),
  cofinsRate: pct(r?.cofinsRate ?? null),
  ipiCst: r?.ipiCst ?? '',
  ipiRate: pct(r?.ipiRate ?? null),
  ibsCbsCst: r?.ibsCbsCst ?? '',
  ibsCbsClass: r?.ibsCbsClass ?? '',
  cbsRate: pct(r?.cbsRate ?? null),
  ibsUfRate: pct(r?.ibsUfRate ?? null),
  ibsMunRate: pct(r?.ibsMunRate ?? null),
  benefitCode: r?.benefitCode ?? '',
  approxTaxRate: pct(r?.approxTaxRate ?? null),
  notes: r?.notes ?? '',
});
const n = (v: string) => (v.trim() ? v.trim().replace(',', '.') : null);
const fromForm = (f: Form) => ({
  code: f.code.trim() || null,
  name: f.name.trim(),
  scope: f.scope,
  active: f.active,
  isDefault: f.isDefault,
  cfop: f.cfop,
  cfopInterstate: f.cfopInterstate || null,
  icmsCst: f.icmsCst,
  icmsOrigin: Number(f.icmsOrigin),
  icmsRate: n(f.icmsRate),
  icmsBaseReduction: n(f.icmsBaseReduction),
  pisCst: f.pisCst,
  pisRate: n(f.pisRate),
  cofinsCst: f.cofinsCst,
  cofinsRate: n(f.cofinsRate),
  ipiCst: f.ipiCst || null,
  ipiRate: n(f.ipiRate),
  ibsCbsCst: f.ibsCbsCst || null,
  ibsCbsClass: f.ibsCbsClass || null,
  cbsRate: n(f.cbsRate),
  ibsUfRate: n(f.ibsUfRate),
  ibsMunRate: n(f.ibsMunRate),
  benefitCode: f.benefitCode.trim() || null,
  approxTaxRate: n(f.approxTaxRate),
  notes: f.notes.trim() || null,
});

function Options({ list, empty }: { list: CodeList; empty?: string }) {
  return (
    <>
      {empty !== undefined && <option value="">{empty}</option>}
      {list.map(([code, label]) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </>
  );
}

/** Padrões fiscais: a tributação de cada item (CFOP, ICMS, PIS/COFINS, IPI, IBS/CBS). */
export function RulesSection() {
  const toast = useToast();
  const canManage = useCan('fiscal:manage');
  const [data, setData] = useState<FiscalRulesResponse | null>(null);
  const [regime, setRegime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FiscalRule | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<FiscalRulesResponse>('/fiscal/rules'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    api<FiscalSettings>('/fiscal/settings')
      .then((s) => setRegime(s.regime))
      .catch(() => undefined);
  }, [load]);

  async function suggested() {
    setBusy(true);
    try {
      const r = await api<{ created: number }>('/fiscal/rules/suggested', {
        method: 'POST',
        json: {},
      });
      toast(
        r.created ? `${r.created} padrões criados` : 'Os padrões sugeridos já existem',
        'success',
      );
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  const rules = data?.rules ?? [];
  const byId = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
  const hasDefault = rules.some((r) => r.isDefault && r.active);

  return (
    <div className="fi-page">
      <FiscalHead
        title="Padrões fiscais"
        error={error}
        actions={
          canManage && (
            <>
              <Button
                variant="ghost"
                icon={<Sparkles size={16} />}
                loading={busy}
                onClick={suggested}
              >
                Criar padrões sugeridos
              </Button>
              <Button icon={<Plus size={16} />} onClick={() => setEditing('new')}>
                Novo padrão
              </Button>
            </>
          )
        }
      >
        Cada item da nota usa um padrão: o escolhido no item do cardápio, senão o ligado ao NCM do
        item, senão o padrão da empresa. Confirme os códigos com a sua contabilidade.
      </FiscalHead>

      {data === null ? (
        <Spinner />
      ) : (
        <>
          {rules.length > 0 && !hasDefault && (
            <Alert tone="warning">
              Nenhum padrão está marcado como padrão da empresa. Os itens sem padrão próprio e sem
              NCM ligado ficam de fora e a nota não sai. Marque um padrão como &quot;padrão da
              empresa&quot;.
            </Alert>
          )}
          <Card bodyless>
            {rules.length === 0 ? (
              <EmptyState
                icon={<Sparkles size={20} />}
                title="Nenhum padrão fiscal ainda"
                description={
                  'Comece pelos padrões sugeridos para o seu regime (comida, bebida com ST, revenda) e ajuste com a contabilidade. ' +
                  'Enquanto não houver padrão, as notas usam os códigos de reserva da Configuração.'
                }
              />
            ) : (
              <div className="fi-table-wrap">
                <table className="cm-table fi-table">
                  <thead>
                    <tr>
                      <th>Padrão</th>
                      <th>Vale para</th>
                      <th>CFOP</th>
                      <th>ICMS</th>
                      <th>PIS/COFINS</th>
                      <th className="cm-num">Itens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r) => (
                      <tr
                        key={r.id}
                        className="fi-row"
                        tabIndex={0}
                        onClick={() => canManage && setEditing(r)}
                        onKeyDown={(e) => e.key === 'Enter' && canManage && setEditing(r)}
                      >
                        <td>
                          <strong>{r.name}</strong>
                          <div className="fi-badges">
                            <span className="cm-hint">{r.code}</span>
                            {r.isDefault && <Badge tone="info">padrão da empresa</Badge>}
                            {!r.active && <Badge>inativo</Badge>}
                            {regime !== null && !icmsMatchesRegime(r.icmsCst, regime) && (
                              <Badge tone="danger">ICMS não combina com o regime</Badge>
                            )}
                          </div>
                        </td>
                        <td>{SCOPE_LABEL[r.scope]}</td>
                        <td>
                          {r.cfop}
                          {r.cfopInterstate && (
                            <span className="cm-hint"> · fora do estado {r.cfopInterstate}</span>
                          )}
                        </td>
                        <td>
                          {r.icmsCst}
                          {r.icmsRate && <span className="cm-hint"> · {pct(r.icmsRate)}%</span>}
                        </td>
                        <td>
                          {r.pisCst}/{r.cofinsCst}
                        </td>
                        <td className="cm-num">
                          {r.products ?? 0}
                          {!!r.ncms?.length && <div className="cm-hint">+{r.ncms.length} NCM</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {rules.length > 0 && (
            <NcmLinks data={data} byId={byId} canManage={canManage} onChanged={load} />
          )}

          {data.uncovered.length > 0 && (
            <Card title={`Itens sem padrão (${data.uncovered.length})`}>
              <p className="cm-hint" style={{ marginTop: 0 }}>
                Estes itens não têm padrão próprio, nem NCM ligado, e não há padrão da empresa.
                Escolha o padrão no cadastro do item, em <Link to="/cardapio">Cardápio</Link>, ou
                ligue o NCM acima.
              </p>
              <ul className="fi-list">
                {data.uncovered.slice(0, 30).map((p) => (
                  <li key={p.id}>
                    {p.name}
                    <span className="cm-hint"> · NCM {p.ncm ?? 'sem NCM'}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {editing && (
        <RuleEditor
          rule={editing === 'new' ? null : editing}
          regime={regime}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

/** Ligação NCM → padrão: todo item com aquele NCM (e sem padrão próprio) usa o padrão. */
function NcmLinks({
  data,
  byId,
  canManage,
  onChanged,
}: {
  data: FiscalRulesResponse;
  byId: Map<string, FiscalRule>;
  canManage: boolean;
  onChanged(): void;
}) {
  const toast = useToast();
  const [ncm, setNcm] = useState('');
  const [ruleId, setRuleId] = useState(data.rules[0]?.id ?? '');
  const [hints, setHints] = useState<{ code: string; description: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const digits = ncm.replace(/\D/g, '');

  useEffect(() => {
    const term = ncm.trim();
    if (term.length < 2) return setHints([]);
    const t = setTimeout(() => {
      api<{ code: string; description: string }[]>(`/fiscal/ncm?q=${encodeURIComponent(term)}`)
        .then(setHints)
        .catch(() => setHints([]));
    }, 300);
    return () => clearTimeout(t);
  }, [ncm]);

  async function link(code: string, id: string | null) {
    setBusy(true);
    try {
      await api(`/fiscal/ncm-rules/${code}`, { method: 'PUT', json: { ruleId: id } });
      toast(id ? 'NCM ligado ao padrão' : 'Ligação removida', 'success');
      setNcm('');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Padrão por NCM">
      <p className="cm-hint" style={{ marginTop: 0 }}>
        Útil para bebidas: ligue o NCM das bebidas com substituição tributária a um padrão e todos
        os itens com esse NCM seguem a mesma regra, sem abrir item por item.
      </p>
      {data.links.length > 0 && (
        <ul className="fi-list fi-links">
          {data.links.map((l) => (
            <li key={l.ncm}>
              <strong className="mono-break">{l.ncm}</strong>
              <span>→ {byId.get(l.ruleId)?.name ?? 'padrão removido'}</span>
              <span className="cm-hint">{l.products} itens</span>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remover ligação do NCM ${l.ncm}`}
                  icon={<Trash2 size={14} />}
                  disabled={busy}
                  onClick={() => void link(l.ncm, null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form
          className="form-grid"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void link(digits, ruleId);
          }}
        >
          <TextField
            label="NCM"
            inputMode="numeric"
            list="fi-ncm-hints"
            value={ncm}
            onChange={(e) => setNcm(e.target.value)}
            placeholder="Código ou nome, ex.: refrigerante"
            error={
              digits && digits.length !== 8 && !/[a-z]/i.test(ncm) ? 'NCM com 8 dígitos' : undefined
            }
          />
          <datalist id="fi-ncm-hints">
            {hints.map((h) => (
              <option key={h.code} value={h.code}>
                {h.description}
              </option>
            ))}
          </datalist>
          <SelectField label="Padrão" value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
            {data.rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
          <div style={{ alignSelf: 'end' }}>
            <Button type="submit" loading={busy} disabled={digits.length !== 8 || !ruleId}>
              Ligar
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function RuleEditor({
  rule,
  regime,
  onClose,
  onSaved,
}: {
  rule: FiscalRule | null;
  regime: number | null;
  onClose(): void;
  onSaved(): void;
}) {
  const toast = useToast();
  const [f, setF] = useState<Form>(() => toForm(rule, regime));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const icmsList = icmsCodesFor(regime);
  const regimeMismatch = regime !== null && !icmsMatchesRegime(f.icmsCst, regime);
  const withRate = ['00', '10', '20', '51', '70', '90', '101', '201', '900'].includes(f.icmsCst);
  const pisWithRate = ['01', '02'].includes(f.pisCst);
  const cofinsWithRate = ['01', '02'].includes(f.cofinsCst);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(rule ? `/fiscal/rules/${rule.id}` : '/fiscal/rules', {
        method: rule ? 'PATCH' : 'POST',
        json: fromForm(f),
      });
      toast('Padrão salvo', 'success');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!rule) return;
    setBusy(true);
    try {
      await api(`/fiscal/rules/${rule.id}`, { method: 'DELETE' });
      toast('Padrão apagado', 'success');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={rule ? `Padrão ${rule.code}` : 'Novo padrão fiscal'}
      onClose={onClose}
      footer={
        <>
          {rule &&
            (confirmDelete ? (
              <Button variant="danger" loading={busy} onClick={remove}>
                Confirmar: apagar
              </Button>
            ) : (
              <Button
                variant="ghost"
                icon={<Trash2 size={16} />}
                onClick={() => setConfirmDelete(true)}
              >
                Apagar
              </Button>
            ))}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button
            type="submit"
            form="fi-rule-form"
            loading={busy}
            disabled={!f.name.trim() || f.cfop.length !== 4}
          >
            Salvar
          </Button>
        </>
      }
    >
      <form id="fi-rule-form" className="fi-form" onSubmit={save}>
        {confirmDelete && rule && (
          <Alert tone="warning">
            Os {rule.products ?? 0} itens com este padrão passam a usar o padrão do NCM ou o da
            empresa.
          </Alert>
        )}
        <fieldset className="fi-fieldset">
          <legend>Geral</legend>
          <div className="form-grid">
            <TextField
              label="Nome"
              value={f.name}
              maxLength={80}
              onChange={(e) => set('name', e.target.value)}
            />
            <TextField
              label="Código"
              value={f.code}
              maxLength={20}
              placeholder="Automático"
              onChange={(e) => set('code', e.target.value.toUpperCase())}
            />
            <SelectField
              label="Vale para"
              value={f.scope}
              onChange={(e) => set('scope', e.target.value)}
            >
              <option value="all">NFC-e e NF-e</option>
              <option value="nfce">Só NFC-e</option>
              <option value="nfe">Só NF-e</option>
            </SelectField>
          </div>
          <div className="fi-checks">
            <CheckField
              label="Padrão da empresa"
              description="Usado nos itens sem padrão próprio e sem NCM ligado."
              checked={f.isDefault}
              onChange={(v) => set('isDefault', v)}
            />
            <CheckField label="Ativo" checked={f.active} onChange={(v) => set('active', v)} />
          </div>
        </fieldset>

        <fieldset className="fi-fieldset">
          <legend>Operação e ICMS</legend>
          <div className="form-grid">
            <TextField
              label="CFOP"
              inputMode="numeric"
              list="fi-cfops"
              maxLength={4}
              value={f.cfop}
              onChange={(e) => set('cfop', e.target.value.replace(/\D/g, ''))}
              hint={CFOPS.find(([c]) => c === f.cfop)?.[1].split(' · ')[1]}
            />
            <TextField
              label="CFOP fora do estado (NF-e)"
              inputMode="numeric"
              maxLength={4}
              value={f.cfopInterstate}
              placeholder={f.cfop.length === 4 ? interstateCfop(f.cfop) : ''}
              onChange={(e) => set('cfopInterstate', e.target.value.replace(/\D/g, ''))}
              hint="Vazio: troca o 5 inicial por 6"
            />
            <datalist id="fi-cfops">
              {CFOPS.map(([c, l]) => (
                <option key={c} value={c}>
                  {l}
                </option>
              ))}
            </datalist>
            <SelectField
              label={regime === 3 ? 'CST do ICMS' : 'CSOSN'}
              value={f.icmsCst}
              onChange={(e) => set('icmsCst', e.target.value)}
            >
              {!icmsList.some(([c]) => c === f.icmsCst) && (
                <option value={f.icmsCst}>{f.icmsCst}</option>
              )}
              <Options list={icmsList} />
            </SelectField>
            <SelectField
              label="Origem"
              value={f.icmsOrigin}
              onChange={(e) => set('icmsOrigin', e.target.value)}
            >
              <Options list={ICMS_ORIGINS} />
            </SelectField>
            {withRate && (
              <>
                <TextField
                  label="Alíquota do ICMS (%)"
                  inputMode="decimal"
                  value={f.icmsRate}
                  onChange={(e) => set('icmsRate', e.target.value)}
                />
                <TextField
                  label="Redução da base (%)"
                  inputMode="decimal"
                  value={f.icmsBaseReduction}
                  onChange={(e) => set('icmsBaseReduction', e.target.value)}
                />
              </>
            )}
            <TextField
              label="Código de benefício (cBenef)"
              value={f.benefitCode}
              maxLength={10}
              onChange={(e) => set('benefitCode', e.target.value.toUpperCase())}
              hint="Só nos estados que exigem (ex.: PR, RJ, RS) com isenção ou redução"
            />
          </div>
          {regimeMismatch && (
            <Alert tone="danger">
              {regime === 3
                ? 'Empresa no regime normal usa CST de 2 dígitos, não CSOSN.'
                : 'Empresa do Simples Nacional usa CSOSN de 3 dígitos, não CST.'}{' '}
              A SEFAZ recusa a nota.
            </Alert>
          )}
        </fieldset>

        <fieldset className="fi-fieldset">
          <legend>PIS e COFINS</legend>
          <div className="form-grid">
            <SelectField
              label="CST do PIS"
              value={f.pisCst}
              onChange={(e) => set('pisCst', e.target.value)}
            >
              <Options list={CST_PIS_COFINS} />
            </SelectField>
            {pisWithRate && (
              <TextField
                label="Alíquota do PIS (%)"
                inputMode="decimal"
                value={f.pisRate}
                onChange={(e) => set('pisRate', e.target.value)}
                placeholder="0,65"
              />
            )}
            <SelectField
              label="CST da COFINS"
              value={f.cofinsCst}
              onChange={(e) => set('cofinsCst', e.target.value)}
            >
              <Options list={CST_PIS_COFINS} />
            </SelectField>
            {cofinsWithRate && (
              <TextField
                label="Alíquota da COFINS (%)"
                inputMode="decimal"
                value={f.cofinsRate}
                onChange={(e) => set('cofinsRate', e.target.value)}
                placeholder="3"
              />
            )}
          </div>
        </fieldset>

        {f.scope !== 'nfce' && (
          <fieldset className="fi-fieldset">
            <legend>IPI (só NF-e, para indústria)</legend>
            <div className="form-grid">
              <SelectField
                label="CST do IPI"
                value={f.ipiCst}
                onChange={(e) => set('ipiCst', e.target.value)}
              >
                <Options list={CST_IPI} empty="Sem IPI" />
              </SelectField>
              {f.ipiCst && (
                <TextField
                  label="Alíquota do IPI (%)"
                  inputMode="decimal"
                  value={f.ipiRate}
                  onChange={(e) => set('ipiRate', e.target.value)}
                />
              )}
            </div>
          </fieldset>
        )}

        <fieldset className="fi-fieldset">
          <legend>Reforma tributária (IBS e CBS)</legend>
          <p className="cm-hint" style={{ marginTop: 0 }}>
            Em 2026 os campos são de teste, sem recolhimento. Deixe vazio se a sua contabilidade
            ainda não orientou.
          </p>
          <div className="form-grid">
            <SelectField
              label="CST do IBS/CBS"
              value={f.ibsCbsCst}
              onChange={(e) => set('ibsCbsCst', e.target.value)}
            >
              <Options list={CST_IBS_CBS} empty="Não informar" />
            </SelectField>
            {f.ibsCbsCst && (
              <>
                <SelectField
                  label="Classificação tributária"
                  value={f.ibsCbsClass}
                  onChange={(e) => set('ibsCbsClass', e.target.value)}
                >
                  {f.ibsCbsClass && !IBS_CBS_CLASSES.some(([c]) => c === f.ibsCbsClass) && (
                    <option value={f.ibsCbsClass}>{f.ibsCbsClass}</option>
                  )}
                  <Options list={IBS_CBS_CLASSES} empty="Escolha" />
                </SelectField>
                <TextField
                  label="CBS (%)"
                  inputMode="decimal"
                  value={f.cbsRate}
                  onChange={(e) => set('cbsRate', e.target.value)}
                />
                <TextField
                  label="IBS estadual (%)"
                  inputMode="decimal"
                  value={f.ibsUfRate}
                  onChange={(e) => set('ibsUfRate', e.target.value)}
                />
                <TextField
                  label="IBS municipal (%)"
                  inputMode="decimal"
                  value={f.ibsMunRate}
                  onChange={(e) => set('ibsMunRate', e.target.value)}
                />
                <div style={{ alignSelf: 'end' }}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setF((x) => ({
                        ...x,
                        cbsRate: pct(IBS_CBS_TEST_RATES.cbs),
                        ibsUfRate: pct(IBS_CBS_TEST_RATES.ibsUf),
                        ibsMunRate: pct(IBS_CBS_TEST_RATES.ibsMun),
                      }))
                    }
                  >
                    Usar alíquotas de teste
                  </Button>
                </div>
              </>
            )}
          </div>
        </fieldset>

        <fieldset className="fi-fieldset">
          <legend>Outros</legend>
          <div className="form-grid">
            <TextField
              label="Tributos aproximados (%)"
              inputMode="decimal"
              value={f.approxTaxRate}
              onChange={(e) => set('approxTaxRate', e.target.value)}
              hint="Lei da transparência: valor aproximado de tributos no cupom"
            />
            <TextField
              label="Anotação"
              value={f.notes}
              maxLength={500}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
        </fieldset>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Modal>
  );
}
