import type { Dre, PaymentMethod } from '@comandou/shared';

export interface ClosingSession {
  id: string;
  number: number;
  status: 'open' | 'closed';
  registerName: string;
  openedAt: string;
  closedAt: string | null;
  openedByName: string | null;
  closedByName: string | null;
  day: string;
  difference: string | null;
  cashDifference: string | null;
  closingNote: string | null;
  posted: boolean;
  sales: string;
}
export interface ClosingMethod {
  method: PaymentMethod;
  gross: string;
  fee: string;
  net: string;
  expectedDate: string;
  received: boolean;
  receivedAmount: string;
  /** Caixa ainda sem lançamento: taxa e prazo calculados pelas taxas cadastradas. */
  estimated: boolean;
}
export interface ClosingDay {
  day: string;
  status: 'open' | 'posted' | 'pending';
  sessions: ClosingSession[];
  methods: ClosingMethod[];
  totals: {
    gross: string;
    fee: string;
    net: string;
    orders: number;
    ticket: string;
    discounts: string;
    deliveryFees: string;
    opening: string;
    supplies: string;
    withdrawals: string;
    cashDifference: string;
  };
}

export interface Settlement {
  id: string;
  day: string;
  method: PaymentMethod;
  gross: string;
  feePercent: string;
  fee: string;
  net: string;
  expectedDate: string;
  sessionId: string;
  sessionNumber: number;
  registerName: string;
  reconciliationId: string | null;
  receivedAt: string | null;
  receivedBy: string | null;
  reconciliationDifference: string | null;
  late: boolean;
}
export interface SettlementList {
  rows: Settlement[];
  totals: { pending: string; late: string; next7: string; count: number };
}

export interface BankAccount {
  id: string;
  name: string;
  bankId: string | null;
  accountRef: string | null;
  active: boolean;
  lines: number;
  openLines: number;
  lastDate: string | null;
}

export type Proposal =
  | { kind: 'settlement'; lineIds: string[]; settlementIds: string[]; auto: boolean }
  | { kind: 'entry'; lineIds: string[]; entryId: string; settle: boolean; auto: boolean };

export interface BankLine {
  id: string;
  accountId: string;
  accountName: string;
  date: string;
  amount: string;
  description: string;
  reconciliationId: string | null;
  reconciliation: {
    id: string;
    kind: 'settlement' | 'entry' | 'transfer' | 'ignored' | 'manual';
    day: string;
    difference: string;
    auto: boolean;
    note: string | null;
    entrySettled: boolean;
    entryDescription: string | null;
    entryCategory: string | null;
    settlements: { method: PaymentMethod; day: string; net: string }[] | null;
    createdByName: string | null;
  } | null;
  suggestion: Proposal | null;
}
export interface BankLines {
  summary: { open: number; openIn: string; openOut: string };
  lines: BankLine[];
}

export interface Candidates {
  settlements: {
    id: string;
    day: string;
    method: PaymentMethod;
    gross: string;
    fee: string;
    net: string;
    expectedDate: string;
    sessionNumber: number;
    registerName: string;
  }[];
  lines: {
    id: string;
    accountName: string;
    date: string;
    amount: string;
    description: string;
  }[];
  entries: {
    id: string;
    kind: 'payable' | 'receivable';
    description: string;
    category: string | null;
    counterparty: string | null;
    amount: string;
    status: 'open' | 'paid';
    dueDate: string;
    paidAt: string | null;
  }[];
}

export interface DreResponse {
  from: string;
  to: string;
  basis: 'accrual' | 'cash';
  dre: Dre;
  previous: { from: string; to: string; dre: Dre };
}
