import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationPanel } from './TenantInsights';
import type { TenantInsights } from './types';

const apiMock = vi.fn();
vi.mock('../lib/api', () => ({
  api: (...a: unknown[]) => apiMock(...a),
  ApiError: class extends Error {},
}));

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
}).format(new Date());

const operation = (
  over: Partial<TenantInsights['operation']> = {},
): TenantInsights['operation'] => ({
  orders: {
    total: 12,
    cancelled: 1,
    revenue: 540.5,
    avgTicket: 45,
    open: 2,
    first: '2026-10-01T12:00:00Z',
    last: '2026-11-26T12:00:00Z',
    allTime: 40,
  },
  byChannel: [
    { key: 'counter', count: 8, revenue: 400 },
    { key: 'delivery', count: 3, revenue: 140.5 },
  ],
  byStatus: [
    { key: 'completed', count: 9 },
    { key: 'cancelled', count: 1 },
    { key: 'new', count: 2 },
  ],
  // 10,01 dividido por 4 ou 5 semanas dá mais de 2 casas na média do dia da semana.
  byDay: [{ day: today, count: 12, revenue: 10.01 }],
  byHour: [
    { hour: 12, count: 7 },
    { hour: 19, count: 5 },
  ],
  payments: [
    { key: 'pix', count: 6, amount: 300 },
    { key: 'cash', count: 4, amount: 240.5 },
  ],
  topProducts: [
    { name: 'X-Burguer', qty: 10 },
    { name: 'Coca', qty: 4 },
  ],
  catalog: { categories: 3, products: 20, soldOut: 1, tables: 8, sectors: 2 },
  cash: { openSessions: 1, sessions30d: 10, difference30d: 0, openTabs: 1 },
  delivery: { couriers: 1, byStatus: [{ key: 'delivered', count: 3 }] },
  stock: { items: 5, belowMin: 0 },
  fiscal: [],
  messages: [],
  printAgents: [],
  printJobs: [],
  users: [],
  ...over,
});

const insights = (op: TenantInsights['operation']): TenantInsights => ({
  footprint: { tables: [], rows: 0, bytes: 0, databaseBytes: 0, share: 0 },
  traffic: null,
  onlineNow: 0,
  operation: op,
});

const renderIt = (props: { timezone?: string } = {}) =>
  render(
    <MemoryRouter>
      <OperationPanel id="t1" team={[]} timezone={props.timezone ?? 'America/Sao_Paulo'} />
    </MemoryRouter>,
  );

describe('OperationPanel (aba Operação do Super Admin)', () => {
  beforeEach(() => apiMock.mockReset());
  afterEach(cleanup);

  it('desenha os gráficos com dados', async () => {
    apiMock.mockResolvedValue(insights(operation()));
    renderIt();
    expect(await screen.findByText('Formas de pagamento')).toBeTruthy();
    expect(screen.getByText('X-Burguer')).toBeTruthy();
  });

  it('abre com o restaurante sem nenhum pedido', async () => {
    apiMock.mockResolvedValue(
      insights(
        operation({
          orders: {
            total: 0,
            cancelled: 0,
            revenue: 0,
            avgTicket: 0,
            open: 0,
            first: null,
            last: null,
            allTime: 0,
          },
          byChannel: [],
          byStatus: [],
          byDay: [],
          byHour: [],
          payments: [],
          topProducts: [],
        }),
      ),
    );
    renderIt();
    expect(await screen.findByText('Formas de pagamento')).toBeTruthy();
  });

  it('abre com o fuso vazio', async () => {
    apiMock.mockResolvedValue(insights(operation()));
    renderIt({ timezone: '' });
    expect(await screen.findByText('Formas de pagamento')).toBeTruthy();
  });
});
