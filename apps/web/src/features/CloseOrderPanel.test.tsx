import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '../lib/types';

vi.mock('../lib/api', () => ({
  api: vi.fn(async (url: string) =>
    url.startsWith('/cash/sessions') ? [{ id: 's1', registerName: 'Caixa', number: 1 }] : {},
  ),
  ApiError: class extends Error {},
}));
vi.mock('../app/auth', () => ({ useCan: () => true }));

import { CloseOrderPanel } from './CloseOrderPanel';

const order = (o: Partial<Order>) =>
  ({
    id: 'o1',
    number: 18585,
    channel: 'pickup',
    status: 'ready',
    paymentStatus: 'unpaid',
    subtotal: '143.70',
    discount: '0.00',
    surcharge: '0.00',
    deliveryFee: '0.00',
    total: '143.70',
    paidAmount: '0.00',
    balance: '143.70',
    paymentHint: 'meal_voucher',
    version: 1,
    items: [],
    ...o,
  }) as unknown as Order;

afterEach(cleanup);

describe('Fechar conta', () => {
  it('desconto refaz o valor do pagamento: não vira troco', async () => {
    render(<CloseOrderPanel order={order({})} open onClose={() => {}} onDone={() => {}} />);
    await act(async () => {});
    const value = screen.getByLabelText('Valor 1') as HTMLInputElement;
    expect(value.value).toBe('143,70');
    fireEvent.change(screen.getByLabelText('Meio de pagamento 1'), { target: { value: 'cash' } });
    // O caixa já tinha digitado o valor antes de dar o desconto.
    fireEvent.change(value, { target: { value: '143,70' } });
    fireEvent.change(screen.getByLabelText('Desconto'), { target: { value: '2,00' } });
    expect((screen.getByLabelText('Valor 1') as HTMLInputElement).value).toBe('141,70');
    expect(screen.queryByText(/Troco/)).toBeNull();
  });

  it('retirada não mostra taxa de serviço nem frete', async () => {
    render(<CloseOrderPanel order={order({})} open onClose={() => {}} onDone={() => {}} />);
    await act(async () => {});
    expect(screen.queryByLabelText('Taxa de serviço (%)')).toBeNull();
    expect(screen.queryByLabelText('Frete (R$)')).toBeNull();
  });

  it('"Fechar e imprimir" imprime direto, sem prévia do comprovante', async () => {
    render(
      <CloseOrderPanel
        order={order({ channel: 'counter' })}
        open
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('Fechar e imprimir').closest('button')).toBeTruthy();
    expect(screen.queryByText('Comprovante de fechamento')).toBeNull();
    expect(screen.queryByText('Imprimir')).toBeNull();
    expect(screen.getByLabelText('Taxa de serviço (%)')).toBeTruthy();
  });
});
