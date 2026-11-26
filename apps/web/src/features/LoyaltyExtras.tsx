import { toCents, type LoyaltyLevel } from '@comandou/shared';
import { Ban, Crown, Plus, Sparkles, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, EmptyState, Skeleton, TextField, useToast } from '../design-system';
import { api, type Product } from '../lib/api';
import { brl } from '../lib/money';
import { Switch } from './admin-fields';
import { SelectField } from './forms';
import type { LoyaltySettings } from './LoyaltyPanel';
import './app-admin.css';

type Save = (patch: Partial<LoyaltySettings>, ok?: string) => Promise<void>;
const int = (n: number) => n.toLocaleString('pt-BR');
const digits = (v: string, max = 7) => v.replace(/\D/g, '').slice(0, max);

/** Cores que a loja escolhe para cada nível (dado do lojista, como as cores dos entregadores). */
export const LEVEL_COLORS = [
  { color: '#b26a3c', name: 'Bronze' },
  { color: '#7c8794', name: 'Prata' },
  { color: '#c99a06', name: 'Ouro' },
  { color: '#2f7fc1', name: 'Azul' },
  { color: '#2f9e63', name: 'Verde' },
  { color: '#7a4fc9', name: 'Roxo' },
  { color: '#d04848', name: 'Vermelho' },
] as const;

interface LevelRow {
  key: string;
  name: string;
  minPoints: string;
  perks: string;
  color: string | null;
}
let seq = 0;
const keyOf = () => `l${++seq}`;
const toRows = (list: LoyaltyLevel[]): LevelRow[] =>
  list.map((l) => ({
    key: keyOf(),
    name: l.name,
    minPoints: String(l.minPoints),
    perks: l.perks ?? '',
    color: l.color,
  }));
const body = (rows: LevelRow[]) =>
  rows.map((r) => ({
    name: r.name.trim(),
    minPoints: Number(r.minPoints) || 0,
    perks: r.perks.trim() || null,
    color: r.color,
  }));

/**
 * Níveis do programa (Bronze, Prata, Ouro…): o cliente sobe pelos pontos que ganhou (no total ou
 * numa janela de tempo) e vê o nível no topo do app e na tela de pontos.
 */
export function LevelsCard({
  canManage,
  s,
  save,
  busy,
}: {
  canManage: boolean;
  s: LoyaltySettings;
  save: Save;
  busy: boolean;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<LevelRow[] | null>(null);
  const [saved, setSaved] = useState('[]');
  const [saving, setSaving] = useState(false);
  const unit = s.mode === 'stamps' ? 'carimbos' : 'pontos';

  useEffect(() => {
    api<LoyaltyLevel[]>('/loyalty/levels').then(
      (l) => {
        const r = toRows(l);
        setRows(r);
        setSaved(JSON.stringify(body(r)));
      },
      () => setRows([]),
    );
  }, []);

  if (!rows)
    return (
      <Card title="Níveis">
        <Skeleton variant="form" />
      </Card>
    );

  const dirty = JSON.stringify(body(rows)) !== saved;
  const patch = (key: string, p: Partial<LevelRow>) =>
    setRows((all) => all!.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const mins = rows.map((r) => Number(r.minPoints) || 0);
  const dupe = mins.some((m, i) => mins.indexOf(m) !== i);
  const bad = rows.some((r) => !r.name.trim());

  function suggest() {
    const per = s.mode === 'stamps' ? 1 : Math.max(1, Number(s.pointsPerReal) || 1);
    const at = (reais: number) => String(Math.round((reais * per) / 10) * 10);
    setRows(
      s.mode === 'stamps'
        ? [
            { key: keyOf(), name: 'Bronze', minPoints: '0', perks: '', color: '#b26a3c' },
            { key: keyOf(), name: 'Prata', minPoints: '10', perks: '', color: '#7c8794' },
            { key: keyOf(), name: 'Ouro', minPoints: '25', perks: '', color: '#c99a06' },
          ]
        : [
            { key: keyOf(), name: 'Bronze', minPoints: '0', perks: '', color: '#b26a3c' },
            {
              key: keyOf(),
              name: 'Prata',
              minPoints: at(500),
              perks: 'Prioridade na fila de preparo',
              color: '#7c8794',
            },
            {
              key: keyOf(),
              name: 'Ouro',
              minPoints: at(1500),
              perks: 'Sobremesa grátis no aniversário',
              color: '#c99a06',
            },
          ],
    );
  }

  async function submit() {
    if (bad) return toast('Dê um nome para cada nível', 'danger');
    if (dupe) return toast('Dois níveis não podem começar na mesma pontuação', 'danger');
    setSaving(true);
    try {
      const sorted = [...body(rows!)].sort((a, b) => a.minPoints - b.minPoints);
      const r = toRows(
        await api<LoyaltyLevel[]>('/loyalty/levels', { method: 'PUT', json: { levels: sorted } }),
      );
      setRows(r);
      setSaved(JSON.stringify(body(r)));
      toast('Níveis salvos', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Níveis"
      actions={
        canManage &&
        rows.length > 0 && (
          <Button
            variant="secondary"
            icon={<Plus size={16} />}
            disabled={rows.length >= 8}
            onClick={() =>
              setRows([
                ...rows,
                {
                  key: keyOf(),
                  name: '',
                  minPoints: String((Math.max(0, ...mins) || 0) + (s.mode === 'stamps' ? 10 : 500)),
                  perks: '',
                  color: null,
                },
              ])
            }
          >
            Novo nível
          </Button>
        )
      }
    >
      <p className="cm-hint aa-lead">
        O cliente sobe de nível pelos {unit} que ganhou (trocar não faz descer). O nível aparece no
        topo do app, na tela de pontos e no PIN do balcão. Os benefícios são só texto: quem dá é a
        loja.
      </p>
      {rows.length === 0 ? (
        <>
          <EmptyState
            icon={<Crown size={20} />}
            title="Sem níveis"
            description="Com níveis, o cliente tem um motivo a mais para voltar."
          />
          {canManage && (
            <div className="aa-templates">
              <Button variant="secondary" icon={<Sparkles size={16} />} onClick={suggest}>
                Sugerir Bronze, Prata e Ouro
              </Button>
              <Button
                variant="ghost"
                icon={<Plus size={16} />}
                onClick={() =>
                  setRows([{ key: keyOf(), name: '', minPoints: '0', perks: '', color: null }])
                }
              >
                Criar do zero
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="aa-levels">
          {rows.map((r) => (
            <div
              key={r.key}
              className="aa-level"
              style={r.color ? ({ '--lv': r.color } as React.CSSProperties) : undefined}
            >
              <span className="aa-level__dot" aria-hidden />
              <TextField
                label="Nome"
                maxLength={30}
                placeholder="Ex.: Ouro"
                value={r.name}
                disabled={!canManage}
                onChange={(e) => patch(r.key, { name: e.target.value })}
              />
              <TextField
                label="A partir de"
                placeholder={unit}
                inputMode="numeric"
                value={r.minPoints}
                disabled={!canManage}
                onChange={(e) => patch(r.key, { minPoints: digits(e.target.value) })}
              />
              <TextField
                label="Benefício (opcional)"
                wrapClass="aa-level__perks"
                maxLength={300}
                placeholder="Ex.: Entrega grátis às terças"
                value={r.perks}
                disabled={!canManage}
                onChange={(e) => patch(r.key, { perks: e.target.value })}
              />
              {canManage ? (
                <Button
                  variant="ghost"
                  aria-label={`Tirar o nível ${r.name || 'sem nome'}`}
                  icon={<Trash2 size={16} />}
                  onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                />
              ) : (
                <span />
              )}
              {canManage && (
                <div className="aa-colors" role="group" aria-label="Cor do nível">
                  <button
                    type="button"
                    className="aa-color aa-color--none"
                    aria-pressed={r.color === null}
                    title="Cor da loja"
                    onClick={() => patch(r.key, { color: null })}
                  >
                    <Ban size={13} aria-hidden />
                  </button>
                  {LEVEL_COLORS.map((c) => (
                    <button
                      key={c.color}
                      type="button"
                      className="aa-color"
                      style={{ '--c': c.color } as React.CSSProperties}
                      aria-pressed={r.color === c.color}
                      aria-label={c.name}
                      title={c.name}
                      onClick={() => patch(r.key, { color: c.color })}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {canManage && (
        <div className="aa-actions">
          <SelectField
            label="Conta os pontos de"
            value={s.levelWindowDays ? String(s.levelWindowDays) : ''}
            disabled={busy}
            onChange={(e) =>
              void save(
                { levelWindowDays: e.target.value ? Number(e.target.value) : null },
                'Níveis salvos',
              )
            }
          >
            <option value="">Desde o começo</option>
            <option value="365">Últimos 12 meses</option>
            <option value="180">Últimos 6 meses</option>
            <option value="90">Últimos 90 dias</option>
          </SelectField>
          {(rows.length > 0 || dirty) && (
            <Button loading={saving} disabled={!dirty} onClick={submit}>
              Salvar níveis
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/** Pontos fixos por item ("Ganhe 50 pts") e o liga/desliga do selo no cardápio. */
export function ItemPointsCard({
  canManage,
  s,
  save,
  busy,
  products,
}: {
  canManage: boolean;
  s: LoyaltySettings;
  save: Save;
  busy: boolean;
  products: Product[];
}) {
  const toast = useToast();
  const [fixed, setFixed] = useState<Map<string, number> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [term, setTerm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ productId: string; points: number }[]>('/loyalty/item-points').then(
      (l) => setFixed(new Map(l.map((x) => [x.productId, x.points]))),
      () => setFixed(new Map()),
    );
  }, []);

  const ppr = toCents(s.pointsPerReal);
  const byRule = (p: Product) => Math.floor((toCents(p.price) * ppr) / 10_000);
  const list = useMemo(() => {
    const t = term.trim().toLowerCase();
    return products.filter((p) => p.active && (!t || p.name.toLowerCase().includes(t)));
  }, [products, term]);

  const valueOf = (id: string) =>
    id in draft ? draft[id]! : fixed?.has(id) ? String(fixed.get(id)) : '';
  const changes = Object.entries(draft)
    .map(([productId, v]) => ({ productId, points: v === '' ? null : Number(v) }))
    .filter((c) => (fixed?.get(c.productId) ?? null) !== c.points);

  async function submit() {
    setSaving(true);
    try {
      for (let i = 0; i < changes.length; i += 1000)
        await api('/loyalty/item-points', {
          method: 'PUT',
          json: { items: changes.slice(i, i + 1000) },
        });
      const next = new Map(fixed);
      for (const c of changes)
        if (c.points === null) next.delete(c.productId);
        else next.set(c.productId, c.points);
      setFixed(next);
      setDraft({});
      toast('Pontos dos itens salvos', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Pontos nos itens">
      <Switch
        label='Mostrar "Ganhe N pts" nos itens do cardápio'
        hint="O cliente vê quanto cada item rende antes de pedir."
        checked={s.showItemPoints}
        disabled={!canManage || busy}
        onChange={(v) => void save({ showItemPoints: v }, 'Pontos nos itens salvos')}
      />
      <p className="cm-hint">
        Cada item rende pela regra ({s.pointsPerReal.replace(/\.00$/, '').replace('.', ',')} por R$
        1). Para dar mais pontos num item (ex.: o lançamento da semana), escreva o número fixo por
        unidade. Em branco, volta para a regra.
      </p>
      {!fixed ? (
        <Skeleton />
      ) : (
        <>
          <input
            className="cm-input aa-search"
            type="search"
            aria-label="Pesquisar item"
            placeholder="Pesquisar"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          {list.length === 0 ? (
            <p className="cm-hint">Nenhum item com esse nome.</p>
          ) : (
            <ul className="aa-items">
              {list.map((p) => {
                const v = valueOf(p.id);
                return (
                  <li key={p.id} data-set={v !== '' || undefined}>
                    <span className="aa-items__name">
                      <strong>{p.name}</strong>
                      <small>
                        {v !== ''
                          ? `Fixo: ${int(Number(v))} pts por unidade`
                          : `${brl(p.price)} · pela regra, ${int(byRule(p))} pts`}
                      </small>
                    </span>
                    <input
                      className="cm-input"
                      inputMode="numeric"
                      aria-label={`Pontos fixos de ${p.name}`}
                      placeholder={String(byRule(p))}
                      value={v}
                      disabled={!canManage}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [p.id]: digits(e.target.value, 6) }))
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {canManage && changes.length > 0 && (
            <div className="aa-actions">
              <Button variant="ghost" onClick={() => setDraft({})}>
                Desfazer
              </Button>
              <Button loading={saving} onClick={submit}>
                Salvar {changes.length === 1 ? '1 item' : `${changes.length} itens`}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** Indique um amigo: pontos para quem indica e para o amigo, no primeiro pedido concluído dele. */
export function ReferralCard({
  canManage,
  s,
  save,
  busy,
}: {
  canManage: boolean;
  s: LoyaltySettings;
  save: Save;
  busy: boolean;
}) {
  const unit = s.mode === 'stamps' ? 'carimbos' : 'pontos';
  const [f, setF] = useState({
    mine: String(s.referralPoints),
    friend: String(s.referralFriendPoints),
  });
  useEffect(
    () => setF({ mine: String(s.referralPoints), friend: String(s.referralFriendPoints) }),
    [s.referralPoints, s.referralFriendPoints],
  );
  const mine = Number(f.mine) || 0;
  const friend = Number(f.friend) || 0;
  const dirty = mine !== s.referralPoints || friend !== s.referralFriendPoints;
  const on = s.referralPoints > 0 || s.referralFriendPoints > 0;

  return (
    <Card title="Indique um amigo">
      <p className="cm-hint aa-lead">
        Cada cliente ganha um código e um link de convite em Conta › Indique um amigo. Quando o
        amigo cria a conta pelo link (ou digita o código) e tem o primeiro pedido concluído, os dois
        ganham os {unit}. Com os dois em 0, a tela some do app.
      </p>
      <div className="cm-form">
        <TextField
          label={`Quem indica ganha (${unit})`}
          inputMode="numeric"
          value={f.mine}
          disabled={!canManage}
          onChange={(e) => setF({ ...f, mine: digits(e.target.value, 6) })}
        />
        <TextField
          label={`O amigo ganha (${unit})`}
          inputMode="numeric"
          value={f.friend}
          disabled={!canManage}
          onChange={(e) => setF({ ...f, friend: digits(e.target.value, 6) })}
        />
        {canManage && (
          <div className="cm-form__wide aa-actions">
            {on && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void save({ referralPoints: 0, referralFriendPoints: 0 }, 'Convites desligados')
                }
              >
                Desligar convites
              </Button>
            )}
            <Button
              variant="secondary"
              icon={<UserPlus size={16} />}
              loading={busy && dirty}
              disabled={!dirty || busy}
              onClick={() =>
                void save(
                  { referralPoints: mine, referralFriendPoints: friend },
                  'Indique um amigo salvo',
                )
              }
            >
              Salvar convite
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
