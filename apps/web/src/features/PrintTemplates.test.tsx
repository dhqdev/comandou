import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  { kind: 'delivery_slip', body: null, updatedAt: null, default: '{{ "ENTREGA" }}' },
  { kind: 'kitchen_ticket', body: null, updatedAt: null, default: '{{ setor }}' },
  { kind: 'fiscal_footer', body: 'Volte sempre', updatedAt: '2026-11-03', default: 'x' },
];

type Opts = { method?: string; json?: { kind?: string; body?: string; messages?: unknown[] } };

const draw = () =>
  render(
    <ToastProvider>
      <PrintTemplatesCard />
    </ToastProvider>,
  );

/** Abre a conversa, escolhe o papel e devolve o campo de pedir. */
async function chat(paper: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: /Montar o papel com IA/ }));
  expect(await screen.findByText(/Qual papel você quer mudar/)).toBeInTheDocument();
  // Antes de escolher o papel não dá para pedir.
  expect(screen.queryByLabelText('O que mudar no papel')).toBeNull();
  const papers = screen.getByRole('group', { name: 'Papel que vai mudar' });
  fireEvent.click(within(papers).getByRole('button', { name: paper }));
  return (await screen.findByLabelText('O que mudar no papel')) as HTMLTextAreaElement;
}

describe('Modelos de impressão', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });
  afterEach(cleanup);

  it('abre com o modelo padrão, monta a prévia sozinho e salva só o que mudou', async () => {
    apiMock.mockImplementation((url: string, opts?: Opts) => {
      if (url === '/printing/templates') return Promise.resolve(LIST);
      if (url === '/printing/templates/ai')
        return Promise.resolve({ enabled: true, reason: null, name: 'Bia' });
      if (url === '/printing/templates/preview')
        return Promise.resolve({
          text: `        ${opts?.json?.body === '{{ loja.nome }}' ? 'LOJA' : 'CONTA'}`,
          order: 42,
        });
      if (opts?.method === 'PUT') return Promise.resolve({ ok: true });
      return Promise.reject(new Error(`inesperado ${url}`));
    });
    draw();
    const area = (await screen.findByLabelText('Modelo')) as HTMLTextAreaElement;
    expect(area.value).toBe('{{ "CONTA" | centro }}');
    // A prévia aparece sem clicar em nada, dizendo de qual pedido vem.
    expect(await screen.findByText('CONTA')).toBeInTheDocument();
    expect(screen.getByText('Com o último pedido (#42)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ver prévia/ })).toBeNull();
    const save = screen.getByRole('button', { name: /Salvar modelo/ });
    expect(save).toBeDisabled();
    // Digitou: a prévia acompanha e o Salvar acende.
    fireEvent.change(area, { target: { value: '{{ loja.nome }}' } });
    expect(screen.getByText(/Não salvo/)).toBeInTheDocument();
    expect(await screen.findByText('LOJA')).toBeInTheDocument();
    fireEvent.click(save);
    await screen.findByText(/Modelo salvo/);
    expect(apiMock).toHaveBeenCalledWith('/printing/templates/receipt', {
      method: 'PUT',
      json: { body: '{{ loja.nome }}' },
    });
  });

  it('conversa com a IA: escolhe o papel, a mudança aparece só na prévia e dá para desfazer', async () => {
    apiMock.mockImplementation((url: string, opts?: Opts) => {
      if (url === '/printing/templates') return Promise.resolve(LIST);
      if (url === '/printing/templates/ai' && !opts)
        return Promise.resolve({ enabled: true, reason: null, name: 'Bia' });
      if (url === '/printing/templates/ai')
        return Promise.resolve({
          resposta: 'Deixei o nome grande.',
          modelo: '{{ loja.nome | grande }}',
          aviso: null,
          previa: { text: 'CONTA\n@@G@@LOJA GRANDE', logoUrl: null, order: null },
        });
      if (url === '/printing/templates/preview')
        return Promise.resolve({ text: 'CONTA', logoUrl: null, order: null });
      return Promise.reject(new Error(`inesperado ${url}`));
    });
    draw();
    const area = (await screen.findByLabelText('Modelo')) as HTMLTextAreaElement;
    await screen.findByText('CONTA');
    const ask = await chat(/Conferência de conta/);
    fireEvent.change(ask, { target: { value: 'nome maior' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText(/Deixei o nome grande/)).toBeInTheDocument();
    expect(area.value).toBe('{{ loja.nome | grande }}');
    // O papel aparece uma vez só: na prévia (a conversa não repete), com a linha nova piscando.
    const big = screen.getAllByText('LOJA GRANDE');
    expect(big).toHaveLength(1);
    expect(big[0]!.className).toContain('paper-text__big');
    expect(big[0]!.closest('mark')).not.toBeNull();
    expect(screen.getByText('CONTA').closest('mark')).toBeNull();
    const call = apiMock.mock.calls.find(
      ([u, o]) => u === '/printing/templates/ai' && (o as Opts | undefined)?.method,
    )!;
    expect((call[1] as Opts).json).toMatchObject({
      kind: 'receipt',
      body: '{{ "CONTA" | centro }}',
      messages: [{ role: 'user', content: 'nome maior' }],
    });
    fireEvent.click(screen.getByRole('button', { name: /Desfazer/ }));
    expect(area.value).toBe('{{ "CONTA" | centro }}');
    expect(await screen.findByRole('button', { name: /Refazer/ })).toBeInTheDocument();
  });

  it('salva pela própria conversa e o papel escolhido muda o editor junto', async () => {
    apiMock.mockImplementation((url: string, opts?: Opts) => {
      if (url === '/printing/templates') return Promise.resolve(LIST);
      if (url === '/printing/templates/ai' && !opts)
        return Promise.resolve({ enabled: true, reason: null, name: 'Bia' });
      if (url === '/printing/templates/ai')
        return Promise.resolve({
          resposta: 'Itens em letra grande.',
          modelo: '{{ setor | grande }}',
          aviso: null,
          previa: null,
        });
      if (url === '/printing/templates/preview')
        return Promise.resolve({ text: 'COZINHA', logoUrl: null, order: 7 });
      if (opts?.method === 'PUT') return Promise.resolve({ ok: true });
      return Promise.reject(new Error(`inesperado ${url}`));
    });
    draw();
    const area = (await screen.findByLabelText('Modelo')) as HTMLTextAreaElement;
    const ask = await chat(/Comanda da cozinha/);
    // Escolher o papel na conversa abre o mesmo papel no editor.
    expect(area.value).toBe('{{ setor }}');
    fireEvent.change(ask, { target: { value: 'itens maiores' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await screen.findByText(/Itens em letra grande/);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/já vale na impressora/)).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith('/printing/templates/kitchen_ticket', {
      method: 'PUT',
      json: { body: '{{ setor | grande }}' },
    });
  });

  it('a IA desligada aparece no canto e diz o porquê, em vez de sumir', async () => {
    apiMock.mockImplementation((url: string) => {
      if (url === '/printing/templates') return Promise.resolve(LIST);
      if (url === '/printing/templates/ai')
        return Promise.resolve({ enabled: false, reason: 'tenant', name: 'Bia' });
      if (url === '/printing/templates/preview') return Promise.resolve({ text: 'CONTA' });
      return Promise.reject(new Error(`inesperado ${url}`));
    });
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Montar com IA' }));
    expect(await screen.findByText(/desligada para este restaurante/)).toBeInTheDocument();
    expect(screen.queryByLabelText('O que mudar no papel')).toBeNull();
  });
});
