import { toCents } from '@comandou/shared';
import { Gift, KeyRound, Pencil, Plus, Stamp, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
import { api, Product } from '../lib/api';
import { brl, parseBrlInput } from '../lib/money';
import { CustomerPinModal } from './CustomerPin';
import { SelectField } from './forms';
import { ItemPointsCard, LevelsCard, ReferralCard } from './LoyaltyExtras';
import './loyalty-panel.css';

export interface LoyaltySettings {
  enabled: boolean;
  mode: 'points' | 'stamps';
  pointsPerReal: string;
  stampMinOrder: string;
  expiryDays: number | null;
  countStaffOrders: boolean;
  levelWindowDays: number | null;
  referralPoints: number;
  referralFriendPoints: number;
  showItemPoints: boolean;
}
export interface LoyaltyReward {
  id: string;
  name: string;
  cost: number;
  kind: 'discount' | 'product';
  amount: string | null;
  productId: string | null;
  productName: string | null;
  productPrice: string | null;
  active: boolean;
  position: number;
}
interface LoyaltyReport {
  days: number;
  members: number;
  outstanding: number;
  earned: number;
  redeemed: number;
  redemptions: number;
  discount: string;
  expired: number;
  orders: number;
  revenue: string;
  customers: number;
  top: {
    id: string;
    name: string;
    phone: string;
    balance: number;
    earned: number;
    redeemed: number;
    lastAt: string;
  }[];
}

const unitOf = (mode: LoyaltySettings['mode'], n = 2) =>
  mode === 'stamps' ? (n === 1 ? 'carimbo' : 'carimbos') : n === 1 ? 'ponto' : 'pontos';
const int = (n: number) => n.toLocaleString('pt-BR');
/** "12,50" ou "12.5" → "12.50" (vazio = null). */
const moneyIn = (v: string) => {
  if (!v.trim()) return null;
  return parseBrlInput(v) ?? undefined;
};
const moneyOut = (v: string | null) => (v ? v.replace('.', ',') : '');

/** Frase da regra, igual à que o cliente lê no cardápio. */
export function ruleText(s: Pick<LoyaltySettings, 'mode' | 'pointsPerReal' | 'stampMinOrder'>) {
  if (s.mode === 'stamps')
    return toCents(s.stampMinOrder) > 0
      ? `1 carimbo a cada pedido a partir de ${brl(s.stampMinOrder)}`
      : '1 carimbo a cada pedido';
  const per = Number(s.pointsPerReal);
  return per === 1
    ? '1 ponto a cada R$ 1 gasto'
    : `${per.toLocaleString('pt-BR')} ${per === 1 ? 'ponto' : 'pontos'} a cada R$ 1 gasto`;
}

const EMPTY_REWARD = {
  name: '',
  cost: '',
  kind: 'discount' as LoyaltyReward['kind'],
  amount: '',
  productId: '',
  active: true,
};

/**
 * Fidelidade (Loja online): o dono liga o programa, escolhe a regra (pontos por real ou
 * carimbos por pedido), cadastra as recompensas e acompanha o resultado.
 */
export function LoyaltyPanel({
  canManage,
  products,
  onSaved,
}: {
  canManage: boolean;
  products: Product[];
  onSaved(): void;
}) {
  const toast = useToast();
  const [s, setS] = useState<LoyaltySettings | null>(null);
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [rule, setRule] = useState({ pointsPerReal: '1', stampMinOrder: '', expiryDays: '' });
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<LoyaltyReward | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_REWARD);
  const [days, setDays] = useState<'30' | '90' | '365'>('30');
  const [report, setReport] = useState<LoyaltyReport | null>(null);
  const [pin, setPin] = useState(false);

  const fill = (x: LoyaltySettings) => {
    setS(x);
    setRule({
      pointsPerReal: moneyOut(x.pointsPerReal).replace(/,00$/, ''),
      stampMinOrder: toCents(x.stampMinOrder) ? moneyOut(x.stampMinOrder) : '',
      expiryDays: x.expiryDays ? String(x.expiryDays) : '',
    });
  };
  const load = useCallback(
    () =>
      api<{ settings: LoyaltySettings; rewards: LoyaltyReward[] }>('/loyalty').then(
        (r) => {
          fill(r.settings);
          setRewards(r.rewards);
        },
        (e: Error) => toast(e.message, 'danger'),
      ),
    [toast],
  );
  useEffect(() => void load(), [load]);
  useEffect(() => {
    api<LoyaltyReport>(`/loyalty/report?days=${days}`).then(setReport, () => setReport(null));
  }, [days, rewards]);

  async function save(patch: Partial<LoyaltySettings>, ok = 'Fidelidade salva') {
    setBusy(true);
    try {
      fill(await api<LoyaltySettings>('/loyalty', { method: 'PATCH', json: patch }));
      toast(ok, 'success');
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  function saveRule() {
    const ppr = moneyIn(rule.pointsPerReal);
    const min = moneyIn(rule.stampMinOrder);
    const exp = rule.expiryDays.trim() ? Number(rule.expiryDays) : null;
    if (s!.mode === 'points' && (!ppr || Number(ppr) <= 0))
      return toast('Informe quantos pontos vale cada R$ 1', 'danger');
    if (min === undefined) return toast('Valor mínimo inválido', 'danger');
    if (exp !== null && (!Number.isInteger(exp) || exp < 7 || exp > 1095))
      return toast('Validade entre 7 e 1095 dias (ou em branco)', 'danger');
    void save({
      ...(s!.mode === 'points' ? { pointsPerReal: ppr! } : { stampMinOrder: min ?? '0.00' }),
      expiryDays: exp,
    });
  }

  function open(r: LoyaltyReward | 'new') {
    setEdit(r);
    setForm(
      r === 'new'
        ? EMPTY_REWARD
        : {
            name: r.name,
            cost: String(r.cost),
            kind: r.kind,
            amount: moneyOut(r.amount),
            productId: r.productId ?? '',
            active: r.active,
          },
    );
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok, 'success');
      await load();
      onSaved();
      return true;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const amount = moneyIn(form.amount);
    const json = {
      name: form.name.trim(),
      cost: Number(form.cost),
      kind: form.kind,
      amount: form.kind === 'discount' ? amount : null,
      productId: form.kind === 'product' ? form.productId || null : null,
      active: form.active,
    };
    const ok = await run(
      () =>
        edit === 'new'
          ? api('/loyalty/rewards', { method: 'POST', json })
          : api(`/loyalty/rewards/${(edit as LoyaltyReward).id}`, { method: 'PATCH', json }),
      'Recompensa salva',
    );
    if (ok) setEdit(null);
  }

  if (!s) return <Skeleton variant="form" />;
  const unit = unitOf(s.mode);
  const invalid =
    !form.name.trim() ||
    !(Number(form.cost) >= 1) ||
    (form.kind === 'discount' ? !moneyIn(form.amount) : !form.productId);
  const active = products.filter((p) => p.active);

  return (
    <div className="os-stack">
      <Card
        title="Programa de fidelidade"
        actions={
          <Button variant="secondary" icon={<KeyRound size={16} />} onClick={() => setPin(true)}>
            PIN do cliente
          </Button>
        }
      >
        <label className="os-toggle">
          <span>
            <strong>Programa ligado</strong>
            <small>
              Clientes com conta no cardápio juntam {unit} a cada pedido concluído e trocam por
              recompensas.
            </small>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              checked={s.enabled}
              disabled={!canManage || busy}
              onChange={(e) =>
                save(
                  { enabled: e.target.checked },
                  e.target.checked ? 'Fidelidade ligada' : 'Fidelidade pausada',
                )
              }
            />
            <span className="switch__track" aria-hidden />
          </span>
        </label>
        {s.enabled && !rewards.some((r) => r.active) && (
          <Alert tone="warning">
            Cadastre pelo menos uma recompensa para o cliente ter o que trocar.
          </Alert>
        )}
      </Card>

      <Card title="Regra">
        <div className="cm-form">
          <div className="cm-form__block">
            <Segmented
              label="Como o cliente acumula"
              value={s.mode}
              onChange={(mode) => canManage && save({ mode }, 'Regra salva')}
              options={[
                { value: 'points', label: 'Pontos por real' },
                { value: 'stamps', label: 'Carimbos por pedido' },
              ]}
            />
          </div>
          {s.mode === 'points' ? (
            <TextField
              label="Pontos a cada R$ 1 gasto"
              inputMode="decimal"
              hint="Conta o valor dos itens com desconto, sem a taxa de entrega."
              value={rule.pointsPerReal}
              disabled={!canManage}
              onChange={(e) => setRule({ ...rule, pointsPerReal: e.target.value })}
            />
          ) : (
            <TextField
              label="Pedido mínimo para ganhar o carimbo (R$)"
              inputMode="decimal"
              placeholder="Sem mínimo"
              hint="Cada pedido concluído acima desse valor vale 1 carimbo."
              value={rule.stampMinOrder}
              disabled={!canManage}
              onChange={(e) => setRule({ ...rule, stampMinOrder: e.target.value })}
            />
          )}
          <TextField
            label="Validade (dias sem comprar)"
            inputMode="numeric"
            placeholder="Não vencem"
            hint="Os pontos zeram se o cliente ficar esse tempo sem pedir."
            value={rule.expiryDays}
            disabled={!canManage}
            onChange={(e) => setRule({ ...rule, expiryDays: e.target.value.replace(/\D/g, '') })}
          />
          <label className="os-toggle cm-form__wide">
            <span>
              <strong>Pedidos do balcão também contam</strong>
              <small>
                Quando a equipe informa no PDV o celular de um cliente com conta, ele ganha os{' '}
                {unit} do pedido.
              </small>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={s.countStaffOrders}
                disabled={!canManage || busy}
                onChange={(e) => save({ countStaffOrders: e.target.checked }, 'Regra salva')}
              />
              <span className="switch__track" aria-hidden />
            </span>
          </label>
          {canManage && (
            <div className="cm-form__wide">
              <Button onClick={saveRule} loading={busy}>
                Salvar regra
              </Button>
            </div>
          )}
        </div>
        <p className="cm-hint lp-rule">
          O cliente vê: <strong>{ruleText(s)}</strong>
          {s.expiryDays ? `, válidos por ${s.expiryDays} dias sem comprar` : ''}.
        </p>
      </Card>

      <Card
        title="Recompensas"
        actions={
          canManage && (
            <Button icon={<Plus size={16} />} onClick={() => open('new')} disabled={busy}>
              Nova recompensa
            </Button>
          )
        }
      >
        {rewards.length === 0 ? (
          <EmptyState
            icon={<Gift size={20} />}
            title="Nenhuma recompensa ainda"
            description={`Ex.: 100 ${unit} = R$ 10 de desconto, ou 10 carimbos = um hambúrguer grátis.`}
          />
        ) : (
          <ul className="lp-rewards">
            {rewards.map((r) => (
              <li key={r.id} className="lp-reward" data-off={!r.active || undefined}>
                <span className="lp-reward__cost">
                  <strong>{int(r.cost)}</strong>
                  <small>{unitOf(s.mode, r.cost)}</small>
                </span>
                <span className="lp-reward__text">
                  <strong>{r.name}</strong>
                  <small>
                    {r.kind === 'discount'
                      ? `${brl(r.amount!)} de desconto`
                      : `${r.productName ?? 'Produto'} grátis (${brl(r.productPrice ?? '0')})`}
                  </small>
                </span>
                {!r.active && <Badge>Pausada</Badge>}
                {canManage && (
                  <span className="lp-reward__actions">
                    <Button
                      variant="ghost"
                      aria-label="Editar"
                      icon={<Pencil size={16} />}
                      onClick={() => open(r)}
                    />
                    <Button
                      variant="ghost"
                      aria-label="Apagar"
                      icon={<Trash2 size={16} />}
                      onClick={() =>
                        window.confirm('Apagar esta recompensa?') &&
                        run(
                          () => api(`/loyalty/rewards/${r.id}`, { method: 'DELETE' }),
                          'Recompensa apagada',
                        )
                      }
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <LevelsCard canManage={canManage} s={s} save={save} busy={busy} />
      {s.mode === 'points' && (
        <ItemPointsCard canManage={canManage} s={s} save={save} busy={busy} products={products} />
      )}
      <ReferralCard canManage={canManage} s={s} save={save} busy={busy} />

      <Card
        title="Resultado"
        actions={
          <Segmented
            label="Período"
            value={days}
            onChange={setDays}
            options={[
              { value: '30', label: '30 dias' },
              { value: '90', label: '90 dias' },
              { value: '365', label: '1 ano' },
            ]}
          />
        }
      >
        {!report ? (
          <Skeleton variant="cards" />
        ) : (
          <>
            <div className="lp-kpis">
              <div>
                <span>Clientes com saldo</span>
                <strong>{int(report.members)}</strong>
                <small>
                  {int(report.outstanding)} {unit} em aberto
                </small>
              </div>
              <div>
                <span>Vendas de quem participa</span>
                <strong>{brl(report.revenue)}</strong>
                <small>
                  {int(report.orders)} pedidos de {int(report.customers)} clientes
                </small>
              </div>
              <div>
                <span>{s.mode === 'stamps' ? 'Carimbos dados' : 'Pontos dados'}</span>
                <strong>{int(report.earned)}</strong>
                <small>{report.expired ? `${int(report.expired)} venceram` : 'no período'}</small>
              </div>
              <div>
                <span>Recompensas trocadas</span>
                <strong>{int(report.redemptions)}</strong>
                <small>{brl(report.discount)} em descontos</small>
              </div>
            </div>
            {report.top.length === 0 ? (
              <p className="cm-hint">
                <Stamp size={14} style={{ verticalAlign: -2 }} /> Assim que os primeiros pedidos de
                clientes com conta forem concluídos, eles aparecem aqui.
              </p>
            ) : (
              <div className="lp-table">
                <table className="cm-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th className="num">Saldo</th>
                      <th className="num">Ganhou</th>
                      <th className="num">Trocou</th>
                      <th>Último movimento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.top.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <strong>{c.name}</strong>
                        </td>
                        <td className="num">{int(c.balance)}</td>
                        <td className="num">{int(c.earned)}</td>
                        <td className="num">{int(c.redeemed)}</td>
                        <td>{new Date(c.lastAt).toLocaleDateString('pt-BR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      <Modal
        open={edit !== null}
        title={edit === 'new' ? 'Nova recompensa' : 'Editar recompensa'}
        onClose={() => setEdit(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Cancelar
            </Button>
            <Button loading={busy} disabled={invalid} onClick={submit}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="cm-form">
          <div className="cm-form__block">
            <Segmented
              label="Tipo"
              block
              value={form.kind}
              onChange={(kind) => setForm({ ...form, kind })}
              options={[
                { value: 'discount', label: 'Desconto em R$' },
                { value: 'product', label: 'Produto grátis' },
              ]}
            />
          </div>
          <TextField
            label="Nome"
            required
            maxLength={60}
            placeholder={form.kind === 'discount' ? 'Ex.: R$ 10 de desconto' : 'Ex.: Refri grátis'}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <TextField
            label={`Custa quantos ${unit}`}
            inputMode="numeric"
            required
            value={form.cost}
            onChange={(e) => setForm({ ...form, cost: e.target.value.replace(/\D/g, '') })}
          />
          {form.kind === 'discount' ? (
            <TextField
              label="Valor do desconto (R$)"
              inputMode="decimal"
              placeholder="10,00"
              hint="Sai do valor dos itens; a taxa de entrega continua."
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          ) : (
            <SelectField
              label="Produto"
              value={form.productId}
              onChange={(e) => setForm({ ...form, productId: e.target.value })}
            >
              <option value="">Escolha…</option>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {brl(p.price)}
                </option>
              ))}
            </SelectField>
          )}
          <label className="os-toggle cm-form__wide">
            <span>
              <strong>Disponível para troca</strong>
              {form.kind === 'product' && (
                <small>
                  O cliente coloca o produto na sacola e o preço base dele sai do total.
                </small>
              )}
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              <span className="switch__track" aria-hidden />
            </span>
          </label>
        </div>
      </Modal>
      <CustomerPinModal open={pin} onClose={() => setPin(false)} />
    </div>
  );
}
