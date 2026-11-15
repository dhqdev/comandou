/**
 * Formato de um restaurante de demonstração. Cada demonstração (Casa Brasa, Aurora...) é um
 * objeto destes; seed.ts grava qualquer um deles do mesmo jeito.
 */

export type DemoRole =
  'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen' | 'driver' | 'attendant';

export interface DemoUser {
  key: string;
  /** Parte antes do @ (o domínio vem de quem chama: dono@exemplo.comandou.com). */
  email: string;
  name: string;
  role: DemoRole;
}

export interface DemoSector {
  key: string;
  name: string;
  channels: readonly string[];
  warn: number;
  late: number;
}

export interface DemoCategory {
  key: string;
  name: string;
  image: string;
}

/** Grupo de adicionais. Opções: [nome, acréscimo, insumo da ficha técnica?, quantidade]. */
export interface DemoOptionGroup {
  key: string;
  name: string;
  min: number;
  max: number;
  options: [string, string, string?, number?][];
  /** Linha curta embaixo do nome no cardápio online, por nome da opção. */
  descriptions?: Record<string, string>;
  /** Foto da opção (nome da imagem da demonstração), por nome da opção. */
  images?: Record<string, string>;
}

export interface DemoProduct {
  key: string;
  category: string;
  sector: string;
  name: string;
  description: string;
  price: string;
  image: string;
  /**
   * Modelo 3D de exemplo (nome do arquivo em <imagesDir>/models, sem extensão): <nome>.glb e,
   * se existir, <nome>.usdz para o iPhone.
   */
  model?: string;
  groups?: string[];
  featured?: boolean;
  badge?: string;
  soldOut?: boolean;
  /** Peso na escolha dos pedidos do histórico (mais pedidos = maior). */
  weight: number;
  /** Ficha técnica: insumo → quantidade por unidade vendida. */
  recipe?: Record<string, number>;
  ncm?: string;
}

export interface DemoCustomer {
  name: string;
  phone: string;
  street: string;
  number: string;
  district: string;
  lat: number;
  lng: number;
  notes?: string;
}

export type DemoZone =
  | {
      name: string;
      color: string;
      kind: 'radius';
      radius: number;
      fee: string;
      min: string;
      eta: readonly number[];
    }
  | {
      name: string;
      color: string;
      kind: 'polygon';
      polygon: [number, number][];
      fee: string;
      min: string;
      eta: readonly number[];
    };

export type DemoBanner = {
  title: string;
  subtitle: string;
  tag: string;
  cta: string;
  image: string;
} & ({ product: string } | { category: string } | object);

/** Uma faixa de movimento do dia: começa em [hora, minuto], dura `hours`, com `share` dos pedidos. */
export interface DemoShift {
  start: [number, number];
  hours: number;
  share: number;
}

export interface DemoCatalog {
  /** Nome do restaurante (cadastro e impressão de teste). */
  name: string;
  password: string;
  customerPassword: string;
  /** Pasta com as fotos (manifest.json + <nome>.webp; `logo` e `capa` obrigatórias). */
  imagesDir: string;
  /** Semente dos números aleatórios (mesma semente = mesma operação). */
  seed: number;
  /** Quantos dias de histórico (padrão 30). */
  days?: number;
  /**
   * Movimento crescendo ao longo do histórico: o primeiro dia tem `start` do movimento de hoje
   * (ex.: 0,55) e sobe em linha reta até 1. `months` dá um peso extra por mês (1 = dezembro).
   */
  growth?: { start: number; months?: Partial<Record<number, number>> };
  /** Quantos clientes (os primeiros da lista) têm conta no cardápio online (padrão 16). */
  accounts?: number;
  location: { lat: number; lng: number };
  store: {
    about: string;
    address: string;
    whatsapp: string;
    headline: string;
    featuredTitle: string;
    deliveryFee: string;
    minOrder: string;
    eta: [number, number];
  };
  users: DemoUser[];
  sectors: readonly DemoSector[];
  /** Setor das bebidas (sai antes do resto do pedido). */
  drinkSector: string;
  categories: readonly DemoCategory[];
  optionGroups: DemoOptionGroup[];
  products: DemoProduct[];
  /** Que categorias montam cada parte de um pedido simulado. */
  basket: { mains: string[]; sides: string[]; drinks: string[]; sweets: string[] };
  /** Chance de um pedido levar acompanhamento e sobremesa. */
  basketOdds?: { side: number; sweet: number };
  /** Insumos: [nome, unidade, mínimo, custo médio, estoque alvo após cada compra]. */
  stockItems: Record<string, [string, 'un' | 'kg' | 'l', number, string, number]>;
  stockCategory: Record<string, string>;
  /** Insumos que ficam abaixo do mínimo no fim (para o alerta aparecer). */
  lowStock: string[];
  /** Perdas: [insumo, quantidade, há quantos dias, motivo]. */
  losses: [string, number, number, string][];
  /** Ajuste do inventário semanal: [insumo, diferença]. */
  adjustments: [string, number][];
  /** Lotes com validade: [insumo, quantidade, fabricado há (dias), validade (dias)]. */
  lots: [string, string, number, number][];
  /** Insumo comprado em pacote com 24 (fator de conversão). */
  packItem: string;
  tables: { label: string; seats: number; area: string; shape?: 'square' | 'round' | 'rect' }[];
  /** O entregador sem usuário (user null) ganha o link de freelancer. */
  couriers: readonly { key: string; name: string; phone: string; user: string | null }[];
  customers: DemoCustomer[];
  walkIn: string[];
  itemNotes: string[];
  zones: DemoZone[];
  banners: readonly DemoBanner[];
  monthlyBills: [string, string, string, string, number][];
  suppliers: [string, string, string][];
  /** Receitas avulsas: [descrição, categoria, quem paga, valor, vencimento em dias atrás (negativo = no futuro)]. */
  extraReceivables: [string, string, string, string, number][];
  /** Conta cancelada: [descrição, categoria, fornecedor, valor, motivo]. */
  cancelledBill: [string, string, string, string, string];
  /** Pedidos por dia da semana (domingo a sábado; 0 = fechado). */
  busy: number[];
  shifts: DemoShift[];
  /** Abertura do caixa, sangria e fechamento: [hora, minuto]. */
  hours: { open: [number, number]; withdrawal: [number, number]; close: [number, number] };
  /** Parte dos pedidos por canal: mesa, balcão, entrega (o resto é retirada). */
  channelMix: { table: number; counter: number; delivery: number };
  prepMin: [number, number];
  /** Clientes (pelo nome) que aparecem nos pedidos "agora" da tela ao vivo. */
  liveCustomers: string[];
  /** Mesas (rótulos) com comanda aberta agora. */
  liveTables: [string, string, string, string];
  /** Dados do painel da plataforma (cadastro, assinatura e contrato). Só a Aurora tem. */
  platform?: {
    legalName: string;
    /** CNPJ só com números. */
    document: string;
    contactName: string;
    phone: string;
    /** Plano da assinatura (code em plans). */
    planCode: string;
    /** CPF de quem assina o contrato pelo cliente. */
    signerCpf: string;
    /** Há quantos meses o cliente assina (faturas pagas; padrão 2). */
    monthsActive?: number;
    /** Conversa com o suporte do Comandou: [quem, dias atrás, texto]. */
    support?: ['tenant' | 'admin', number, string][];
    /** Chamados já resolvidos: [título, tipo, urgência, dias atrás, descrição, resposta]. */
    tickets?: [
      string,
      'bug' | 'improvement' | 'question' | 'other',
      'low' | 'medium' | 'high',
      number,
      string,
      string,
    ][];
  };
  /** Tudo o que vai além do básico (chat, fidelidade, reservas...). Só a Aurora tem. */
  extras?: import('./extras').DemoExtras;
}
