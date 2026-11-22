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

  it('conversa com a IA: a mudança entra no editor com a prévia e dá para desfazer', async () => {
    apiMock.mockImplementation((url: string, opts?: { method?: string; json?: unknown }) => {
      if (url === '/printing/templates') return Promise.resolve(LIST);
      if (url === '/printing/templates/ai' && !opts)
        return Promise.resolve({ enabled: true, reason: null, name: 'Bia' });
      if (url === '/printing/templates/ai')
        return Promise.resolve({
          resposta: 'Deixei o nome grande. Confira a prévia.',
          modelo: '{{ loja.nome | grande }}',
          aviso: null,
        });
      if (url === '/printing/templates/preview')
        return Promise.resolve({ text: '@@G@@LOJA GRANDE', logoUrl: null });
      return Promise.reject(new Error(`inesperado ${url}`));
    });
    render(
      <ToastProvider>
        <PrintTemplatesCard />
      </ToastProvider>,
    );
    const area = (await screen.findByLabelText('Modelo')) as HTMLTextAreaElement;
    fireEvent.click(await screen.findByRole('button', { name: /Montar o papel com IA/ }));
    expect(await screen.findByText(/Mexendo em: Conferência de conta/)).toBeInTheDocument();
    const ask = await screen.findByLabelText('O que mudar no papel');
    fireEvent.change(ask, { target: { value: 'nome maior' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText(/Deixei o nome grande/)).toBeInTheDocument();
    expect(area.value).toBe('{{ loja.nome | grande }}');
    const [big] = await screen.findAllByText('LOJA GRANDE');
    expect(big!.className).toContain('paper-text__big');
    const call = apiMock.mock.calls.find(
      ([u, o]) => u === '/printing/templates/ai' && (o as { method?: string })?.method,
    )!;
    expect((call[1] as { json: { body: string; messages: unknown[] } }).json).toMatchObject({
      kind: 'receipt',
      body: '{{ "CONTA" | centro }}',
      messages: [{ role: 'user', content: 'nome maior' }],
    });
    fireEvent.click(screen.getByRole('button', { name: /Desfazer/ }));
    expect(area.value).toBe('{{ "CONTA" | centro }}');
  });

  it('a IA desligada aparece no canto e diz o porquê, em vez de sumir', async () => {
    apiMock.mockImplementation((url: string) => {
      if (url === '/printing/templates') return Promise.resolve(LIST);
      if (url === '/printing/templates/ai')
        return Promise.resolve({ enabled: false, reason: 'tenant', name: 'Bia' });
      if (url === '/printing/templates/preview') return Promise.resolve({ text: 'CONTA' });
      return Promise.reject(new Error(`inesperado ${url}`));
    });
    render(
      <ToastProvider>
        <PrintTemplatesCard />
      </ToastProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Montar com IA' }));
    expect(await screen.findByText(/desligada para este restaurante/)).toBeInTheDocument();
    expect(screen.queryByLabelText('O que mudar no papel')).toBeNull();
  });
});
