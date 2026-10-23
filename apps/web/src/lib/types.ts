import type {
  ItemStatus,
  OrderChannel,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@comandou/shared';

export interface MenuOption {
  id: string;
  name: string;
  priceDelta: string;
}
export interface MenuGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MenuOption[];
}
export interface MenuProduct {
  id: string;
  name: string;
  description: string | null;
  price: string;
  soldOut: boolean;
  sectorId: string | null;
  imageId?: string | null;
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
  coverImageId: string | null;
  logoImageId: string | null;
  theme: 'auto' | 'light' | 'dark';
  headline: string | null;
  featuredTitle: string | null;
  accountsEnabled: boolean;
  showPopular: boolean;
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
  phone: string;
  email: string | null;
  marketingOptIn: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  staffNotes: string | null;
  blocked: boolean;
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
  unitPrice: string;
  total: string;
  notes: string | null;
  status: ItemStatus;
  sectorId: string | null;
  startedAt: string | null;
  readyAt: string | null;
  options: { id: string; name: string; priceDelta: string }[];
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
  notes: string | null;
  cancelReason: string | null;
  /** staff = lançado pela equipe; online = cardápio online (cliente final). */
  source?: 'staff' | 'online';
  paymentHint?: PaymentMethod | null;
  changeFor?: string | null;
  acceptedAt?: string | null;
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
  orders?: Order[];
}

export interface DiningTable {
  id: string;
  label: string;
  seats: number;
  area: string | null;
  position?: number;
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

// ---------------------------------------------------------------- Etapa 4 (retaguarda)
export interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'revoked';
  createdAt: string;
  lastSeenAt: string | null;
}

export type StockUnit = 'un' | 'kg' | 'g' | 'l' | 'ml';
export interface StockItem {
  id: string;
  name: string;
  unit: StockUnit;
  quantity: string;
  minQuantity: string;
  avgCost: string;
  allowNegative: boolean;
  active: boolean;
  low: boolean;
  stockValue: string;
}
export interface StockMovement {
  id: string;
  stockItemId: string;
  itemName: string;
  unit: StockUnit;
  kind: 'purchase' | 'adjustment' | 'sale' | 'sale_reversal' | 'loss';
  quantity: string;
  unitCost: string | null;
  balanceAfter: string;
  orderId: string | null;
  orderNumber: number | null;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
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
  paymentHint: string | null;
  changeFor: string | null;
  deliveryLat: string | null;
  deliveryLng: string | null;
  notes: string | null;
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
  kind: 'kitchen_ticket' | 'receipt' | 'test';
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
  'pending' | 'processing' | 'authorized' | 'rejected' | 'error' | 'cancelling' | 'cancelled';
export interface FiscalSettings {
  enabled: boolean;
  environment: 'homologacao' | 'producao';
  cnpj: string | null;
  hasToken: boolean;
  tokenLast4: string | null;
  defaultCfop: string;
  defaultCode: string;
  defaultNcm: string | null;
  updatedAt: string | null;
  keyConfigured: boolean;
}
export interface FiscalDocument {
  id: string;
  orderId: string;
  orderNumber: number;
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
}
export interface MessagingSettings {
  provider: 'baileys' | 'meta_cloud';
  enabled: boolean;
  phoneNumberId: string | null;
  hasToken: boolean;
  tokenLast4: string | null;
  language: string;
  templateReady: string | null;
  templateDispatched: string | null;
  textReady: string;
  textDispatched: string;
  notifyReady: boolean;
  notifyDispatched: boolean;
  updatedAt: string | null;
  keyConfigured: boolean;
  gatewayConfigured: boolean;
}
export interface WhatsAppSession {
  status: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged_out';
  qr?: string;
  phone?: string;
  error?: string;
}
export interface OutboxMessage {
  id: string;
  orderId: string | null;
  orderNumber: number | null;
  event: 'order.ready' | 'order.dispatched' | 'test';
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
export interface TenantDomain {
  id: string;
  hostname: string;
  verified: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  dns: { txtName: string; txtValue: string; cnameTarget: string };
}
