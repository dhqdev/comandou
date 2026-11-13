import type { ChargeRule, OptionGroupKind } from '@comandou/shared';
import { toCents } from '@comandou/shared';
import { ArrowDown, ArrowUp, Layers, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Modal,
  Skeleton,
  TextField,
  useToast,
  HelpScope,
  HelpTip,
} from '../../design-system';
import { useCan } from '../../app/auth';
import { rowClick } from '../../features/list-view';
import { SelectField } from '../../features/forms';
import { api, type Product } from '../../lib/api';
import { brl, parseBrlInput } from '../../lib/money';
import { useRealtime } from '../../lib/realtime';
import {
  CHARGE,
  GROUP_KIND,
  groupRule,
  toInput,
  type GroupLink,
  type OptionGroup,
} from './menu-data';
import { GROUP_HELP } from '../../features/help/menu-help';

/** Lista dos grupos de complementos; o editor abre por cima. */
export function GroupsTab() {
  const canWrite = useCan('catalog:write');
  const [groups, setGroups] = useState<OptionGroup[] | null>(null);
  const [editing, setEditing] = useState<OptionGroup | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setGroups(await api<OptionGroup[]>('/option-groups'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'menu.changed') void load();
  });

  return (
    <Card
      title="Grupos de complementos"
      bodyless
      actions={
        canWrite && (
          <Button icon={<Plus size={16} />} onClick={() => setEditing('new')}>
            Novo grupo
          </Button>
        )
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {groups === null ? (
        <div style={{ padding: 16 }}>
          <Skeleton height={120} />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Layers size={20} />}
          title="Nenhum grupo ainda"
          description="Ex.: Tamanho (P/M/G), Adicionais (bacon, ovo), Sabores da pizza ou Retirar ingrediente."
        />
      ) : (
        <div className="mn-table-wrap">
          <table className="cm-table cm-table--click">
            <thead>
              <tr>
                <th>Grupo</th>
                <th className="mn-hide-sm">Tipo</th>
                <th className="mn-hide-sm">Cobrança</th>
                <th>Escolha</th>
                <th className="cm-num">Itens</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id} data-search-id={`grupo-${g.id}`} {...rowClick(() => setEditing(g))}>
                  <td>
                    <button className="mn-item-link" onClick={() => setEditing(g)}>
                      {g.name}
                    </button>
                    <div className="mn-item-meta">
                      <span>
                        {g.options.length} {g.options.length === 1 ? 'opção' : 'opções'}
                      </span>
                      {!g.active && <span>Pausado</span>}
                    </div>
                    <div className="cm-hint mn-clamp">
                      {g.options
                        .slice(0, 6)
                        .map((o) => o.name)
                        .join(', ')}
                      {g.options.length > 6 ? '…' : ''}
                    </div>
                  </td>
                  <td className="mn-hide-sm">{GROUP_KIND[g.kind]?.label ?? g.kind}</td>
                  <td className="mn-hide-sm">{CHARGE[g.charge]}</td>
                  <td>{groupRule(g)}</td>
                  <td className="cm-num">{g.productCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <GroupEditor
        group={editing}
        canWrite={canWrite}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
    </Card>
  );
}

interface OptRow {
  key: number;
  id?: string;
  name: string;
  price: string;
  isDefault: boolean;
  active: boolean;
}
let rowKey = 1;
const emptyRow = (): OptRow => ({
  key: rowKey++,
  name: '',
  price: '',
  isDefault: false,
  active: true,
});

/** Padrões sugeridos ao trocar o tipo do grupo (a pessoa ainda pode mudar). */
const KIND_DEFAULTS: Record<OptionGroupKind, { min: number; max: number; charge: ChargeRule }> = {
  additional: { min: 0, max: 5, charge: 'sum' },
  variation: { min: 1, max: 1, charge: 'sum' },
  flavor: { min: 1, max: 2, charge: 'max' },
  remove: { min: 0, max: 10, charge: 'sum' },
};

/**
 * Cadastro do grupo: tipo, regra de cobrança, mínimo e máximo, as opções (preço e padrão) e
 * em quais itens ele aparece.
 */
export function GroupEditor({
  group,
  canWrite,
  onClose,
  onSaved,
}: {
  group: OptionGroup | 'new' | null;
  canWrite: boolean;
  onClose(): void;
  onSaved(saved: OptionGroup): void;
}) {
  const toast = useToast();
  const isNew = group === 'new';
  const [name, setName] = useState('');
  const [kind, setKind] = useState<OptionGroupKind>('additional');
  const [charge, setCharge] = useState<ChargeRule>('sum');
  const [min, setMin] = useState('0');
  const [max, setMax] = useState('5');
  const [active, setActive] = useState(true);
  const [rows, setRows] = useState<OptRow[]>([emptyRow()]);
  const [products, setProducts] = useState<Product[]>([]);
  const [links, setLinks] = useState<GroupLink[]>([]);
  const [usedBy, setUsedBy] = useState<string[]>([]);
  const [pickSearch, setPickSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!group) return;
    setError(null);
    setPickSearch('');
    if (group === 'new') {
      setName('');
      setKind('additional');
      setCharge('sum');
      setMin('0');
      setMax('5');
      setActive(true);
      setRows([emptyRow()]);
    } else {
      setName(group.name);
      setKind(group.kind);
      setCharge(group.charge);
      setMin(String(group.minSelect));
      setMax(String(group.maxSelect));
      setActive(group.active);
      setRows(
        group.options.map((o) => ({
          key: rowKey++,
          id: o.id,
          name: o.name,
          price: toCents(o.priceDelta) > 0 ? toInput(o.priceDelta) : '',
          isDefault: o.isDefault,
          active: o.active,
        })),
      );
    }
    void Promise.all([
      api<Product[]>('/products'),
      api<GroupLink[]>('/product-option-groups'),
    ]).then(([p, l]) => {
      setProducts(p);
      setLinks(l);
      setUsedBy(
        group === 'new' ? [] : l.filter((x) => x.groupId === group.id).map((x) => x.productId),
      );
    });
  }, [group]);

  function changeKind(k: OptionGroupKind) {
    setKind(k);
    const d = KIND_DEFAULTS[k];
    setMin(String(d.min));
    setMax(String(d.max));
    setCharge(d.charge);
    if (k === 'remove') setRows((r) => r.map((x) => ({ ...x, price: '' })));
  }

  const minN = Number(min);
  const maxN = Number(max);
  const filled = rows.filter((r) => r.name.trim());
  const priceErr = (r: OptRow) => !!r.price && !parseBrlInput(r.price);
  const rangeErr =
    !Number.isInteger(minN) || !Number.isInteger(maxN) || maxN < 1 || minN > maxN || maxN > 50
      ? 'Mínimo até o máximo; máximo de 1 a 50'
      : undefined;
  const defaults = filled.filter((r) => r.isDefault).length;
  const valid =
    name.trim() && filled.length > 0 && !filled.some(priceErr) && !rangeErr && defaults <= maxN;
  const term = pickSearch.trim().toLowerCase();
  const pickable = useMemo(
    () => products.filter((p) => !term || p.name.toLowerCase().includes(term)),
    [products, term],
  );

  function move(i: number, d: -1 | 1) {
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const copy = [...r];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        kind,
        charge,
        minSelect: minN,
        maxSelect: maxN,
        options: filled.map((r) => ({
          id: r.id,
          name: r.name.trim(),
          priceDelta: r.price ? parseBrlInput(r.price)! : '0',
          isDefault: r.isDefault,
          active: r.active,
        })),
      };
      const saved = isNew
        ? await api<OptionGroup>('/option-groups', { method: 'POST', json: body })
        : await api<OptionGroup>(`/option-groups/${(group as OptionGroup).id}`, {
            method: 'PUT',
            json: { ...body, active },
          });
      // Itens que passaram a usar (ou deixaram de usar) o grupo: mantém a ordem dos outros grupos.
      const before = new Set(links.filter((l) => l.groupId === saved.id).map((l) => l.productId));
      const after = new Set(usedBy);
      const changed = products.filter((p) => before.has(p.id) !== after.has(p.id));
      for (const p of changed) {
        const others = links
          .filter((l) => l.productId === p.id && l.groupId !== saved.id)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((l) => l.groupId);
        await api(`/products/${p.id}/option-groups`, {
          method: 'PUT',
          json: { groupIds: after.has(p.id) ? [...others, saved.id] : others },
        });
      }
      toast(isNew ? 'Grupo criado' : 'Grupo salvo', 'success');
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const free = kind === 'remove';
  return (
    <HelpScope dict={GROUP_HELP}>
      <Modal
        open={!!group}
        onClose={onClose}
        size="xl"
        title={isNew ? 'Novo grupo de complementos' : name || 'Grupo'}
        footer={
          canWrite && (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button loading={busy} disabled={!valid} onClick={save}>
                Salvar grupo
              </Button>
            </>
          )
        }
      >
        <div className="cm-form">
          <TextField
            label="Nome do grupo"
            wrapClass="cm-form__wide"
            placeholder="Ex.: Adicionais do burger"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          <SelectField
            label="Tipo"
            value={kind}
            onChange={(e) => changeKind(e.target.value as OptionGroupKind)}
          >
            {Object.entries(GROUP_KIND).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Cobrança"
            value={charge}
            disabled={free}
            onChange={(e) => setCharge(e.target.value as ChargeRule)}
          >
            {Object.entries(CHARGE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </SelectField>
          <div className="cm-field mn-minmax">
            <TextField
              label="Mínimo"
              inputMode="numeric"
              value={min}
              onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))}
            />
            <TextField
              label="Máximo"
              inputMode="numeric"
              value={max}
              error={rangeErr}
              onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <p className="cm-hint mn-note">
            {GROUP_KIND[kind].hint}{' '}
            {minN > 0 ? 'Obrigatório: o pedido só segue com a escolha feita.' : 'Opcional.'}
          </p>
          {!isNew && (
            <span className="cm-label-row cm-form__wide">
              <label className="mn-check">
                <input
                  type="checkbox"
                  checked={!active}
                  onChange={(e) => setActive(!e.target.checked)}
                />
                Pausar o grupo (some do PDV, do garçom e do cardápio online)
              </label>
              <HelpTip label="Pausar o grupo" />
            </span>
          )}

          <h3 className="cm-form__section cm-sec-help">
            Opções do grupo <HelpTip label="Opções do grupo" />
          </h3>
          <div className="mn-opts cm-form__wide">
            <div className="mn-opts__head" aria-hidden>
              <span>Opção</span>
              <span>Preço</span>
              <span>Padrão</span>
              <span>Disponível</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div key={r.key} className="mn-opts__row">
                <input
                  className="cm-input"
                  aria-label={`Opção ${i + 1}`}
                  placeholder={free ? 'Ex.: Sem cebola' : 'Ex.: Bacon'}
                  value={r.name}
                  maxLength={80}
                  onChange={(e) =>
                    setRows((x) =>
                      x.map((y) => (y.key === r.key ? { ...y, name: e.target.value } : y)),
                    )
                  }
                />
                <input
                  className="cm-input cm-num"
                  aria-label={`Preço adicional ${i + 1}`}
                  inputMode="decimal"
                  placeholder="R$ 0,00"
                  disabled={free}
                  value={r.price}
                  aria-invalid={priceErr(r) || undefined}
                  onChange={(e) =>
                    setRows((x) =>
                      x.map((y) => (y.key === r.key ? { ...y, price: e.target.value } : y)),
                    )
                  }
                />
                <label className="mn-opts__check">
                  <input
                    type="checkbox"
                    aria-label={`Padrão ${i + 1}`}
                    checked={r.isDefault}
                    onChange={(e) =>
                      setRows((x) =>
                        x.map((y) => (y.key === r.key ? { ...y, isDefault: e.target.checked } : y)),
                      )
                    }
                  />
                  <span className="mn-opts__label">Padrão</span>
                </label>
                <label className="mn-opts__check">
                  <input
                    type="checkbox"
                    aria-label={`Disponível ${i + 1}`}
                    checked={r.active}
                    onChange={(e) =>
                      setRows((x) =>
                        x.map((y) => (y.key === r.key ? { ...y, active: e.target.checked } : y)),
                      )
                    }
                  />
                  <span className="mn-opts__label">Disponível</span>
                </label>
                <span className="mn-opts__tools">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Subir opção"
                    icon={<ArrowUp size={14} />}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Descer opção"
                    icon={<ArrowDown size={14} />}
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Remover opção"
                    icon={<Trash2 size={14} />}
                    disabled={rows.length === 1}
                    onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}
                  />
                </span>
              </div>
            ))}
            {defaults > maxN && (
              <span className="cm-error-text">
                Há mais opções padrão ({defaults}) do que o máximo ({maxN}).
              </span>
            )}
            <div>
              <Button
                variant="secondary"
                icon={<Plus size={14} />}
                onClick={() => setRows((x) => [...x, emptyRow()])}
              >
                Mais uma opção
              </Button>
            </div>
            {charge !== 'sum' && !free && filled.length > 1 && (
              <p className="cm-hint" style={{ margin: 0 }}>
                Exemplo: escolhendo {filled[0]!.name || 'a 1ª'} e {filled[1]!.name || 'a 2ª'}, o
                cliente paga {charge === 'max' ? 'só a mais cara' : 'a média das duas'}.
              </p>
            )}
          </div>

          <h3 className="cm-form__section">Itens que usam este grupo ({usedBy.length})</h3>
          <div className="mn-picker cm-form__wide">
            <div className="mn-search mn-search--flat">
              <Search size={16} aria-hidden />
              <input
                className="cm-input"
                type="search"
                aria-label="Buscar item para o grupo"
                placeholder="Buscar item"
                value={pickSearch}
                onChange={(e) => setPickSearch(e.target.value)}
              />
            </div>
            <div className="mn-picker__list">
              {pickable.map((p) => (
                <label key={p.id} className="mn-check">
                  <input
                    type="checkbox"
                    checked={usedBy.includes(p.id)}
                    onChange={(e) =>
                      setUsedBy((u) =>
                        e.target.checked ? [...u, p.id] : u.filter((x) => x !== p.id),
                      )
                    }
                  />
                  <span>{p.name}</span>
                  <span className="cm-hint">{brl(p.price)}</span>
                </label>
              ))}
              {!pickable.length && <span className="cm-hint">Nenhum item.</span>}
            </div>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      </Modal>
    </HelpScope>
  );
}
