import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../design-system';
import { PrintTemplatesCard } from './PrintTemplates';

const apiMock = vi.fn();
vi.mock('../lib/api', () => ({
  api: (...a: unknown[]) => apiMock(...a),
  ApiError: class extends Error {},
}));

const LIST = [
  { kind: 'receipt', body: null, updatedAt: null, default: '{{ "CONTA" | centro }}' },
  { kind: 'kitchen_ticket', body: null, updatedAt: null, default: '{{ setor }}' },
  { kind: 'fiscal_footer', body: 'Volte sempre', updatedAt: '2026-11-03', default: 'x' },
];

describe('Modelos de impressão', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });
  afterEach(cleanup);

  it('abre com o modelo padrão, mostra a prévia e salva', async () => {
    apiMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === '/printing/templates') return Promise.resolve(LIST);
      if (url === '/printing/templates/preview') return Promise.resolve({ text: '        CONTA' });
      if (opts?.method === 'PUT') return Promise.resolve({ ok: true });
      return Promise.reject(new Error(`inesperado ${url}`));
    });
    render(
      <ToastProvider>
        <PrintTemplatesCard />
      </ToastProvider>,
    );
    const area = (await screen.findByLabelText('Modelo')) as HTMLTextAreaElement;
    expect(area.value).toBe('{{ "CONTA" | centro }}');
    fireEvent.click(screen.getByRole('button', { name: /Ver prévia/ }));
    expect(await screen.findByText('CONTA')).toBeInTheDocument();
    fireEvent.change(area, { target: { value: '{{ loja.nome }}' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar modelo/ }));
    await screen.findByText(/Modelo salvo/);
    expect(apiMock).toHaveBeenCalledWith('/printing/templates/receipt', {
      method: 'PUT',
      json: { body: '{{ loja.nome }}' },
    });
  });
});
