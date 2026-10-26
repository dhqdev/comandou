import { formatBRL } from '@comandou/shared';
import { ClipboardCheck, History } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  TextField,
  useToast,
} from '../design-system';
import { dateTime } from '../features/format';
import { fmtQty, parseQtyInput, SelectField } from '../features/forms';
import { agoLabel, milliToQty, toMilli, valueCents } from '../features/stock-math';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import type { StockCount, StockItem } from '../lib/types';

/**
 * Inventário (contagem em lote): a equipe digita o que contou de cada insumo, vê na hora a
 * diferença em quantidade e em R$, e conclui tudo de uma vez. Só os insumos preenchidos entram;
 * os que batem com o sistema ficam marcados como conferidos.
 */
export function InventoryTab({
  items,
  canWrite,
  onChanged,
}: {
  items: StockItem[];
  canWrite: boolean;
  onChanged(): void;
}) {
  const toast = useToast();
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [category, setCategory] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [note, setNote] = useState('Inventário');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<StockCount[] | null>(null);

  const loadHistory = useCallback(async () => {
    setHistory(await api<StockCount[]>('/stock/counts').catch(() => []));
  }, []);
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const active = items.filter((i) => i.active);
  const categories = useMemo(
    () => [...new Set(active.map((i) => i.category ?? 'Sem categoria'))].sort(),
    [active],
  );
  const rows = active
    .filter((i) => !category || (i.category ?? 'Sem categoria') === category)
    .map((i) => {
      const raw = counted[i.id] ?? '';
      const q = raw ? parseQtyInput(raw) : undefined;
      const delta = q ? toMilli(q) - toMilli(i.quantity) : 0;
      return { item: i, raw, q, delta, value: q ? valueCents(delta, i.avgCost) : 0 };
    });
  // Agrupado por categoria, como a equipe anda pelo estoque (câmara fria, seco, bebidas…).
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (onlyDiff && (!r.q || r.delta === 0)) continue;
    const k = r.item.category ?? 'Sem categoria';
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const all = active.map((i) => {
    const raw = counted[i.id] ?? '';
    const q = raw ? parseQtyInput(raw) : undefined;
    const delta = q ? toMilli(q) - toMilli(i.quantity) : 0;
    return { item: i, q, delta, value: q ? valueCents(delta, i.avgCost) : 0 };
  });
  const filled = all.filter((r) => r.q);
  const invalid = all.some((r) => r.q === null);
  const changed = filled.filter((r) => r.delta !== 0);
  const total = changed.reduce((s, r) => s + r.value, 0);
  const valid = filled.length > 0 && !invalid && note.trim().length >= 3;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<StockCount>('/stock/counts', {
        method: 'POST',
        json: {
          note: note.trim(),
          lines: filled.map((x) => ({ stockItemId: x.item.id, quantity: x.q })),
        },
      });
      toast(
        r.itemsChanged
          ? `Inventário concluído: ${r.itemsChanged} ajuste(s)`
          : 'Inventário concluído: tudo conferido',
        'success',
      );
      setCounted({});
      setConfirm(false);
      onChanged();
      await loadHistory();
    } catch (e) {
      setError((e as Error).message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card
        title="Contagem de inventário"
        actions={
          <Button
            variant="ghost"
            onClick={() =>
              setCounted((c) => {
                const next = { ...c };
                for (const r of rows)
                  if (!next[r.item.id]) next[r.item.id] = fmtQty(r.item.quantity).replace('-', '');
                return next;
              })
            }
            disabled={!canWrite}
          >
            Preencher com o saldo do sistema
          </Button>
        }
        bodyless
      >
        <div className="st-toolbar">
          <SelectField
            label="Setor / categoria"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Todos</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
          <label className="st-inline-check">
            <input
              type="checkbox"
              checked={onlyDiff}
              onChange={(e) => setOnlyDiff(e.target.checked)}
            />
            Só com diferença
          </label>
        </div>
        {error && (
          <div className="cm-card__body">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
        {active.length === 0 ? (
          <EmptyState icon={<ClipboardCheck size={20} />} title="Nenhum insumo ativo para contar" />
        ) : (
          <div className="st-count">
            {[...groups.entries()].map(([g, list]) => (
              <section key={g} className="st-count__group">
                <h3 className="st-count__title">
                  {g} <span>{list.length}</span>
                </h3>
                {list.map((r) => (
                  <div
                    key={r.item.id}
                    className="st-count__row"
                    data-diff={r.q && r.delta !== 0 ? (r.delta < 0 ? 'neg' : 'pos') : undefined}
                  >
                    <div className="st-count__name">
                      <strong>{r.item.name}</strong>
                      <span className="cm-hint">
                        Sistema: {fmtQty(r.item.quantity)} {r.item.unit} · contado{' '}
                        {agoLabel(r.item.countedAt)}
                      </span>
                    </div>
                    <TextField
                      label={`Contado (${r.item.unit})`}
                      inputMode="decimal"
                      placeholder={fmtQty(r.item.quantity).replace('-', '')}
                      value={r.raw}
                      disabled={!canWrite}
                      error={r.q === null ? 'Até 3 casas' : undefined}
                      onChange={(e) => setCounted((c) => ({ ...c, [r.item.id]: e.target.value }))}
                      wrapClass="st-count__input"
                    />
                    <div className="st-count__diff">
                      {r.q ? (
                        r.delta === 0 ? (
                          <Badge tone="success">confere</Badge>
                        ) : (
                          <>
                            <strong>
                              {r.delta > 0 ? '+' : ''}
                              {fmtQty(milliToQty(r.delta))} {r.item.unit}
                            </strong>
                            <span>{formatBRL(r.value)}</span>
                          </>
                        )
                      ) : (
                        <span className="cm-hint">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
        {canWrite && (
          <div className="st-count__footer">
            <div className="st-count__totals">
              <div>
                <span>Contados</span>
                <strong>{filled.length}</strong>
              </div>
              <div>
                <span>Com diferença</span>
                <strong>{changed.length}</strong>
              </div>
              <div data-tone={total < 0 ? 'danger' : total > 0 ? 'success' : undefined}>
                <span>Diferença em R$</span>
                <strong>{formatBRL(total)}</strong>
              </div>
            </div>
            <TextField
              label="Descrição"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              wrapClass="st-count__note"
            />
            <Button
              disabled={!valid}
              onClick={() => setConfirm(true)}
              icon={<ClipboardCheck size={16} />}
            >
              Concluir inventário
            </Button>
          </div>
        )}
      </Card>

      <Card title="Inventários anteriores" bodyless>
        {history === null ? null : history.length === 0 ? (
          <EmptyState icon={<History size={20} />} title="Nenhum inventário ainda" />
        ) : (
          <div className="st-scroll">
            <table className="cm-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Descrição</th>
                  <th className="cm-num">Contados</th>
                  <th className="cm-num">Ajustados</th>
                  <th className="cm-num">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {history.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {dateTime(c.createdAt)}
                      {c.createdByName && <div className="cm-hint">{c.createdByName}</div>}
                    </td>
                    <td>{c.note}</td>
                    <td className="cm-num">{c.itemsCounted}</td>
                    <td className="cm-num">{c.itemsChanged}</td>
                    <td className="cm-num">
                      <span
                        className="st-delta"
                        data-neg={c.valueDelta.startsWith('-') || undefined}
                      >
                        {brl(c.valueDelta)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {confirm && (
        <Modal
          open
          title="Concluir inventário"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(false)}>
                Voltar
              </Button>
              <Button loading={busy} onClick={submit}>
                Ajustar estoque
              </Button>
            </>
          }
        >
          <div className="st-form">
            <p style={{ margin: 0 }}>
              {filled.length} insumo(s) contado(s). {changed.length} terão o saldo ajustado para o
              valor contado; os demais ficam marcados como conferidos.
            </p>
            {changed.length > 0 && (
              <ul className="st-confirm-list">
                {changed.map((r) => (
                  <li key={r.item.id}>
                    <span>{r.item.name}</span>
                    <strong className="st-delta" data-neg={r.delta < 0 || undefined}>
                      {r.delta > 0 ? '+' : ''}
                      {fmtQty(milliToQty(r.delta))} {r.item.unit} · {formatBRL(r.value)}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
            <Alert tone={total < 0 ? 'warning' : 'info'}>
              Diferença total: {formatBRL(total)}
              {total < 0 ? ' (faltou mercadoria)' : total > 0 ? ' (sobrou mercadoria)' : ''}.
            </Alert>
          </div>
        </Modal>
      )}
    </>
  );
}
