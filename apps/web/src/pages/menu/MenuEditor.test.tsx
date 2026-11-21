import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../design-system';
import { MenuEditor } from './MenuEditor';

const apiMock = vi.fn();
vi.mock('../../lib/api', () => ({
  api: (...a: unknown[]) => apiMock(...a),
  ApiError: class extends Error {},
}));
vi.mock('../../app/auth', () => ({ useCan: () => true }));

const menu = { id: 'm1', name: 'Delivery', kind: 'delivery', active: true, items: 1 };
const products = [
  { id: 'a', name: 'Chopp', price: '14.90', categoryId: 'c1', active: true, code: 'IT-1' },
  { id: 'b', name: 'IPA', price: '24.90', categoryId: 'c1', active: true, code: 'IT-2' },
];

function serve() {
  apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method) return {};
    if (path === '/menus') return [menu];
    if (path === '/categories') return [{ id: 'c1', name: 'Bebidas' }];
    if (path === '/products') return products;
    if (path === '/sectors') return [];
    if (path === '/menus/m1/items') return [{ productId: 'a', price: null }];
    return [];
  });
}

const renderIt = () =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/m1']}>
        <Routes>
          <Route path=":id" element={<MenuEditor />} />
          <Route path="/cardapio/itens/:pid" element={<p>Tela do item</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );

const writes = () => apiMock.mock.calls.filter(([, init]) => init?.method);

describe('Editor do cardápio: salva sozinho', () => {
  beforeEach(() => {
    apiMock.mockReset();
    serve();
  });
  afterEach(cleanup);

  it('não tem botão Salvar; ligar um item grava e o cartão diz o que mudou', async () => {
    renderIt();
    const ipa = await screen.findByRole('switch', { name: 'IPA no cardápio' });
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    fireEvent.click(ipa);
    await waitFor(() => expect(writes()).toHaveLength(1), { timeout: 3000 });
    expect(writes()[0]).toEqual([
      '/menus/m1/items',
      {
        method: 'PUT',
        json: {
          items: [
            { productId: 'a', price: null },
            { productId: 'b', price: null },
          ],
        },
      },
    ]);
    expect(await screen.findByText('IPA entrou no cardápio')).toBeInTheDocument();
    expect(screen.getByText('Salvo')).toBeInTheDocument();
  });

  it('preço digitado grava ao sair do campo; preço ilegível não grava', async () => {
    renderIt();
    const price = await screen.findByLabelText('Preço de Chopp neste cardápio');
    fireEvent.change(price, { target: { value: '12,,9' } });
    fireEvent.blur(price);
    expect(await screen.findByText('Não salvo: corrija para salvar')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    fireEvent.change(price, { target: { value: '15,90' } });
    await act(async () => fireEvent.blur(price));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(await screen.findByText(/Chopp: R\$\s15,90/)).toBeInTheDocument();
    // Nada mudou desde a última gravação: não grava de novo.
    await new Promise((r) => setTimeout(r, 1000));
    expect(writes()).toHaveLength(1);
  });

  it('clicar na linha abre o item; preço e chave não abrem', async () => {
    renderIt();
    const ipa = await screen.findByRole('switch', { name: 'IPA no cardápio' });
    fireEvent.click(ipa);
    fireEvent.click(screen.getByLabelText('Preço de Chopp neste cardápio'));
    expect(screen.queryByText('Tela do item')).toBeNull();
    fireEvent.click(screen.getByText('Chopp'));
    expect(await screen.findByText('Tela do item')).toBeInTheDocument();
  });

  it('nome novo grava no PATCH do cardápio', async () => {
    renderIt();
    const name = await screen.findByLabelText(/Nome do cardápio/);
    fireEvent.change(name, { target: { value: 'Delivery noite' } });
    await act(async () => fireEvent.blur(name));
    await waitFor(() =>
      expect(writes()).toEqual([
        ['/menus/m1', { method: 'PATCH', json: { name: 'Delivery noite' } }],
      ]),
    );
    expect(await screen.findByText('Nome do cardápio: Delivery noite')).toBeInTheDocument();
  });
});
