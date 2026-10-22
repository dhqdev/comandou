import type {
  ItemStatus,
  OrderChannel,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@pedemais/shared';

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
  optionGroups: MenuGroup[];
}
export interface MenuCategory {
  id: string;
  name: string;
  products: MenuProduct[];
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
  orders?: Order[];
}

export interface DiningTable {
  id: string;
  label: string;
  seats: number;
  area: string | null;
  active: boolean;
  tabId: string | null;
  tabNumber: number | null;
  openedAt: string | null;
  tabTotal: string;
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
