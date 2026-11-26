import type { ChargeRule, MenuKind, OptionGroupKind } from '@comandou/shared';

/** Família de itens: agrupa as vendas nos relatórios. */
export interface Family {
  id: string;
  name: string;
  active: boolean;
  countsAsProduct: boolean;
  items: number;
}

/** Cardápio (Principal = balcão e salão; Delivery = entrega e retirada). */
export interface MenuDef {
  id: string;
  name: string;
  kind: MenuKind;
  active: boolean;
  items: number;
  customPrices: number;
  updatedAt?: string;
  /** Cardápio de integração: a loja do iFood que recebe. */
  ifoodConnectionId?: string | null;
  ifoodMerchantName?: string | null;
  ifoodSyncedAt?: string | null;
  ifoodSyncStatus?: 'running' | 'ok' | 'partial' | 'error' | null;
}

export interface OptionGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  active: boolean;
  kind: OptionGroupKind;
  charge: ChargeRule;
  /** A mesma opção pode ser escolhida mais de uma vez (3 bolas do mesmo sabor). */
  allowRepeat?: boolean;
  productCount: number;
  options: {
    id: string;
    name: string;
    priceDelta: string;
    position: number;
    active: boolean;
    isDefault: boolean;
    description?: string | null;
    imageId?: string | null;
  }[];
}

export interface GroupLink {
  productId: string;
  groupId: string;
  position?: number;
}

export const MENU_KIND: Record<MenuKind, { label: string; where: string }> = {
  principal: { label: 'Principal', where: 'Balcão, salão, garçom e mesa' },
  delivery: { label: 'Delivery', where: 'Entrega, retirada e cardápio online' },
  ifood: { label: 'Integração', where: 'iFood (vai para a loja ligada)' },
};

export const GROUP_KIND: Record<OptionGroupKind, { label: string; hint: string }> = {
  additional: { label: 'Adicional', hint: 'Extras opcionais: bacon, ovo, queijo.' },
  variation: { label: 'Tamanho / variação', hint: 'Escolhe 1: P, M, G ou 300 ml, 500 ml.' },
  flavor: { label: 'Sabores (pizza)', hint: 'Meio a meio: cobra o sabor mais caro ou a média.' },
  remove: { label: 'Retirar ingrediente', hint: 'Sem cebola, sem tomate. Sem custo.' },
};

export const CHARGE: Record<ChargeRule, string> = {
  sum: 'Somar as opções',
  max: 'Cobrar a mais cara',
  average: 'Cobrar a média',
};

/** Unidades de medida mais usadas (vão na NFC-e como unidade comercial). */
export const UNITS: [string, string][] = [
  ['UN', 'Unidade'],
  ['KG', 'Quilo'],
  ['G', 'Grama'],
  ['L', 'Litro'],
  ['ML', 'Mililitro'],
  ['PC', 'Peça'],
  ['PCT', 'Pacote'],
  ['CX', 'Caixa'],
  ['DZ', 'Dúzia'],
  ['LT', 'Lata'],
  ['GF', 'Garrafa'],
  ['PRT', 'Porção'],
];

/** "Onde vale" em minúsculas, sem estragar o nome iFood. */
export const kindWhere = (k: MenuKind) =>
  MENU_KIND[k].where.toLowerCase().replace('ifood', 'iFood');

/** Regra do grupo no cadastro: diz sempre se é Obrigatório (mínimo > 0) ou Opcional. */
export const groupRule = (g: { minSelect: number; maxSelect: number }) =>
  g.minSelect > 0
    ? g.minSelect === g.maxSelect
      ? `Obrigatório, escolhe ${g.minSelect}`
      : `Obrigatório, escolhe de ${g.minSelect} a ${g.maxSelect}`
    : `Opcional, até ${g.maxSelect}`;

/** Diferença percentual de um preço sobre o base ("+10%"), ou null quando é igual. */
export function priceDiff(baseCents: number, cents: number) {
  if (!baseCents || baseCents === cents) return null;
  const pct = ((cents - baseCents) / baseCents) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

/** Valor em reais digitado a partir de "12.90" da API (para preencher campos). */
export const toInput = (v: string | null | undefined) => (v ? v.replace('.', ',') : '');
