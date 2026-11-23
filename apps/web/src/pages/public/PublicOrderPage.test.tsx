import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicOrderPage } from './PublicOrderPage';

const apiMock = vi.fn();
vi.mock('../../lib/api', () => ({
  api: (...a: unknown[]) => apiMock(...a),
  ApiError: class extends Error {},
}));

const at = '2026-11-23T12:51:00.000Z';
function order(step: string, channel: 'table' | 'delivery' | 'pickup') {
  return {
    restaurant: { name: 'Fumaça Burger & Co.', whatsapp: null, logoUrl: null, chat: false },
    etaMin: 20,
    etaMax: 30,
    number: 18599,
    channel,
    tableLabel: channel === 'table' ? '2' : null,
    selfPickup: false,
    canPickUp: false,
    step,
    canCancel: false,
    createdAt: at,
    customerName: 'Cliente',
    deliveryAddress: null,
    notes: null,
    subtotal: '44.90',
    deliveryFee: '0',
    discount: '0',
    surcharge: '0',
    total: '44.90',
    paymentHint: null,
    changeFor: null,
    paymentStatus: 'unpaid',
    cancelReason: null,
    timeline: {
      awaiting: at,
      accepted: at,
      ready: at,
      dispatched: null,
      completed: null,
      cancelled: null,
    },
    items: [
      {
        name: 'Fumaça (o da casa)',
        quantity: '1',
        total: '44.90',
        notes: null,
        imageUrl: null,
        options: [],
      },
    ],
    courier: null,
    pix: null,
    online: null,
  };
}

const STEPS = ['awaiting', 'accepted', 'ready', 'dispatched', 'completed', 'cancelled'] as const;

/*
 * A tela do pedido fica aberta o tempo todo na mão do cliente. Qualquer animação contínua nela
 * (vapor do desenho, pulso) fazia a tela inteira ficar mais fraca e mais forte no Safari do iPhone.
 * Aqui conferimos que nada dela liga movimento.
 */
describe('Acompanhamento do pedido: tela parada, sem piscar', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
  });

  for (const channel of ['table', 'delivery', 'pickup'] as const)
    for (const step of STEPS)
      it(`${channel} · ${step}: desenho sem animação`, async () => {
        apiMock.mockResolvedValue(order(step, channel));
        const { container } = render(
          <MemoryRouter initialEntries={['/pedido/tok']}>
            <Routes>
              <Route path="/pedido/:token" element={<PublicOrderPage />} />
            </Routes>
          </MemoryRouter>,
        );
        await screen.findByText('Pedido #18599');
        expect(container.querySelectorAll('[data-live], [data-ride]')).toHaveLength(0);
      });

  it('o CSS desliga animação de desenho e do pulso do mapa nesta tela', () => {
    const css = readFileSync(join(__dirname, 'public.css'), 'utf8');
    expect(css).toMatch(
      /\.store--track \.art,\s*\.store--track \.art \*,\s*\.store--track \.live-rider__pulse \{\s*animation: none !important;/,
    );
    // Nada da própria tela (.track*) com animação (só a trava `animation: none`).
    const own = css.slice(
      css.indexOf(
        '/* ---------------------------------------------------------------- acompanhamento',
      ),
    );
    expect(own.slice(0, own.indexOf('.steps {'))).not.toMatch(/^\s*animation:(?!\s*none)/m);
  });
});
