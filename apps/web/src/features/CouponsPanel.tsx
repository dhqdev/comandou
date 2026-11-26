import { couponHeadline, normalizeCouponCode, toCents, type CouponKind } from '@comandou/shared';
import { Eye, KeyRound, Pencil, Plus, Shuffle, TicketPercent, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Segmented,
  Skeleton,
  TextField,
  useToast,
} from '../design-system';
import { api } from '../lib/api';
import { brl, parseBrlInput } from '../lib/money';
import { AreaField, isoOf, localInput, Switch } from './admin-fields';
import { CustomerPinModal } from './CustomerPin';
import { ImagePicker } from './ImagePicker';
import './app-admin.css';

export interface AdminCoupon {
  id: string;
  code: string;
  title: string;
  description: string | null;
  kind: CouponKind;
  value: string | null;
  maxDiscount: string | null;
  minOrder: string;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  perCustomer: number;
  firstOrderOnly: boolean;
  listed: boolean;
  active: boolean;
  imageId: string | null;
  position: number;
  uses: number;
  discountTotal: string;
}
interface CouponUse {
  id: string;
  discount: string;
  channel: string | null;
  refundedAt: string | null;
  createdAt: string;
  orderNumber: number | null;
  customerName: string | null;
}

const moneyOut = (v: string | null) => (v && toCents(v) ? v.replace('.', ',') : '');
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

const EMPTY = {
  code: '',
  title: '',
  description: '',
  kind: 'percent' as CouponKind,
  value: '',
  maxDiscount: '',
  minOrder: '',
  startsAt: '',
  endsAt: '',
  maxUses: '',
  perCustomer: '1',
  firstOrderOnly: false,
  listed: true,
  active: true,
  imageId: null as string | null,
};
type Form = typeof EMPTY;

/** Modelos para começar rápido (a pessoa ainda edita tudo antes de salvar). */
const TEMPLATES: { label: string; form: Partial<Form> }[] = [
  {
    label: '10% no primeiro pedido',
    form: {
      code: 'BEMVINDO10',
      title: 'Boas-vindas',
      description: '10% de desconto no seu primeiro pedido pelo app.',
      kind: 'percent',
      value: '10',
      maxDiscount: '20,00',
      firstOrderOnly: true,
    },
  },
  {
    label: 'Entrega grátis acima de R$ 50',
    form: {
      code: 'FRETEGRATIS',
      title: 'Entrega grátis',
      description: 'Entrega grátis nos pedidos a partir de R$ 50.',
      kind: 'free_delivery',
      minOrder: '50,00',
    },
  },
  {
    label: 'R$ 5 de desconto',
    form: {
      code: 'GANHE5',
      title: 'R$ 5 de desconto',
      description: 'R$ 5 de desconto nos pedidos a partir de R$ 40.',
      kind: 'fixed',
      value: '5,00',
      minOrder: '40,00',
    },
  },
];

function randomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}

/** Regras do cupom numa linha, como o cliente lê. */
export function couponSummary(c: AdminCoupon) {
  const out: string[] = [];
  if (toCents(c.minOrder) > 0) out.push(`mínimo ${brl(c.minOrder)}`);
  if (c.kind === 'percent' && c.maxDiscount) out.push(`até ${brl(c.maxDiscount)}`);
  if (c.firstOrderOnly) out.push('só no primeiro pedido');
  out.push(c.perCustomer > 1 ? `${c.perCustomer} vezes por cliente` : '1 vez por cliente');
  if (c.maxUses) out.push(`${c.maxUses} no total`);
  if (c.endsAt) out.push(`até ${day(c.endsAt)}`);
  return out.join(' · ');
}

/**
 * Loja online › Cupons: a loja cria cupons de porcentagem, valor ou entrega grátis, com validade,
 * pedido mínimo e limites. Os da vitrine aparecem na aba Cupons do app; os outros valem só pelo
 * código. No balcão, a equipe usa pelo PIN do cliente.
 */
export function CouponsPanel({ canManage, onSaved }: { canManage: boolean; onSaved(): void }) {
  const toast = useToast();
  const [list, setList] = useState<AdminCoupon[] | null>(null);
  const [edit, setEdit] = useState<AdminCoupon | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [uses, setUses] = useState<{ c: AdminCoupon; list: CouponUse[] | null } | null>(null);
  const [pin, setPin] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(
    () =>
      api<AdminCoupon[]>('/coupons').then(setList, (e: Error) => {
        setList([]);
        toast(e.message, 'danger');
      }),
    [toast],
  );
  useEffect(() => void load(), [load]);

  function open(c: AdminCoupon | 'new', template?: Partial<Form>) {
    setEdit(c);
    setForm(
      c === 'new'
        ? { ...EMPTY, ...template }
        : {
            code: c.code,
            title: c.title,
            description: c.description ?? '',
            kind: c.kind,
            value: c.kind === 'percent' ? (c.value ?? '').replace(/\.00$/, '') : moneyOut(c.value),
            maxDiscount: moneyOut(c.maxDiscount),
            minOrder: moneyOut(c.minOrder),
            startsAt: localInput(c.startsAt),
            endsAt: localInput(c.endsAt),
            maxUses: c.maxUses ? String(c.maxUses) : '',
            perCustomer: String(c.perCustomer),
            firstOrderOnly: c.firstOrderOnly,
            listed: c.listed,
            active: c.active,
            imageId: c.imageId,
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

  const code = normalizeCouponCode(form.code);
  const pct = form.kind === 'percent' ? Number(form.value.replace(',', '.')) : 0;
  const fixed = form.kind === 'fixed' ? parseBrlInput(form.value) : null;
  const errs = {
    code: code.length < 3 ? 'Mínimo de 3 letras ou números' : undefined,
    value:
      form.kind === 'percent'
        ? !(pct > 0 && pct <= 100)
          ? 'De 1 a 100%'
          : undefined
        : form.kind === 'fixed' && !(fixed && toCents(fixed) > 0)
          ? 'Informe o valor'
          : undefined,
    minOrder: form.minOrder && !parseBrlInput(form.minOrder) ? 'Valor inválido' : undefined,
    maxDiscount:
      form.maxDiscount && !parseBrlInput(form.maxDiscount) ? 'Valor inválido' : undefined,
    endsAt:
      form.startsAt && form.endsAt && form.endsAt <= form.startsAt
        ? 'O fim precisa ser depois do início'
        : undefined,
  };
  const invalid = !form.title.trim() || Object.values(errs).some(Boolean);

  async function submit() {
    const json = {
      code,
      title: form.title.trim(),
      description: form.description.trim() || null,
      kind: form.kind,
      value: form.kind === 'percent' ? pct.toFixed(2) : form.kind === 'fixed' ? fixed : null,
      maxDiscount:
        form.kind === 'percent' && form.maxDiscount ? parseBrlInput(form.maxDiscount) : null,
      minOrder: form.minOrder ? parseBrlInput(form.minOrder)! : '0.00',
      startsAt: isoOf(form.startsAt),
      endsAt: isoOf(form.endsAt),
      maxUses: form.maxUses ? Number(form.maxUses) : null,
      perCustomer: Math.max(1, Number(form.perCustomer) || 1),
      firstOrderOnly: form.firstOrderOnly,
      listed: form.listed,
      active: form.active,
      imageId: form.imageId,
    };
    const ok = await run(
      () =>
        edit === 'new'
          ? api('/coupons', { method: 'POST', json })
          : api(`/coupons/${(edit as AdminCoupon).id}`, { method: 'PATCH', json }),
      'Cupom salvo',
    );
    if (ok) setEdit(null);
  }

  async function showUses(c: AdminCoupon) {
    setUses({ c, list: null });
    try {
      setUses({ c, list: await api<CouponUse[]>(`/coupons/${c.id}/uses`) });
    } catch (e) {
      setUses(null);
      toast((e as Error).message, 'danger');
    }
  }

  const live = (c: AdminCoupon) =>
    c.active &&
    (!c.startsAt || new Date(c.startsAt) <= new Date()) &&
    (!c.endsAt || new Date(c.endsAt) > new Date());

  return (
    <div className="os-stack">
      <Card
        title="Cupons"
        actions={
          <>
            <Button variant="secondary" icon={<KeyRound size={16} />} onClick={() => setPin(true)}>
              PIN do cliente
            </Button>
            {canManage && (
              <Button icon={<Plus size={16} />} onClick={() => open('new')} disabled={busy}>
                Novo cupom
              </Button>
            )}
          </>
        }
      >
        <p className="cm-hint aa-lead">
          O cliente usa o cupom na aba Cupons do app ou digitando o código na finalização. Vale um
          por pedido e não se junta com a troca de pontos. No balcão, abra o PIN do cliente para
          registrar o uso.
        </p>
        {list === null ? (
          <Skeleton />
        ) : list.length === 0 ? (
          <>
            <EmptyState
              icon={<TicketPercent size={20} />}
              title="Nenhum cupom ainda"
              description="Comece por um destes e ajuste do seu jeito:"
            />
            {canManage && (
              <div className="aa-templates">
                {TEMPLATES.map((t) => (
                  <Button key={t.label} variant="secondary" onClick={() => open('new', t.form)}>
                    {t.label}
                  </Button>
                ))}
              </div>
            )}
          </>
        ) : (
          <ul className="aa-list">
            {list.map((c) => (
              <li key={c.id} className="aa-row" data-off={!live(c) || undefined}>
                <span className="aa-code">{c.code}</span>
                <span className="aa-row__text">
                  <strong>
                    {couponHeadline(c)}
                    {c.title.trim().toLowerCase() !== couponHeadline(c).toLowerCase() &&
                      ` · ${c.title}`}
                  </strong>
                  <small>{couponSummary(c)}</small>
                  <small className="aa-row__meta">
                    {c.uses
                      ? `${c.uses.toLocaleString('pt-BR')} ${c.uses === 1 ? 'uso' : 'usos'} · ${brl(c.discountTotal)} em descontos`
                      : 'Ainda sem uso'}
                    {!c.listed && ' · só pelo código'}
                  </small>
                </span>
                {!c.active ? (
                  <Badge>Desligado</Badge>
                ) : !live(c) ? (
                  <Badge tone="warning">Fora da validade</Badge>
                ) : null}
                {canManage && (
                  <label className="switch" title={c.active ? 'Valendo' : 'Desligado'}>
                    <input
                      type="checkbox"
                      checked={c.active}
                      aria-label={`Cupom ${c.code} ligado`}
                      onChange={(e) =>
                        run(
                          () =>
                            api(`/coupons/${c.id}`, {
                              method: 'PATCH',
                              json: { active: e.target.checked },
                            }),
                          e.target.checked ? 'Cupom ligado' : 'Cupom desligado',
                        )
                      }
                    />
                    <span className="switch__track" aria-hidden />
                  </label>
                )}
                <span className="aa-row__actions">
                  <Button
                    variant="ghost"
                    aria-label={`Quem usou ${c.code}`}
                    title="Quem usou"
                    icon={<Eye size={16} />}
                    onClick={() => showUses(c)}
                  />
                  {canManage && (
                    <>
                      <Button
                        variant="ghost"
                        aria-label={`Editar ${c.code}`}
                        icon={<Pencil size={16} />}
                        onClick={() => open(c)}
                      />
                      <Button
                        variant="ghost"
                        aria-label={`Apagar ${c.code}`}
                        icon={<Trash2 size={16} />}
                        onClick={() =>
                          window.confirm(`Apagar o cupom ${c.code}?`) &&
                          run(() => api(`/coupons/${c.id}`, { method: 'DELETE' }), 'Cupom apagado')
                        }
                      />
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={edit !== null}
        size="lg"
        title={edit === 'new' ? 'Novo cupom' : `Cupom ${(edit as AdminCoupon | null)?.code ?? ''}`}
        onClose={() => setEdit(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Cancelar
            </Button>
            <Button loading={busy} disabled={invalid} onClick={submit}>
              Salvar cupom
            </Button>
          </>
        }
      >
        <div className="cm-form">
          <div className="cm-form__block">
            <Segmented
              label="O que o cupom dá"
              block
              value={form.kind}
              onChange={(kind) => set('kind', kind)}
              options={[
                { value: 'percent', label: 'Porcentagem' },
                { value: 'fixed', label: 'Valor em R$' },
                { value: 'free_delivery', label: 'Entrega grátis' },
              ]}
            />
          </div>
          <div className="aa-codefield">
            <TextField
              label="Código"
              required
              maxLength={24}
              placeholder="Ex.: BEMVINDO10"
              value={form.code}
              aria-invalid={form.code && errs.code ? true : undefined}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
            />
            <Button
              variant="secondary"
              icon={<Shuffle size={16} />}
              onClick={() => set('code', randomCode())}
            >
              Gerar
            </Button>
            {form.code && errs.code ? (
              <small className="form-error">{errs.code}</small>
            ) : (
              <small className="cm-hint">
                O cliente digita este código. Letras e números, sem espaço.
              </small>
            )}
          </div>
          <TextField
            label="Nome do cupom"
            required
            maxLength={60}
            placeholder="Ex.: Boas-vindas"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
          />
          <AreaField
            label="Texto para o cliente (opcional)"
            maxLength={240}
            placeholder="Ex.: 10% de desconto no seu primeiro pedido pelo app."
            value={form.description}
            onChange={(v) => set('description', v)}
          />
          {form.kind !== 'free_delivery' && (
            <TextField
              label={form.kind === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'}
              inputMode="decimal"
              placeholder={form.kind === 'percent' ? '10' : '5,00'}
              value={form.value}
              error={form.value ? errs.value : undefined}
              onChange={(e) => set('value', e.target.value)}
            />
          )}
          {form.kind === 'percent' && (
            <TextField
              label="Desconto máximo (R$, opcional)"
              inputMode="decimal"
              placeholder="Sem limite"
              value={form.maxDiscount}
              error={errs.maxDiscount}
              onChange={(e) => set('maxDiscount', e.target.value)}
            />
          )}
          <TextField
            label="Pedido mínimo (R$, opcional)"
            inputMode="decimal"
            placeholder="Sem mínimo"
            hint="Conta o valor dos itens, sem a entrega."
            value={form.minOrder}
            error={errs.minOrder}
            onChange={(e) => set('minOrder', e.target.value)}
          />
          <TextField
            label="Começa (opcional)"
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => set('startsAt', e.target.value)}
          />
          <TextField
            label="Termina (opcional)"
            type="datetime-local"
            value={form.endsAt}
            error={errs.endsAt}
            onChange={(e) => set('endsAt', e.target.value)}
          />
          <TextField
            label="Quantos cupons no total (opcional)"
            inputMode="numeric"
            placeholder="Sem limite"
            value={form.maxUses}
            onChange={(e) => set('maxUses', e.target.value.replace(/\D/g, '').slice(0, 7))}
          />
          <TextField
            label="Quantas vezes cada cliente usa"
            inputMode="numeric"
            value={form.perCustomer}
            onChange={(e) => set('perCustomer', e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <Switch
            label="Só no primeiro pedido"
            hint="Vale para quem ainda não tem pedido concluído na loja."
            checked={form.firstOrderOnly}
            onChange={(v) => set('firstOrderOnly', v)}
          />
          <Switch
            label="Aparece na aba Cupons do app"
            hint="Desligado, o cupom vale só para quem tiver o código (ex.: divulgado no Instagram)."
            checked={form.listed}
            onChange={(v) => set('listed', v)}
          />
          <Switch label="Cupom ligado" checked={form.active} onChange={(v) => set('active', v)} />
          <div className="cm-field cm-form__wide aa-photo">
            <span className="cm-label">Foto do cupom (opcional)</span>
            <ImagePicker
              label="Foto do cupom"
              width={96}
              value={form.imageId}
              onChange={(id) => set('imageId', id)}
            />
          </div>
        </div>
        {(form.kind === 'free_delivery' || pct > 0 || fixed) && (
          <Alert tone="info">
            O cliente vê:{' '}
            <strong>
              {couponHeadline({
                kind: form.kind,
                value: form.kind === 'percent' ? String(pct) : fixed,
              })}
            </strong>
            {form.title.trim() ? ` · ${form.title.trim()}` : ''}
          </Alert>
        )}
      </Modal>

      <Modal
        open={uses !== null}
        title={uses ? `Quem usou ${uses.c.code}` : ''}
        onClose={() => setUses(null)}
        footer={
          <Button variant="ghost" onClick={() => setUses(null)}>
            Fechar
          </Button>
        }
      >
        {!uses?.list ? (
          <Skeleton />
        ) : uses.list.length === 0 ? (
          <EmptyState
            icon={<TicketPercent size={20} />}
            title="Ninguém usou ainda"
            description="Cada pedido com o cupom aparece aqui."
          />
        ) : (
          <ul className="aa-uses">
            {uses.list.map((u) => (
              <li key={u.id} data-off={u.refundedAt ? '' : undefined}>
                <span>
                  <strong>{u.customerName ?? 'Cliente'}</strong>
                  <small>
                    {new Date(u.createdAt).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {u.orderNumber
                      ? ` · pedido #${u.orderNumber}`
                      : u.channel === 'store'
                        ? ' · no balcão'
                        : ''}
                    {u.refundedAt ? ' · devolvido (pedido cancelado)' : ''}
                  </small>
                </span>
                <strong className="aa-uses__value">
                  {toCents(u.discount) > 0 ? `−${brl(u.discount)}` : couponHeadline(uses.c)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <CustomerPinModal open={pin} onClose={() => setPin(false)} />
    </div>
  );
}
