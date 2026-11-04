import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert } from '../../design-system';
import { TourButton } from '../../features/tour/PageTour';
import { api } from '../../lib/api';
import { useDebounced, useRealtime } from '../../lib/realtime';
import type { StockFactor, StockItem, StockMovement, StockUnit } from '../../lib/types';

export const UNITS: [StockUnit, string][] = [
  ['un', 'unidade'],
  ['kg', 'quilo'],
  ['g', 'grama'],
  ['l', 'litro'],
  ['ml', 'mililitro'],
];

export const KIND_LABEL: Record<StockMovement['kind'], string> = {
  purchase: 'Entrada',
  adjustment: 'Contagem',
  sale: 'Venda',
  sale_reversal: 'Estorno de venda',
  loss: 'Perda',
  production: 'Produção',
  withdrawal: 'Saída avulsa',
};
export const KIND_TONE: Record<
  StockMovement['kind'],
  'success' | 'info' | 'neutral' | 'danger' | 'warning'
> = {
  purchase: 'success',
  adjustment: 'info',
  sale: 'neutral',
  sale_reversal: 'neutral',
  loss: 'danger',
  production: 'info',
  withdrawal: 'warning',
};

/** Rótulo do movimento ("Inventário" quando a contagem veio de uma sessão de inventário). */
export const kindLabel = (m: StockMovement) => (m.countId ? 'Inventário' : KIND_LABEL[m.kind]);

/** De onde veio o movimento, em texto curto ("Recebimento REC-000003", "Pedido #12"). */
export function originLabel(m: StockMovement) {
  if (m.orderNumber) return `Pedido #${m.orderNumber}`;
  if (m.receiptCode) return `Recebimento ${m.receiptCode}`;
  if (m.productionCode) return `Produção ${m.productionCode}`;
  return m.note ?? '—';
}

/** Insumos do estoque, recarregando sozinho quando alguém mexe no estoque. */
export function useStockItems() {
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setItems(await api<StockItem[]>('/stock/items'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'stock.changed') reload();
  }, load);
  return { items, error, reload: load };
}

/**
 * Cabeçalho de cada seção do Estoque: o nome e, logo embaixo, para que ela serve, em uma ou
 * duas frases. Ações (ex.: "Novo recebimento") ficam à direita.
 */
export function StockHead({
  title,
  children,
  actions,
  error,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  error?: string | null;
}) {
  return (
    <>
      <div className="page-head st-head">
        <div>
          <span className="st-head__eyebrow">Estoque</span>
          <h1 className="page-title">{title}</h1>
          <p className="page-sub">{children}</p>
        </div>
        <div className="st-head__actions">
          <TourButton tour="estoque" />
          {actions}
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </>
  );
}

/** Unidade de entrada no recebimento: a própria unidade do insumo, uma vizinha (g↔kg) ou um fator. */
export interface EntryUnit {
  key: string;
  label: string;
  /** Quanto 1 dessa unidade vale na unidade de controle do insumo. */
  factor: string;
}
const NEIGHBOR: Partial<Record<StockUnit, [StockUnit, string]>> = {
  kg: ['g', '0.001'],
  g: ['kg', '1000'],
  l: ['ml', '0.001'],
  ml: ['l', '1000'],
};
export function entryUnits(item: StockItem | undefined, factors: StockFactor[]): EntryUnit[] {
  if (!item) return [];
  const out: EntryUnit[] = [{ key: item.unit, label: item.unit, factor: '1' }];
  const n = NEIGHBOR[item.unit];
  if (n) out.push({ key: n[0], label: n[0], factor: n[1] });
  for (const f of factors) {
    if (f.unit !== item.unit || (f.stockItemId && f.stockItemId !== item.id)) continue;
    // O fator específico do insumo vale mais que o geral de mesma sigla.
    const key = `f:${f.code.toUpperCase()}`;
    const at = out.findIndex((u) => u.key === key);
    const unit = { key, label: f.code, factor: f.factor };
    if (at < 0) out.push(unit);
    else if (f.stockItemId) out[at] = unit;
  }
  return out;
}

/** Dias até a validade (negativo = vencido); null sem validade. */
export function daysToExpiry(expiresOn: string | null, today = new Date()) {
  if (!expiresOn) return null;
  const [y, m, d] = expiresOn.split('-').map(Number) as [number, number, number];
  const end = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end - now) / 86400000);
}
