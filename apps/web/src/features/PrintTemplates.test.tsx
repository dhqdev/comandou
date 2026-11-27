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

/** Ids dos blocos marcados no modelo que a prévia recebeu (editor visual). */
const marks = (body: string) => [...body.matchAll(/\uE000([\w-]+)/g)].map((m) => m[1]!);

/** Passa para o modo código e devolve o campo do modelo. */
async function codeMode() {
  fireEvent.click(await screen.findByRole('tab', { name: /Código/ }));
  return (await screen.findByLabelText('Modelo')) as HTMLTextAreaElement;
}

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
    const area = await codeMode();
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
    const area = await codeMode();
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
    const area = await codeMode();
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

  it('editor visual: abre no estilo Clássico, tocar no papel escolhe a parte e salva os blocos', async () => {
    const sent: string[] = [];
    apiMock.mockImplementation((url: string, opts?: Opts) => {
      if (url === '/printing/templates') return Promise.resolve(LIST);
      if (url === '/printing/templates/ai')
        return Promise.resolve({ enabled: true, reason: null, name: 'Bia' });
      if (url === '/printing/templates/preview') {
        sent.push(opts!.json!.body!);
        // A API devolve as marcas de bloco como vieram: logo, nome e endereço da loja.
        const [logo, name, addr] = marks(opts!.json!.body!);
        return Promise.resolve({
          text: `\uE000${logo}\n@@LOGO@@\n\uE000${name}\n@@G@@  FUMAÇA BURGER\n\uE000${addr}\nRua X, 1`,
          logoUrl: null,
          order: 9,
        });
      }
      if (opts?.method === 'PUT') return Promise.resolve({ ok: true });
      return Promise.reject(new Error(`inesperado ${url}`));
    });
    draw();
    // A lista de partes já vem com o Clássico (o padrão do Comandou imprime igual).
    const parts = await screen.findByRole('list', { name: /Partes do papel/ });
    expect(within(parts).getByText('Logo')).toBeInTheDocument();
    expect(within(parts).getByText('Itens')).toBeInTheDocument();
    // A prévia foi pedida com as marcas de bloco, e as marcas não aparecem no papel.
    const name = await screen.findByRole('button', { name: 'Nome da loja' });
    expect(sent[0]).toContain('\uE000');
    expect(screen.getByText('FUMAÇA BURGER')).toBeInTheDocument();
    expect(screen.queryByText(/\uE000/)).toBeNull();
    // Nada mudou ainda: nada para salvar.
    expect(screen.getByRole('button', { name: /Salvar modelo/ })).toBeDisabled();
    fireEvent.click(name);
    expect(name).toHaveAttribute('aria-pressed', 'true');
    const bar = screen.getByRole('toolbar', { name: /Formatar/ });
    // Nome nasce grande: o negrito fica travado (a grande já é negrito). Troca para normal.
    expect(within(bar).getByRole('button', { name: 'Negrito' })).toBeDisabled();
    fireEvent.click(within(bar).getByRole('button', { name: 'Normal' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Negrito' }));
    expect(screen.getByText(/Não salvo/)).toBeInTheDocument();
    // Desfazer volta um passo (o negrito), refazer devolve.
    fireEvent.click(within(bar).getByRole('button', { name: 'Desfazer' }));
    expect(within(bar).getByRole('button', { name: 'Negrito' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(within(bar).getByRole('button', { name: 'Refazer' }));
    fireEvent.click(screen.getByRole('button', { name: /Salvar modelo/ }));
    await screen.findByText(/Modelo salvo/);
    const put = apiMock.mock.calls.find(([, o]) => (o as Opts | undefined)?.method === 'PUT')!;
    const body = (put[1] as Opts).json!.body!;
    expect(body.startsWith('{% comment %}comandou-visual ')).toBe(true);
    expect(body).toContain('{{ loja.nome | upcase | quebra | centro | negrito }}');
    // O que vai para a impressora nunca leva as marcas da prévia.
    expect(body).not.toContain('\uE000');
  });

  it('papel escrito no código: o visual mostra como está e começa de um estilo pronto', async () => {
    apiMock.mockImplementation((url: string, opts?: Opts) => {
      if (url === '/printing/templates') return Promise.resolve(LIST);
      if (url === '/printing/templates/ai')
        return Promise.resolve({ enabled: true, reason: null, name: 'Bia' });
      if (url === '/printing/templates/preview')
        return Promise.resolve({
          text: opts!.json!.body!.includes('\uE000')
            ? `\uE000${marks(opts!.json!.body!)[0]}\nOBRIGADO`
            : 'Volte sempre',
          logoUrl: null,
          order: null,
        });
      return Promise.reject(new Error(`inesperado ${url}`));
    });
    draw();
    fireEvent.click(await screen.findByRole('tab', { name: /Rodapé do cupom fiscal/ }));
    expect(await screen.findByText(/foi escrito no código/)).toBeInTheDocument();
    expect(await screen.findByText('Volte sempre')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Destaque/ }));
    expect(await screen.findByRole('list', { name: /Partes do papel/ })).toBeInTheDocument();
    expect(await screen.findByText('OBRIGADO')).toBeInTheDocument();
    expect(screen.getByText(/Não salvo/)).toBeInTheDocument();
  });
});
