import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '../design-system';
import { checkText, SitesTable, SitesTiles, type SitesFilter } from './SitesStatus';
import type { SitesReport, SiteStatus } from './types';
import { useState } from 'react';

vi.mock('../lib/api', () => ({ api: vi.fn(), ApiError: class extends Error {} }));

const recent = new Date(Date.now() - 3600_000).toISOString();
const site = (over: Partial<SiteStatus>): SiteStatus => ({
  id: over.slug ?? 'x',
  slug: 'x',
  name: 'X',
  status: 'provisioned',
  planName: null,
  subscriptionStatus: null,
  host: `${over.slug ?? 'x'}.comandou.com`,
  state: 'online',
  issues: [],
  web: { ok: true, http: 200, ms: 120 },
  domains: [],
  database: {
    kind: 'shared',
    name: null,
    status: null,
    server: 'Central',
    check: { ok: true, http: null, ms: 4 },
  },
  whatsapp: { status: 'connected', phone: '5511999990000' },
  backup: { lastOkAt: recent, lastStatus: 'ok', lastAt: recent },
  lastOrderAt: null,
  ordersMonth: 0,
  ...over,
});
const REPORT: SitesReport = {
  checkedAt: new Date().toISOString(),
  baseDomain: 'comandou.com',
  whatsappGateway: 'ok',
  sites: [
    site({ slug: 'bella', name: 'Pizzaria Bella' }),
    site({
      slug: 'kame',
      name: 'Sushi Kame',
      state: 'offline',
      web: { ok: false, http: 502, ms: 40, error: 'servidor fora do ar (502)' },
      issues: ['Site: servidor fora do ar (502)'],
    }),
    site({ slug: 'ze', name: 'Burger do Zé', whatsapp: { status: 'qr', phone: null } }),
    site({
      slug: 'old',
      name: 'Antigo',
      status: 'suspended',
      state: 'suspended',
      web: null,
      whatsapp: null,
    }),
  ],
};

function Harness() {
  const [filter, setFilter] = useState<SitesFilter>('all');
  return (
    <MemoryRouter>
      <ToastProvider>
        <SitesTiles report={REPORT} offsite={false} onFilter={setFilter} />
        <SitesTable
          report={REPORT}
          error={null}
          loading={false}
          filter={filter}
          setFilter={setFilter}
          onReload={() => undefined}
        />
      </ToastProvider>
    </MemoryRouter>
  );
}

const names = () =>
  screen.queryAllByText(/Pizzaria Bella|Sushi Kame|Burger do Zé|Antigo/).map((e) => e.textContent);

describe('Status dos sites', () => {
  afterEach(cleanup);

  it('mostra latência ou o motivo da falha', () => {
    expect(checkText({ ok: true, http: 200, ms: 353 })).toBe('200 · 353 ms');
    expect(checkText({ ok: false, http: null, ms: null, error: 'conexão recusada' })).toBe(
      'conexão recusada',
    );
    expect(checkText(null)).toBe('—');
  });

  it('site fora do ar vem primeiro, com o motivo; os números do topo batem', () => {
    render(<Harness />);
    expect(names()[0]).toBe('Sushi Kame');
    expect(screen.getByText('Site: servidor fora do ar (502)')).toBeTruthy();
    expect(screen.getByText('1 fora do ar')).toBeTruthy();
    // Suspenso não conta como WhatsApp desconectado; o que espera QR conta.
    expect(screen.getByText('1 sem conexão (veja na lista)')).toBeTruthy();
    // Os números são "de quantos": 2 de 3 no ar com WhatsApp (o fora do ar e o do QR não).
    expect(screen.getByText('2 de 3')).toBeTruthy();
    // Suspenso não tem botão de entrar.
    expect(screen.getAllByRole('button', { name: /Entrar/ })).toHaveLength(3);
  });

  it('filtros e busca', () => {
    render(<Harness />);
    const chips = screen.getByRole('group', { name: 'Filtrar sites' });
    fireEvent.click(within(chips).getByRole('button', { name: /WhatsApp desconectado/ }));
    expect(names()).toEqual(['Burger do Zé']);
    fireEvent.click(within(chips).getByRole('button', { name: /Todos/ }));
    fireEvent.change(screen.getByLabelText('Buscar site'), { target: { value: 'bella' } });
    expect(names()).toEqual(['Pizzaria Bella']);
    expect(screen.getByText(/Mostrando 1 de 4/)).toBeTruthy();
  });
});
