import type {
  ChargeRule,
  ItemStatus,
  OrderChannel,
  OptionGroupKind,
  OrderStatus,
  PaymentMethod,
  PixKeyType,
  PixReceiptStatus,
  PaymentStatus,
} from '@comandou/shared';

export interface MenuOption {
  id: string;
  name: string;
  priceDelta: string;
  /** Já vem marcada ao abrir o item. */
  isDefault?: boolean;
}
export interface MenuGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  /** Adicional, tamanho, sabores (pizza) ou retirar ingrediente. */
  kind?: OptionGroupKind;
  /** Como cobra as opções escolhidas: soma, a mais cara ou a média. */
  charge?: ChargeRule;
  options: MenuOption[];
}
export interface MenuProduct {
  id: string;
  name: string;
  description: string | null;
  price: string;
  /** Esgotado à mão ou sem estoque pela ficha técnica: não vende. */
  soldOut: boolean;
  /** Sem estoque pela ficha técnica (algum insumo acabou). */
  stockOut?: boolean;
  sectorId: string | null;
  imageId?: string | null;
  code?: string | null;
  soldByWeight?: boolean;
  /** Tara em kg ("0.020") descontada do peso da balança. */
  weightTare?: string;
  optionGroups: MenuGroup[];
}
export interface MenuCategory {
  id: string;
  name: string;
  imageId?: string | null;
  products: MenuProduct[];
}

export interface StoreSettings {
  enabled: boolean;
  isOpen: boolean;
  autoAccept: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  deliveryFee: string;
  minOrder: string;
  etaMin: number;
  etaMax: number;
  about: string | null;
  address: string | null;
  whatsapp: string | null;
  city: string | null;
  state: string | null;
  coverImageId: string | null;
  logoImageId: string | null;
  theme: 'auto' | 'light' | 'dark';
  headline: string | null;
  featuredTitle: string | null;
  accountsEnabled: boolean;
  showPopular: boolean;
  chatEnabled: boolean;
  chatGreeting: string | null;
  /** Identidade visual: cores em #rrggbb (null = cores do Comandou). */
  brandColor: string | null;
  accentColor: string | null;
  fontStyle: 'padrao' | 'sistema' | 'classica' | 'arredondada';
  cornerStyle: 'padrao' | 'reto' | 'arredondado';
  faviconImageId: string | null;
  brandStaffApp: boolean;
  /** Horário de funcionamento: fora dele a loja fecha sozinha. */
  hoursEnabled: boolean;
  hours: StoreHour[];
  /** Pix pelo cardápio (chave da loja, sem banco): o cliente paga pelo QR Code e manda o comprovante. */
  pixEnabled: boolean;
  pixKeyType: PixKeyType | null;
  pixKey: string | null;
  pixName: string | null;
  pixCity: string | null;
  /** Ponto da loja no mapa (Entregas › Áreas de entrega). */
  storeLat?: string | null;
  storeLng?: string | null;
  /** Pedido pelo QR Code da mesa só com o celular no restaurante (ponto da loja no mapa). */
  tableCheckLocation: boolean;
  /** Pedido da mesa pronto: o cliente busca no balcão (em vez de o garçom levar). */
  tableSelfPickup: boolean;
  /** Recebe pedido agora (botão "aberta" + horário). Só na leitura. */
  openNow?: boolean;
}
/** Um turno do dia (0 = domingo). close menor que open = vira a meia-noite. */
export interface StoreHour {
  day: number;
  open: string;
  close: string;
}

export interface StoreBanner {
  id: string;
  title: string;
  subtitle: string | null;
  tag: string | null;
  cta: string | null;
  imageId: string | null;
  imageUrl: string | null;
  targetType: 'none' | 'product' | 'category';
  targetId: string | null;
  active: boolean;
  position: number;
}

export interface CustomerRow {
  id: string;
  name: string;
  /** Avatar desenhado que o cliente escolheu no cardápio (null = não escolheu). */
  avatar?: string | null;
  /** Foto que o cliente pôs no perfil. */
  photoUrl?: string | null;
  phone: string;
  email: string | null;
  marketingOptIn: boolean;
  blocked: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  orders: number;
  spent: string;
  lastOrderAt: string | null;
}
export interface CustomerList {
  summary: { total: number; new30: number; active30: number };
  customers: CustomerRow[];
}
export interface CustomerDetail {
  id: string;
  name: string;
  avatar?: string | null;
  photoUrl?: string | null;
  phone: string;
  email: string | null;
  marketingOptIn: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  staffNotes: string | null;
  blocked: boolean;
  /** CPF ou CNPJ e inscrição estadual (destinatário da nota fiscal). */
  document?: string | null;
  stateRegistration?: string | null;
  ieIndicator?: 1 | 2 | 9 | null;
  addresses: {
    id: string;
    label: string | null;
    street: string;
    number: string;
    district: string;
    complement: string | null;
    reference: string | null;
    isDefault: boolean;
  }[];
  orders: {
    id: string;
    number: number;
    status: string;
    channel: string;
    total: string;
    createdAt: string;
  }[];
  stats: {
    orders: number;
    spent: string;
    avgTicket: string;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
  };
  favorites: { name: string; quantity: number }[];
}

export interface OrderItem {
  id: string;
  productId: string;
  name: string;
  quantity: string;
  /** 'kg' quando o item foi vendido por peso (a quantidade é o peso). */
  unit?: 'un' | 'kg';
  unitPrice: string;
  total: string;
  notes: string | null;
  status: ItemStatus;
  sectorId: string | null;
  startedAt: string | null;
  readyAt: string | null;
  /** Foto atual do produto (null se não tiver). */
  imageId?: string | null;
  options: { id: string; name: string; priceDelta: string }[];
  /** Motivo do cancelamento do item (status cancelled). */
  cancelReason?: string | null;
}
export interface Payment {
  id: string;
  method: PaymentMethod;
  amount: string;
  tendered: string | null;
  refundedAmount: string;
  cashSessionId: string;
  createdAt: string;
  createdByName: string | null;
}
export interface Order {
  id: string;
  number: number;
  channel: OrderChannel;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotal: string;
  discount: string;
  surcharge: string;
  deliveryFee: string;
  total: string;
  paidAmount: string;
  balance: string;
  tabId: string | null;
  tabNumber: number | null;
  tableLabel: string | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  /** CPF/CNPJ na nota, informado no pagamento. */
  taxDocument?: string | null;
  notes: string | null;
  cancelReason: string | null;
  /** Concluído "a receber" (fiado): quando e por quê. */
  receivableAt?: string | null;
  receivableReason?: string | null;
  /** staff = lançado pela equipe; online = cardápio online (cliente final). */
  source?: 'staff' | 'online';
  paymentHint?: PaymentMethod | null;
  changeFor?: string | null;
  acceptedAt?: string | null;
  /** Pix pelo cardápio: situação do comprovante (null = não é pago assim). */
  pixStatus?: PixReceiptStatus | null;
  /** Pedido de mesa que já chegou na mesa ("Entreguei" do garçom ou "Já peguei" do cliente). */
  servedAt?: string | null;
  /** Último comprovante mandado (vem na lista, para o selo do cartão no PDV). */
  pixReceipt?: PixReceipt | null;
  /** Todos os comprovantes (só no detalhe do pedido), o mais novo primeiro. */
  pixReceipts?: PixReceipt[];
  version: number;
  createdAt: string;
  items: OrderItem[];
  payments?: Payment[];
  history?: {
    from: OrderStatus | null;
    to: OrderStatus;
    reason: string | null;
    at: string;
    actorName: string | null;
  }[];
}

export interface PixReceipt {
  id: string;
  status: 'submitted' | 'approved' | 'rejected' | 'replaced' | 'refunded';
  contentType: string;
  amount: string;
  createdAt: string;
  rejectReason: string | null;
  hasFile: boolean;
  reviewedAt?: string | null;
  reviewedByName?: string | null;
}

export interface Tab {
  id: string;
  number: number;
  status: 'open' | 'closed' | 'cancelled';
  customerName: string | null;
  tableId: string | null;
  tableLabel: string | null;
  openedAt: string;
  total: string;
  paid: string;
  balance: string;
  orderCount: number;
  billRequestedAt: string | null;
  /** Em quantas partes a mesa quer dividir a conta (marcado com "pediu a conta"). */
  billSplitParts?: number | null;
  /** Taxa de serviço da comanda (%), null = sem taxa; serviceFee = valor somado. */
  serviceFeePercent?: string | null;
  serviceFee?: string;
  orders?: Order[];
}

export type TableShape = 'square' | 'round' | 'rect';

export interface DiningTable {
  id: string;
  label: string;
  seats: number;
  area: string | null;
  position?: number;
  shape: TableShape;
  active: boolean;
  tabId: string | null;
  tabNumber: number | null;
  openedAt: string | null;
  tabTotal: string;
  tabPaid: string;
  tabCustomer: string | null;
  billRequestedAt: string | null;
}

export interface Sector {
  id: string;
  name: string;
  channels: OrderChannel[];
  warnAfterMin: number;
  lateAfterMin: number;
  active: boolean;
}

export interface CashRegister {
  id: string;
  name: string;
  active: boolean;
  openSessionId: string | null;
}

export interface CashSession {
  id: string;
  number: number;
  status: 'open' | 'closed';
  registerId: string;
  registerName: string;
  openingAmount: string;
  openedAt: string;
  closedAt: string | null;
  openedByName: string | null;
  closedByName?: string | null;
  expected: Record<PaymentMethod, string>;
  closedExpected?: Record<PaymentMethod, string> | null;
  counted?: Record<PaymentMethod, string> | null;
  difference: string | null;
  /** Fechada: contado − esperado de cada forma que não bateu ({} = tudo certo). Aberta: null. */
  differences?: Partial<Record<PaymentMethod, string>> | null;
  closingNote?: string | null;
  byKind?: { kind: string; method: PaymentMethod; count: number; total: string }[];
  movements?: {
    id: string;
    kind: 'opening' | 'sale' | 'supply' | 'withdrawal' | 'refund';
    method: PaymentMethod;
    amount: string;
    note: string | null;
    orderNumber: number | null;
    createdAt: string;
    createdByName: string | null;
  }[];
}

export interface CashTimelineEvent {
  id: string;
  at: string;
  kind: 'opening' | 'sale' | 'supply' | 'withdrawal' | 'refund';
  sessionId: string;
  sessionNumber: number;
  registerName: string;
  orderId: string | null;
  orderNumber: number | null;
  channel: string | null;
  deliveryFee: string;
  discount: string;
  amounts: Record<PaymentMethod, string>;
  note: string | null;
  createdByName: string | null;
  orderPaid: boolean;
  fiscal: { id: string; status: string; kind: string } | null;
}

/** Linha do tempo do caixa: um terminal ou todos os caixas abertos. */
export interface CashTimeline {
  sessions: Pick<
    CashSession,
    | 'id'
    | 'number'
    | 'status'
    | 'registerId'
    | 'registerName'
    | 'openingAmount'
    | 'openedAt'
    | 'closedAt'
    | 'openedByName'
  >[];
  totals: {
    sold: string;
    deliveryFees: string;
    surcharges: string;
    moved: string;
    closedOrders: number;
    supplies: string;
    withdrawals: string;
  };
  events: CashTimelineEvent[];
}

// ---------------------------------------------------------------- Etapa 4 (retaguarda)
export interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'revoked';
  createdAt: string;
  lastSeenAt: string | null;
  /** A mesma conta também entra em outro restaurante: só a pessoa troca a senha. */
  sharedAccount: boolean;
}

export type StockUnit = 'un' | 'kg' | 'g' | 'l' | 'ml';
export interface StockItem {
  id: string;
  /** IN-000001 (automático) ou o código que a loja usa. */
  code: string;
  barcode: string | null;
  name: string;
  unit: StockUnit;
  quantity: string;
  minQuantity: string;
  avgCost: string;
  allowNegative: boolean;
  active: boolean;
  low: boolean;
  stockValue: string;
  /** Agrupamento livre (Carnes, Hortifrúti, Bebidas…). */
  category: string | null;
  supplier: string | null;
  /** Última vez que o saldo foi conferido (contagem). */
  countedAt: string | null;
  /** Consumo médio por dia nas vendas dos últimos 30 dias; null = sem venda. */
  dailyUsage: string | null;
  /** Validade padrão dos lotes produzidos (dias). */
  shelfLifeDays: number | null;
  /** Rendimento da ficha de preparo, na unidade do insumo. */
  recipeYield: string;
  /** Produzido na casa (tem ficha de preparo). */
  hasPrep: boolean;
}
/** Sessão de inventário (contagem em lote). */
export interface StockCount {
  id: string;
  note: string;
  itemsCounted: number;
  itemsChanged: number;
  /** Diferença em R$ pelo custo médio (negativo = faltou). */
  valueDelta: string;
  createdAt: string;
  createdByName: string | null;
}
export interface PricingSettings {
  taxPercent: string;
  feePercent: string;
  fixedPercent: string;
  targetMargin: string;
}
export interface PricingProduct {
  id: string;
  name: string;
  categoryName: string;
  price: string;
  active: boolean;
  /** Custo da ficha técnica pelo custo médio atual (4 casas); null = sem ficha. */
  cost: string | null;
  hasRecipe: boolean;
  /** Algum insumo da ficha ainda sem custo (custo médio zero). */
  missingCost: boolean;
  /** Lucro desejado próprio; null = padrão do restaurante. */
  targetMargin: string | null;
  sold30: string;
  revenue30: string;
}
export interface PricingOption {
  id: string;
  name: string;
  groupName: string;
  price: string;
  active: boolean;
  cost: string | null;
  hasRecipe: boolean;
  missingCost: boolean;
}
export interface PricingData {
  settings: PricingSettings;
  products: PricingProduct[];
  options: PricingOption[];
  summary: { revenue30: string; cogs30: string; losses30: string };
}
export interface StockMovement {
  id: string;
  stockItemId: string;
  itemName: string;
  unit: StockUnit;
  kind: 'purchase' | 'adjustment' | 'sale' | 'sale_reversal' | 'loss' | 'production' | 'withdrawal';
  quantity: string;
  unitCost: string | null;
  balanceAfter: string;
  orderId: string | null;
  orderNumber: number | null;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  countId: string | null;
  /** Quantidade × custo do momento, em R$; null = entrada sem custo. */
  value: string | null;
  itemCode: string;
  receiptCode: string | null;
  receiptId: string | null;
  productionCode: string | null;
  lotCode: string | null;
}
export type StockLotStatus = 'available' | 'used' | 'discarded';
export interface StockLot {
  id: string;
  code: string;
  stockItemId: string;
  itemName: string;
  itemCode: string;
  unit: StockUnit;
  quantity: string;
  madeOn: string;
  expiresOn: string | null;
  status: StockLotStatus;
  origin: 'receipt' | 'production' | 'manual';
  receiptCode: string | null;
  receiptId: string | null;
  productionCode: string | null;
  note: string | null;
  createdAt: string;
  closedAt: string | null;
}
export interface StockReceipt {
  id: string;
  code: string;
  supplier: string | null;
  invoice: string | null;
  receivedOn: string;
  note: string | null;
  total: string;
  createdAt: string;
  createdByName: string | null;
  linesCount?: number;
  lines?: StockReceiptLine[];
}
export interface StockReceiptLine {
  id: string;
  stockItemId: string;
  itemName: string;
  unit: StockUnit;
  quantity: string;
  unitCost: string | null;
  enteredQuantity: string;
  enteredUnit: string;
  factor: string;
  lotCode: string | null;
  expiresOn: string | null;
  total: string | null;
}
export interface StockProduction {
  id: string;
  code: string;
  stockItemId: string;
  itemName: string;
  unit: StockUnit;
  quantity: string;
  totalCost: string | null;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  lotCode: string | null;
  expiresOn: string | null;
}
export interface StockFactor {
  id: string;
  code: string;
  name: string;
  unit: StockUnit;
  factor: string;
  stockItemId: string | null;
  itemName: string | null;
}
/** Linha da ficha de preparo: `itemId` (preparo) leva `quantity` de `stockItemId`. */
export interface PrepRecipeLine extends RecipeLine {
  itemId: string;
}
export interface RecipeLine {
  stockItemId: string;
  quantity: string;
}

export interface Courier {
  id: string;
  name: string;
  phone: string | null;
  userId: string | null;
  userName: string | null;
  active: boolean;
  /** Quando o link do entregador (sem login) foi gerado; null = sem link. */
  linkCreatedAt: string | null;
}
export interface Delivery {
  id: string;
  status: 'out' | 'delivered' | 'failed';
  orderId: string;
  orderNumber: number;
  orderStatus: OrderStatus;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  total: string;
  balance: string;
  paymentStatus: PaymentStatus;
  courierId: string;
  courierName: string;
  dispatchedAt: string;
  finishedAt: string | null;
  failureReason: string | null;
  lastLat: string | null;
  lastLng: string | null;
  lastLocationAt: string | null;
  /** Rumo em graus (0 = norte), velocidade em m/s e precisão em metros da última posição. */
  lastHeading: number | null;
  lastSpeed: number | null;
  lastAccuracy: number | null;
  paymentHint: string | null;
  changeFor: string | null;
  deliveryLat: string | null;
  deliveryLng: string | null;
  notes: string | null;
  /** Ganho do entregador gravado ao encerrar e, na rua, a estimativa se concluir. */
  courierPay?: string | null;
  payEstimate?: string | null;
  /** Distância estimada da corrida (linha reta × 1,3), em metros. */
  distanceM?: number | null;
  /** Acerto do entregador: pending = recebeu na porta e ainda não prestou contas no caixa. */
  collectStatus?: 'none' | 'pending' | 'settled';
  collectAmount?: string | null;
  collectMethod?: PaymentMethod | null;
  settledAt?: string | null;
}
/** O que cada entregador tem para acertar no caixa. */
export interface CourierCollection {
  courierId: string;
  courierName: string;
  total: string;
  deliveries: Delivery[];
}

export interface DeliveryZone {
  id: string;
  name: string;
  color: string;
  kind: 'polygon' | 'radius';
  polygon: [number, number][] | null;
  centerLat: string | null;
  centerLng: string | null;
  radiusM: number | null;
  fee: string;
  minOrder: string | null;
  etaMin: number | null;
  etaMax: number | null;
  active: boolean;
  position: number;
}

export interface PrintAgent {
  id: string;
  name: string;
  active: boolean;
  online: boolean;
  lastSeenAt: string | null;
  version: string | null;
}
export interface PrintJob {
  id: string;
  kind: 'kitchen_ticket' | 'receipt' | 'test' | 'fiscal_receipt' | 'kitchen_cancel';
  target: string;
  status: 'queued' | 'printing' | 'done' | 'failed';
  attempts: number;
  orderId: string | null;
  orderNumber: number | null;
  lastError: string | null;
  createdAt: string;
  agentName: string | null;
}

export interface FinanceEntry {
  id: string;
  kind: 'payable' | 'receivable';
  description: string;
  category: string | null;
  counterparty: string | null;
  amount: string;
  dueDate: string;
  status: 'open' | 'paid' | 'cancelled';
  paidAt: string | null;
  paidMethod: string | null;
  cancelReason: string | null;
  overdue: boolean;
}
export interface FinanceSummary {
  payableOpen: string;
  payableOverdue: string;
  payableNext7: string;
  receivableOpen: string;
  receivableOverdue: string;
  receivableNext7: string;
  /** Mês financeiro pedido (ou o atual): vence, pago/recebido e o que falta nele. */
  month: FinanceMonthSummary;
}
export interface FinanceMonthSummary {
  from: string;
  to: string;
  monthStartDay: number;
  payableDue: string;
  paid: string;
  payableLeft: string;
  receivableDue: string;
  received: string;
  receivableLeft: string;
  sales: string;
  refunds: string;
  net: string;
}
export interface FinanceSettings {
  monthStartDay: number;
  /** Hoje no fuso do restaurante (AAAA-MM-DD). */
  today: string;
  currentMonth: { from: string; to: string; year: number; month: number };
}
export interface CashFlowDay {
  day: string;
  sales: string;
  refunds: string;
  received: string;
  paid: string;
  expectedIn: string;
  expectedOut: string;
  net: string;
}
export interface Reconciliation {
  day: string;
  methods: {
    method: PaymentMethod;
    systemAmount: string;
    reconciliation: {
      informedAmount: string;
      difference: string;
      note: string | null;
      createdByName: string | null;
    } | null;
  }[];
}

export type FiscalStatus =
  | 'draft'
  | 'pending'
  | 'processing'
  | 'authorized'
  | 'rejected'
  | 'error'
  | 'cancelling'
  | 'cancelled'
  | 'discarded';
export type FiscalKind = 'nfce' | 'nfe';
export interface FiscalCompany {
  nome: string;
  nomeFantasia?: string | null;
  inscricaoEstadual: string;
  inscricaoMunicipal?: string | null;
  regimeTributario: 1 | 2 | 3 | 4;
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  email?: string | null;
  telefone?: string | null;
  /** CPF/CNPJ da contabilidade (alguns estados exigem). */
  contabilidade?: string | null;
  numeracao?: {
    nfceSerie?: number | null;
    nfceProximo?: number | null;
    nfeSerie?: number | null;
    nfeProximo?: number | null;
  } | null;
}
export interface FiscalSettings {
  enabled: boolean;
  /** own: token próprio da Focus; managed: o Comandou cadastrou a empresa (revenda). */
  mode: 'own' | 'managed';
  managedAvailable: boolean;
  company: FiscalCompany | null;
  focusRegistered: boolean;
  hasHomologToken: boolean;
  hasProdToken: boolean;
  cscHomolog: boolean;
  cscProd: boolean;
  certificateValidUntil: string | null;
  focusSyncedAt: string | null;
  environment: 'homologacao' | 'producao';
  cnpj: string | null;
  hasToken: boolean;
  tokenLast4: string | null;
  defaultCfop: string;
  defaultCode: string;
  defaultNcm: string | null;
  updatedAt: string | null;
  keyConfigured: boolean;
  nfeEnabled: boolean;
  nfceNature: string;
  nfeNature: string;
  additionalInfo: string | null;
  autoEmitNfce: boolean;
  /** Imprime o cupom da NFC-e na impressora do caixa quando a nota é autorizada. */
  printNfce: boolean;
  /** NFC-e em contingência offline quando a SEFAZ cai (vale no próximo salvar da empresa). */
  contingencyOffline: boolean;
  emailCustomer: boolean;
  regime: 1 | 2 | 3 | 4 | null;
  receivedSyncedAt: string | null;
}
/** Problema da nota em palavras simples (antes do envio ou a recusa da SEFAZ explicada). */
export interface FiscalIssue {
  title: string;
  detail: string;
  fix?: 'recipient' | 'items' | 'rules' | 'settings' | 'payment' | 'certificate' | 'retry' | 'none';
  code?: string;
}
export interface FiscalRecipient {
  name?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  ie?: string | null;
  ieIndicator?: 1 | 2 | 9 | null;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
}
export interface FiscalOperation {
  nature?: string;
  purpose?: '1' | '2' | '3' | '4';
  presence?: string;
  finalConsumer?: boolean;
  freight?: string;
  info?: string | null;
  referencedKey?: string | null;
  lineRules?: Record<string, string>;
}
export interface FiscalDocumentDetail extends FiscalDocument {
  operation: FiscalOperation | null;
  order: {
    id: string;
    number: number;
    channel: string;
    source: string;
    status: string;
    createdAt: string;
    subtotal: string;
    discount: string;
    surcharge: string;
    deliveryFee: string;
    total: string;
    customerName: string | null;
    customerPhone: string | null;
    deliveryAddress: string | null;
    customerId: string | null;
    paid: string;
    change: string;
  } | null;
  nature: string | null;
  presence: string | null;
  localDestino: string | null;
  info: string | null;
  items: {
    number: number;
    name: string;
    quantity: string;
    unitPrice: string;
    total: string;
    discount: string | null;
    other: string | null;
    freight: string | null;
    ncm: string | null;
    cest: string | null;
    cfop: string;
    cst: string;
    origin: string;
    pisCst: string | null;
    cofinsCst: string | null;
    icmsValue: string;
    ipiValue: string;
    cbsValue: string | null;
    ibsValue: string | null;
    approxTaxes: string | null;
    itemId: string | null;
    productId: string;
    ruleId: string | null;
    ruleCode: string | null;
    ruleName: string | null;
    ruleSource: 'product' | 'ncm' | 'default' | 'line' | 'legacy' | null;
  }[];
  payments: { code: string; amount: string }[];
  events: {
    id: string;
    kind: 'correction' | 'email';
    sequence: number | null;
    text: string;
    status: 'authorized' | 'rejected' | 'sent' | 'error';
    sefazMessage: string | null;
    createdAt: string;
    xmlUrl: string | null;
    pdfUrl: string | null;
  }[];
}
export interface FiscalRule {
  id: string;
  code: string;
  name: string;
  scope: 'all' | 'nfce' | 'nfe';
  active: boolean;
  isDefault: boolean;
  cfop: string;
  cfopInterstate: string | null;
  icmsCst: string;
  icmsOrigin: number;
  icmsRate: string | null;
  icmsBaseReduction: string | null;
  pisCst: string;
  pisRate: string | null;
  cofinsCst: string;
  cofinsRate: string | null;
  ipiCst: string | null;
  ipiRate: string | null;
  ibsCbsCst: string | null;
  ibsCbsClass: string | null;
  cbsRate: string | null;
  ibsUfRate: string | null;
  ibsMunRate: string | null;
  benefitCode: string | null;
  approxTaxRate: string | null;
  notes: string | null;
  products?: number;
  ncms?: string[];
  productIds?: string[];
}
export interface FiscalRulesResponse {
  rules: FiscalRule[];
  links: { ncm: string; ruleId: string; products: number }[];
  uncovered: { id: string; name: string; code: string | null; ncm: string | null }[];
}
export interface FiscalVoid {
  id: string;
  kind: FiscalKind;
  environment: 'homologacao' | 'producao';
  series: number;
  numberFrom: number;
  numberTo: number;
  reason: string;
  status: 'authorized' | 'rejected' | 'error';
  sefazStatus: string | null;
  sefazMessage: string | null;
  protocol: string | null;
  createdAt: string;
  createdByName: string | null;
}
export interface FiscalReceived {
  id: string;
  accessKey: string;
  issuerName: string | null;
  issuerDocument: string | null;
  total: string | null;
  issuedAt: string | null;
  situation: 'autorizada' | 'cancelada' | 'denegada';
  manifestation: 'ciencia' | 'confirmacao' | 'desconhecimento' | 'nao_realizada' | null;
  manifestedAt: string | null;
  manifestReason: string | null;
  complete: boolean;
  correctionText: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}
export interface FiscalDocument {
  id: string;
  orderId: string;
  orderNumber: number;
  /** Nota da comanda inteira (mesa). */
  tabId?: string | null;
  tabNumber?: number | null;
  orderChannel: string;
  kind: FiscalKind;
  issues: FiscalIssue[];
  recipient: FiscalRecipient | null;
  recipientName: string | null;
  customerId: string | null;
  protocol: string | null;
  updatedAt: string;
  discardedAt: string | null;
  discardReason: string | null;
  environment: 'homologacao' | 'producao';
  status: FiscalStatus;
  attempts: number;
  total: string;
  sefazStatus: string | null;
  sefazMessage: string | null;
  accessKey: string | null;
  number: string | null;
  series: string | null;
  qrcodeUrl: string | null;
  cancelReason: string | null;
  lastError: string | null;
  createdAt: string;
  authorizedAt: string | null;
  cancelledAt: string | null;
  xmlUrl: string | null;
  danfeUrl: string | null;
  /** Emitida em contingência offline (SEFAZ fora do ar na hora da venda). */
  contingency?: boolean;
  /** Quando a SEFAZ recebeu a nota emitida em contingência (null = ainda pendente). */
  contingencySettledAt?: string | null;
}
/** Avisos ao cliente, na ordem do pedido. */
export const NOTICE_KEYS = ['Accepted', 'Ready', 'Dispatched', 'Delivered', 'Cancelled'] as const;
export type NoticeKey = (typeof NOTICE_KEYS)[number];
export type MessagingSettings = {
  provider: 'baileys' | 'meta_cloud';
  enabled: boolean;
  phoneNumberId: string | null;
  hasToken: boolean;
  tokenLast4: string | null;
  language: string;
  templateReset: string | null;
  updatedAt: string | null;
  keyConfigured: boolean;
  gatewayConfigured: boolean;
} & { [K in NoticeKey as `template${K}`]: string | null } & {
  [K in NoticeKey as `text${K}`]: string;
} & { [K in NoticeKey as `notify${K}`]: boolean };
export interface WhatsAppSession {
  status: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged_out';
  qr?: string;
  phone?: string;
  error?: string;
  /** caiu e está religando sozinha (sessão já pareada) */
  reconnecting?: boolean;
}
export interface OutboxMessage {
  id: string;
  orderId: string | null;
  orderNumber: number | null;
  event:
    | 'order.accepted'
    | 'order.ready'
    | 'order.dispatched'
    | 'order.delivered'
    | 'order.cancelled'
    | 'test';
  provider: 'baileys' | 'meta_cloud';
  toPhone: string;
  template: string | null;
  body: string | null;
  status: 'queued' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

// ---- Etapa 6: plano, assinatura e domínio próprio ----
export interface TenantSubscription {
  current: {
    subscription: {
      id: string;
      status: 'trialing' | 'active' | 'past_due' | 'cancelled';
      startedAt: string;
      trialEndsAt: string | null;
      currentPeriodEnd: string | null;
    };
    plan: {
      id: string;
      code: string;
      name: string;
      priceMonthly: string;
      limits: { users: number | null; products: number | null; orders_month: number | null };
      features: { fiscal: boolean; whatsapp: boolean; custom_domain: boolean };
    };
  } | null;
  usage: { users: number; products: number; orders_month: number };
}
