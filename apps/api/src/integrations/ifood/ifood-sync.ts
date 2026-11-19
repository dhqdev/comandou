import { createHash, randomUUID } from 'node:crypto';

/**
 * Tradução do cardápio do Comandou para o catálogo v2 do iFood e o plano do que mandar.
 * Só funções puras: o serviço lê o banco, chama o plano e executa as chamadas.
 *
 * Como cada coisa vira no iFood:
 * - categoria ativa com pelo menos um item do cardápio → categoria (template DEFAULT);
 * - item do cardápio → item (oferta: categoria, preço e status) + produto (nome, descrição, foto);
 * - grupo de complementos ativo do item → optionGroup (min/max na ligação com o produto);
 * - opção ativa → option (com preço) + um produto próprio (o nome da opção).
 * Cada item leva os seus grupos (ids próprios por item), para editar um item nunca mexer nos outros.
 * Item que sai do cardápio, é desativado ou esgota fica INDISPONÍVEL no iFood (não apagamos:
 * apagar no iFood leva junto histórico e associações).
 */

export type IfoodStatus = 'AVAILABLE' | 'UNAVAILABLE';

export interface LocalOption {
  id: string;
  name: string;
  priceDelta: string;
}
export interface LocalGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  options: LocalOption[];
}
export interface LocalItem {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  price: string;
  categoryId: string;
  available: boolean;
  imageId: string | null;
  position: number;
  groups: LocalGroup[];
}
export interface LocalCategory {
  id: string;
  name: string;
  position: number;
}

/** Ids no iFood de um item já enviado (guardados em ifood_sync_map.extra). */
export interface ItemIds {
  productId: string;
  groups: Record<string, string>;
  options: Record<string, { id: string; productId: string }>;
}

export interface MapRow {
  remoteId: string;
  extra: Partial<ItemIds>;
  shapeHash: string | null;
  offerHash: string | null;
  status: IfoodStatus;
}

const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);
const hex = (id: string, n = 12) => id.replace(/-/g, '').slice(0, n);
/** Reais decimais para o iFood (numeric "12.90" → 12.9). */
export const reais = (v: string) => Math.round(Number(v) * 100) / 100;
/** Impressão do preço como ele vai ao iFood (a mesma de `fingerprints().offer`). */
export const offerHashOf = (value: number) => hash({ value });

export const itemExternalCode = (i: Pick<LocalItem, 'id' | 'code'>) => i.code ?? `CMD-${hex(i.id)}`;
export const categoryExternalCode = (id: string) => `CAT-${hex(id)}`;

/** Ids do iFood para um item: reaproveita os já enviados e gera os que faltam. */
export function itemIds(
  item: LocalItem,
  prev?: Partial<ItemIds>,
  uuid: () => string = randomUUID,
): ItemIds {
  const groups: Record<string, string> = {};
  const options: Record<string, { id: string; productId: string }> = {};
  for (const g of item.groups) {
    groups[g.id] = prev?.groups?.[g.id] ?? uuid();
    for (const o of g.options)
      options[o.id] = prev?.options?.[o.id] ?? { id: uuid(), productId: uuid() };
  }
  return { productId: prev?.productId ?? uuid(), groups, options };
}

/** Corpo do PUT /items (item + produtos + grupos + opções). */
export function itemPayload(
  item: LocalItem,
  ids: ItemIds,
  itemId: string,
  remoteCategoryId: string,
  imagePath: string | null,
) {
  const code = itemExternalCode(item);
  const groups = item.groups.filter((g) => g.options.length > 0);
  return {
    item: {
      id: itemId,
      type: 'DEFAULT',
      categoryId: remoteCategoryId,
      productId: ids.productId,
      status: (item.available ? 'AVAILABLE' : 'UNAVAILABLE') as IfoodStatus,
      price: { value: reais(item.price) },
      externalCode: code,
      index: item.position,
    },
    products: [
      {
        id: ids.productId,
        externalCode: code,
        name: item.name.slice(0, 100),
        ...(item.description ? { description: item.description.slice(0, 1000) } : {}),
        ...(imagePath ? { imagePath } : {}),
        optionGroups: groups.map((g, index) => ({
          id: ids.groups[g.id]!,
          min: Math.max(0, Math.min(g.min, g.options.length)),
          max: Math.max(1, Math.min(g.max, g.options.length * 10)),
          index,
        })),
      },
      ...groups.flatMap((g) =>
        g.options.map((o) => ({
          id: ids.options[o.id]!.productId,
          externalCode: `OP-${hex(o.id)}`,
          name: o.name.slice(0, 100),
        })),
      ),
    ],
    optionGroups: groups.map((g, index) => ({
      id: ids.groups[g.id]!,
      name: g.name.slice(0, 100),
      status: 'AVAILABLE',
      externalCode: `GR-${hex(g.id)}`,
      optionGroupType: 'INGREDIENTS',
      index,
      optionIds: g.options.map((o) => ids.options[o.id]!.id),
    })),
    options: groups.flatMap((g) =>
      g.options.map((o, index) => ({
        id: ids.options[o.id]!.id,
        productId: ids.options[o.id]!.productId,
        status: 'AVAILABLE',
        externalCode: `OP-${hex(o.id)}`,
        index,
        price: { value: Math.max(0, reais(o.priceDelta)) },
      })),
    ),
  };
}

export type ItemPayload = ReturnType<typeof itemPayload>;

/** Impressões digitais: estrutura (tudo menos preço e status) e oferta (preço). */
export function fingerprints(p: ItemPayload) {
  const { price, status, ...rest } = p.item;
  void status;
  return {
    shape: hash({ ...p, item: rest }),
    offer: hash(price),
  };
}

export type ItemAction =
  | { kind: 'create' | 'update'; local: LocalItem; ids: ItemIds; itemId: string }
  /** Só preço e/ou disponibilidade mudaram: PATCH leve, sem reenviar o item inteiro. */
  | { kind: 'offer'; local: LocalItem; itemId: string; price: boolean; status: IfoodStatus | null }
  | { kind: 'unchanged'; local: LocalItem }
  | { kind: 'unavailable'; localId: string; itemId: string };

/**
 * O que fazer com cada item. `payloadOf` monta o corpo com os ids escolhidos (precisa da
 * categoria do iFood, que o serviço resolve antes).
 */
export function planItems(
  desired: LocalItem[],
  map: Map<string, MapRow>,
  payloadOf: (i: LocalItem, ids: ItemIds, itemId: string) => ItemPayload,
  uuid: () => string = randomUUID,
): ItemAction[] {
  const out: ItemAction[] = [];
  const wanted = new Set(desired.map((i) => i.id));
  for (const local of desired) {
    const prev = map.get(local.id);
    const ids = itemIds(local, prev?.extra, uuid);
    if (!prev) {
      out.push({ kind: 'create', local, ids, itemId: uuid() });
      continue;
    }
    const fp = fingerprints(payloadOf(local, ids, prev.remoteId));
    const status: IfoodStatus = local.available ? 'AVAILABLE' : 'UNAVAILABLE';
    const price = fp.offer !== prev.offerHash;
    const statusChanged = status !== prev.status;
    if (fp.shape !== prev.shapeHash)
      out.push({ kind: 'update', local, ids, itemId: prev.remoteId });
    else if (price || statusChanged)
      out.push({
        kind: 'offer',
        local,
        itemId: prev.remoteId,
        price,
        status: statusChanged ? status : null,
      });
    else out.push({ kind: 'unchanged', local });
  }
  for (const [localId, row] of map) {
    if (!wanted.has(localId) && row.status === 'AVAILABLE')
      out.push({ kind: 'unavailable', localId, itemId: row.remoteId });
  }
  return out;
}

export interface SyncSummary {
  created: number;
  updated: number;
  unchanged: number;
  unavailable: number;
  failed: number;
  errors: { name: string; message: string }[];
  /** Fotos que não foram (só JPG/PNG; WebP é convertida pelo navegador ao sincronizar). */
  imagesPending: number;
}

export const emptySummary = (): SyncSummary => ({
  created: 0,
  updated: 0,
  unchanged: 0,
  unavailable: 0,
  failed: 0,
  errors: [],
  imagesPending: 0,
});

/** Frase do resumo, como aparece na tela. */
export function summaryText(s: SyncSummary) {
  const base = `${s.created} criado(s), ${s.updated} atualizado(s), ${s.unchanged} sem alteração, ${s.unavailable} deixado(s) indisponível(is) no iFood.`;
  return s.failed ? `${base} ${s.failed} com erro.` : base;
}
