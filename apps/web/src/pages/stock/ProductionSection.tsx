import { formatBRL } from '@comandou/shared';
import { Factory, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { Alert, Badge, Button, Card, EmptyState, TextField, useToast } from '../../design-system';
import { useCan } from '../../app/auth';
import { dateTime } from '../../features/format';
import { fmtDate, fmtQty, parseQtyInput, SelectField, todayIso } from '../../features/forms';
import { fmtCost, milliToQty, toMilli } from '../../features/stock-math';
import { api } from '../../lib/api';
import { brl } from '../../lib/money';
import { useRealtime } from '../../lib/realtime';
import type { PrepRecipeLine, StockItem, StockProduction } from '../../lib/types';
import { StockHead, useStockItems } from './common';

interface Line {
  key: number;
  stockItemId: string;
  quantity: string;
  expiresOn: string;
  lotCode: string;
}

/**
 * Produção: registrar o que a cozinha preparou (molho, massa, recheio…). Cada linha baixa os
 * insumos da ficha de preparo e dá entrada no preparo, com lote e validade.
 */
export function ProductionSection() {
  const canWrite = useCan('stock:write');
  const toast = useToast();
  const { items, error } = useStockItems();
  const [recipes, setRecipes] = useState<PrepRecipeLine[]>([]);
  const [history, setHistory] = useState<StockProduction[] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [scan, setScan] = useState('');
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const seq = useRef(0);
  const scanRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [r, h] = await Promise.all([
      api<PrepRecipeLine[]>('/stock/item-recipes').catch(() => []),
      api<StockProduction[]>('/stock/productions').catch(() => []),
    ]);
    setRecipes(r);
    setHistory(h);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'stock.changed') void load();
  }, load);

  const byId = new Map((items ?? []).map((i) => [i.id, i]));
  const preps = (items ?? []).filter((i) => i.active && i.hasPrep);
  const others = (items ?? []).filter((i) => i.active && !i.hasPrep);

  const defaultExpiry = (it: StockItem | undefined) =>
    it?.shelfLifeDays ? todayIso(it.shelfLifeDays) : '';
  const addLine = (it?: StockItem) => {
    seq.current += 1;
    const key = seq.current;
    setLines((ls) => [
      ...ls,
      {
        key,
        stockItemId: it?.id ?? '',
        quantity: '',
        expiresOn: defaultExpiry(it),
        lotCode: '',
      },
    ]);
    // Foco vai para a quantidade da linha nova.
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(`[data-prod-qty="${key}"]`)?.focus(),
    );
  };
  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function onScan(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = scan.trim().toUpperCase();
    if (!code) return;
    const it = (items ?? []).find(
      (i) => i.active && (i.code.toUpperCase() === code || i.barcode === scan.trim()),
    );
    setScan('');
    if (!it) {
      setScanMsg(`Nenhum insumo com o código "${scan.trim()}"`);
      return;
    }
    setScanMsg(null);
    addLine(it);
  }

  // O que a produção inteira vai gastar, somado por insumo.
  const parsed = lines.map((l) => ({ ...l, q: parseQtyInput(l.quantity) }));
  const usage = new Map<string, number>();
  const lineCost = (l: (typeof parsed)[number]) => {
    const it = byId.get(l.stockItemId);
    if (!it || !l.q) return null;
    const mine = recipes.filter((r) => r.itemId === it.id);
    if (!mine.length) return null;
    const ratio = toMilli(l.q) / toMilli(it.recipeYield);
    return mine.reduce((s, r) => {
      const ing = byId.get(r.stockItemId);
      return s + (ing ? (toMilli(r.quantity) / 1000) * ratio * Number(ing.avgCost) * 100 : 0);
    }, 0);
  };
  for (const l of parsed) {
    const it = byId.get(l.stockItemId);
    if (!it || !l.q) continue;
    const ratio = toMilli(l.q) / toMilli(it.recipeYield);
    for (const r of recipes.filter((x) => x.itemId === it.id)) {
      usage.set(
        r.stockItemId,
        (usage.get(r.stockItemId) ?? 0) + Math.round(toMilli(r.quantity) * ratio),
      );
    }
  }
  const short = [...usage.entries()]
    .map(([id, need]) => ({ it: byId.get(id), need }))
    .filter((x) => x.it && !x.it.allowNegative && toMilli(x.it.quantity) < x.need);
  const valid =
    lines.length > 0 &&
    parsed.every((l) => l.stockItemId && l.q && Number(l.q) > 0) &&
    short.length === 0;
  const hint =
    lines.length === 0
      ? 'Bipe a primeira etiqueta ou adicione uma linha.'
      : short.length
        ? `Falta ${short.map((s) => s.it!.name).join(', ')}`
        : !valid
          ? 'Escolha o preparo e a quantidade de cada linha.'
          : null;

  async function confirm() {
    setBusy(true);
    setFail(null);
    try {
      const out = await api<{ code: string }[]>('/stock/productions', {
        method: 'POST',
        json: {
          lines: parsed.map((l) => ({
            stockItemId: l.stockItemId,
            quantity: l.q,
            expiresOn: l.expiresOn || null,
            lotCode: l.lotCode.trim() || undefined,
          })),
        },
      });
      toast(
        out.length === 1
          ? `Produção ${out[0]!.code} registrada`
          : `${out.length} produções registradas`,
        'success',
      );
      setLines([]);
      void load();
      scanRef.current?.focus();
    } catch (e) {
      setFail((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-page">
      <StockHead
        title="Produção"
        error={error}
        actions={
          canWrite && (
            <div className="st-head__confirm">
              {hint && <span className="st-head__hint">{hint}</span>}
              <Button loading={busy} disabled={!valid} onClick={confirm}>
                Confirmar produção
              </Button>
            </div>
          )
        }
      >
        Registre o que a cozinha preparou (molho, massa, recheio). Cada linha baixa os insumos da
        ficha de preparo, dá entrada no preparo com o custo do que foi gasto e cria o lote com a
        validade.
      </StockHead>
      {fail && <Alert tone="danger">{fail}</Alert>}
      {canWrite && (
        <Card>
          <div className="st-scan">
            <TextField
              ref={scanRef}
              label="Bipar etiqueta"
              placeholder="Bipe ou digite o código do preparo e tecle Enter"
              value={scan}
              autoFocus
              error={scanMsg ?? undefined}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={onScan}
            />
            <p className="cm-hint">
              Cada bipada cria uma linha com o preparo e a validade padrão, e o foco vai para a
              quantidade. Preparo sem etiqueta (granel) entra por &quot;Adicionar linha&quot;.
            </p>
            <Button variant="secondary" icon={<Plus size={16} />} onClick={() => addLine()}>
              Adicionar linha
            </Button>
          </div>
        </Card>
      )}
      {lines.length > 0 && (
        <Card bodyless>
          <div className="st-scroll">
            <table className="cm-table st-table st-prod">
              <thead>
                <tr>
                  <th>Preparo</th>
                  <th>Quantidade</th>
                  <th>Validade</th>
                  <th>Lote (opcional)</th>
                  <th className="cm-num">Custo</th>
                  <th aria-label="Remover" />
                </tr>
              </thead>
              <tbody>
                {parsed.map((l) => {
                  const it = byId.get(l.stockItemId);
                  const cost = lineCost(l);
                  return (
                    <tr key={l.key}>
                      <td>
                        <SelectField
                          label="Preparo"
                          value={l.stockItemId}
                          onChange={(e) => {
                            const next = byId.get(e.target.value);
                            setLine(l.key, {
                              stockItemId: e.target.value,
                              expiresOn: defaultExpiry(next),
                            });
                          }}
                        >
                          <option value="">Escolha…</option>
                          {preps.length > 0 && (
                            <optgroup label="Com ficha de preparo">
                              {preps.map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.name} ({i.unit})
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="Sem ficha (só dá entrada)">
                            {others.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({i.unit})
                              </option>
                            ))}
                          </optgroup>
                        </SelectField>
                        {it && !it.hasPrep && (
                          <span className="cm-hint">
                            Sem ficha de preparo: não baixa insumos.{' '}
                            <Link to={`/estoque/insumos/${it.id}`}>Montar ficha</Link>
                          </span>
                        )}
                      </td>
                      <td>
                        <TextField
                          label={`Quantidade${it ? ` (${it.unit})` : ''}`}
                          inputMode="decimal"
                          data-prod-qty={l.key}
                          value={l.quantity}
                          error={l.quantity && l.q === null ? 'Até 3 casas' : undefined}
                          onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                        />
                      </td>
                      <td>
                        <TextField
                          label="Validade"
                          type="date"
                          value={l.expiresOn}
                          onChange={(e) => setLine(l.key, { expiresOn: e.target.value })}
                        />
                      </td>
                      <td>
                        <TextField
                          label="Lote"
                          value={l.lotCode}
                          maxLength={40}
                          placeholder="Automático"
                          onChange={(e) => setLine(l.key, { lotCode: e.target.value })}
                        />
                      </td>
                      <td className="cm-num">
                        {cost === null ? (
                          <span className="cm-hint">—</span>
                        ) : (
                          <>
                            <strong>{formatBRL(cost)}</strong>
                            {l.q && Number(l.q) > 0 && (
                              <div className="cm-hint">
                                {fmtCost(cost / 100 / Number(l.q))}/{it?.unit}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="cm-num" data-label="">
                        <Button
                          variant="ghost"
                          aria-label="Remover linha"
                          title="Remover linha"
                          icon={<Trash2 size={16} />}
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {usage.size > 0 && (
            <div className="st-usage">
              <span className="cm-label">Vai gastar</span>
              <ul>
                {[...usage.entries()].map(([id, need]) => {
                  const ing = byId.get(id);
                  if (!ing) return null;
                  const lacks = !ing.allowNegative && toMilli(ing.quantity) < need;
                  return (
                    <li key={id} data-short={lacks || undefined}>
                      {ing.name}: {fmtQty(milliToQty(need))} {ing.unit}
                      <span className="cm-hint">
                        {' '}
                        (tem {fmtQty(ing.quantity)} {ing.unit})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      )}
      {lines.length === 0 && (
        <p className="cm-hint" style={{ margin: 0 }}>
          Nenhuma linha ainda: bipe a primeira etiqueta ou use &quot;Adicionar linha&quot;.
        </p>
      )}
      <Card title="Produções recentes" bodyless>
        {!history || history.length === 0 ? (
          <EmptyState
            icon={<Factory size={20} />}
            title="Nenhuma produção registrada"
            description="Monte a ficha de preparo do insumo (Visão geral › insumo › Ficha de preparo) e registre a primeira produção."
          />
        ) : (
          <div className="st-scroll">
            <table className="cm-table st-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Preparo</th>
                  <th className="cm-num">Quantidade</th>
                  <th className="cm-num">Custo</th>
                  <th>Lote</th>
                  <th>Validade</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 50).map((p) => (
                  <tr key={p.id}>
                    <td>
                      {dateTime(p.createdAt)}
                      {p.createdByName && <div className="cm-hint">{p.createdByName}</div>}
                    </td>
                    <td>
                      <div className="st-name">
                        <Link to={`/estoque/insumos/${p.stockItemId}`} className="st-name__link">
                          {p.itemName}
                        </Link>
                        <span className="st-name__meta st-code">{p.code}</span>
                      </div>
                    </td>
                    <td className="cm-num">
                      {fmtQty(p.quantity)} {p.unit}
                    </td>
                    <td className="cm-num">
                      {p.totalCost ? brl(p.totalCost) : <Badge>sem ficha</Badge>}
                    </td>
                    <td>{p.lotCode ?? '—'}</td>
                    <td>{p.expiresOn ? fmtDate(p.expiresOn) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
