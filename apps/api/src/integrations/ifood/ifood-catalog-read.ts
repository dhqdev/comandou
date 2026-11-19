import { fromCents } from '@comandou/shared';

/**
 * Leitura do cardápio que está no iFood (ADR 0015, Fase 6). Só tradução e comparação, sem rede.
 *
 * O iFood devolve as categorias em `GET /catalogs/{catalogId}/categories` e os itens de cada uma,
 * no formato "normalizado", em `GET /categories/{categoryId}/items`:
 * `{ items: [{ id, categoryId, status, price: { value }, externalCode, productId }],
 *    products: [{ id, name, description, imagePath, optionGroups: [{ id, min, max }] }],
 *    optionGroups: [{ id, name, status, optionIds }],
 *    options: [{ id, productId, status, price: { value } }] }`
 * (o mesmo desenho do `PUT /items`). Campo faltando não derruba a leitura.
 */

export interface RemoteOption {
  id: string;
  productId: string;
  name: string;
  /** Decimal em reais ("2.50"). */
  price: string;
  available: boolean;
}
export interface RemoteGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  options: RemoteOption[];
}
export interface RemoteItem {
  id: string;
  categoryId: string;
  categoryName: string;
  productId: string;
  name: string;
  description: string | null;
  externalCode: string | null;
  available: boolean;
  price: string;
  /** Preço como número, para comparar com o que mandamos (`offerHashOf`). */
  priceValue: number;
  groups: RemoteGroup[];
}

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const money = (v: unknown) => {
  const n = Number((v as Obj | undefined)?.value ?? v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};
const decimal = (n: number) => fromCents(Math.round(n * 100));
const up = (v: unknown) => str(v).toUpperCase() !== 'UNAVAILABLE';
const int = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : d;
};

/** Itens de uma categoria (resposta de `/categories/{id}/items`) no formato do Comandou. */
export function categoryItems(category: { id: string; name: string }, body: unknown): RemoteItem[] {
  const b = (body ?? {}) as Obj;
  const products = new Map(arr(b.products).map((p) => [str(p.id), p]));
  const groups = new Map(arr(b.optionGroups).map((g) => [str(g.id), g]));
  const options = new Map(arr(b.options).map((o) => [str(o.id), o]));
  const out: RemoteItem[] = [];
  for (const it of arr(b.items)) {
    const id = str(it.id);
    const product = products.get(str(it.productId)) ?? {};
    const name = str(product.name, 100) || str(it.name, 100);
    if (!id || !name) continue;
    const value = money(it.price);
    out.push({
      id,
      categoryId: category.id,
      categoryName: category.name.slice(0, 80),
      productId: str(it.productId),
      name,
      description: str(product.description, 1000) || null,
      externalCode: str(it.externalCode, 100) || str(product.externalCode, 100) || null,
      available: up(it.status),
      price: decimal(value),
      priceValue: value,
      groups: arr(product.optionGroups)
        .map((link) => {
          const g = groups.get(str(link.id));
          if (!g) return null;
          const opts = arr(g.optionIds)
            .map((oid) => options.get(String(oid)))
            .filter((o): o is Obj => !!o)
            .map((o) => ({
              id: str(o.id),
              productId: str(o.productId),
              name: str(products.get(str(o.productId))?.name, 80) || str(o.name, 80),
              price: decimal(money(o.price)),
              available: up(o.status),
            }))
            .filter((o) => o.id && o.name);
          if (!opts.length) return null;
          const max = Math.min(Math.max(int(link.max, 1), 1), 50);
          return {
            id: str(g.id),
            name: str(g.name, 80) || 'Complementos',
            min: Math.min(int(link.min, 0), max),
            max,
            options: opts.slice(0, 100),
          };
        })
        .filter((g): g is RemoteGroup => !!g)
        .slice(0, 30),
    });
  }
  return out;
}

/** O que mandamos de um item (linha do `ifood_sync_map` + o item como está no Comandou). */
export interface SentItem {
  localId: string;
  remoteId: string;
  name: string;
  /** Preço do Comandou hoje (decimal). */
  price: string;
  /** Impressão do preço que mandamos por último. */
  offerHash: string | null;
  /** Disponibilidade que mandamos por último. */
  available: boolean;
}

export type DriftField = 'price' | 'status' | 'name' | 'missing';

export interface DriftItem {
  localId: string;
  name: string;
  changes: { field: DriftField; remote: string | null; local: string | null }[];
}

/**
 * Compara o cardápio do iFood com o que o Comandou mandou: preço, disponibilidade e nome mudados
 * no portal, e item que sumiu de lá. O que não veio do Comandou volta em `onlyRemote` (para
 * trazer). `offerHash` compara o preço exatamente como foi enviado.
 */
export function menuDrift(
  remote: RemoteItem[],
  sent: SentItem[],
  offerHashOf: (value: number) => string,
  ownCodes: Set<string>,
) {
  const byId = new Map(remote.map((r) => [r.id, r]));
  const changed: DriftItem[] = [];
  for (const s of sent) {
    const r = byId.get(s.remoteId);
    if (!r) {
      // Item que deixamos indisponível e alguém apagou no portal: nada a avisar.
      if (s.available)
        changed.push({
          localId: s.localId,
          name: s.name,
          changes: [{ field: 'missing', remote: null, local: s.name }],
        });
      continue;
    }
    const changes: DriftItem['changes'] = [];
    if (s.offerHash && offerHashOf(r.priceValue) !== s.offerHash)
      changes.push({ field: 'price', remote: r.price, local: s.price });
    if (r.available !== s.available)
      changes.push({
        field: 'status',
        remote: r.available ? 'available' : 'unavailable',
        local: s.available ? 'available' : 'unavailable',
      });
    if (r.name.trim().toLowerCase() !== s.name.trim().toLowerCase().slice(0, 100))
      changes.push({ field: 'name', remote: r.name, local: s.name });
    if (changes.length) changed.push({ localId: s.localId, name: s.name, changes });
  }
  const mine = new Set(sent.map((s) => s.remoteId));
  const onlyRemote = remote.filter(
    (r) => !mine.has(r.id) && !(r.externalCode && ownCodes.has(r.externalCode)),
  );
  return { changed, onlyRemote };
}
