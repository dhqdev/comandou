import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown, safeAppPath } from '../features/chat/markdown';
import { Alert } from './components';
import { setGuideAccess } from './fix-guide';

const cashier = { role: 'cashier', perms: ['orders:write', 'cash:operate', 'tables:operate'] };

describe('caminho para resolver', () => {
  afterEach(() => {
    cleanup();
    act(() => setGuideAccess(null));
  });

  it('erro conhecido mostra o que fazer e o botão para a tela', () => {
    act(() => setGuideAccess(cashier));
    render(
      <MemoryRouter>
        <Alert tone="danger">Caixa fechado: abra um caixa para continuar</Alert>
      </MemoryRouter>,
    );
    expect(screen.getByText(/Abra o caixa com o troco inicial/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Abrir o caixa/ })).toHaveAttribute('href', '/caixa');
  });

  it('sem acesso à tela, diz a quem pedir em vez do botão', () => {
    act(() => setGuideAccess({ role: 'waiter', perms: ['orders:write', 'tables:operate'] }));
    render(
      <MemoryRouter>
        <Alert tone="danger">Caixa fechado: abra um caixa para continuar</Alert>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/Peça a quem cuida do caixa/)).toBeInTheDocument();
  });

  it('garçom vai para o mapa do app dele', () => {
    act(() => setGuideAccess({ role: 'waiter', perms: ['orders:write', 'tables:operate'] }));
    render(
      <MemoryRouter>
        <Alert tone="danger">Comanda não está aberta</Alert>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', '/garcom/mesas');
  });

  it('fora da equipe logada (cardápio do cliente) mostra só o erro', () => {
    render(
      <MemoryRouter>
        <Alert tone="danger">Caixa fechado: abra um caixa para continuar</Alert>
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Caixa fechado: abra um caixa para continuar',
    );
    expect(screen.queryByText(/troco inicial/)).toBeNull();
  });
});

describe('links do assistente', () => {
  it('aceita só caminhos internos', () => {
    expect(safeAppPath('/caixa')).toBe('/caixa');
    expect(safeAppPath('/fiscal/configuracao?foco=secao-focus')).toBe(
      '/fiscal/configuracao?foco=secao-focus',
    );
    expect(safeAppPath('//evil.com')).toBeNull();
    expect(safeAppPath('https://evil.com')).toBeNull();
    expect(safeAppPath('javascript:alert(1)')).toBeNull();
    expect(safeAppPath('/a/../b')).toBeNull();
    // Tela que não existe (a IA inventou): vira texto, não link para "não encontrada".
    expect(safeAppPath('/tela-inventada')).toBeNull();
    expect(safeAppPath('/agenda')).toBe('/agenda');
    expect(safeAppPath('/estoque/precificacao')).toBe('/estoque/precificacao');
  });

  it('[tela](/caminho) vira botão; endereço de fora vira texto', () => {
    render(
      <MemoryRouter>
        <Markdown text={'Vá em **[Caixa](/caixa)** e depois [site](https://x.com).'} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Caixa/ })).toHaveAttribute('href', '/caixa');
    expect(screen.queryByRole('link', { name: /site/ })).toBeNull();
    expect(screen.getByText('site')).toBeInTheDocument();
  });

  it('caminho que não existe (a IA inventou) não vira link para "não encontrada"', () => {
    expect(safeAppPath('/conta/assinatura')).toBeNull();
    expect(safeAppPath('/financeiro/dre')).toBeNull();
    expect(safeAppPath(`${window.location.origin}/conta/uso-ia`)).toBe('/conta/uso-ia');
  });
});

describe('links do assistente que a IA esqueceu', () => {
  afterEach(() => {
    cleanup();
    act(() => setGuideAccess(null));
  });
  const owner = {
    role: 'owner',
    perms: ['plan:read', 'finance:read', 'settings:manage', 'cash:operate', 'orders:write'],
  };
  const answer =
    'Você vê em **Conta › Uso de IA**. A mensalidade fica em [Assinatura](/assinatura) e o **DRE** no Financeiro.';

  it('nome de lugar em negrito vira o botão que leva até lá', () => {
    act(() => setGuideAccess(owner));
    render(
      <MemoryRouter>
        <Markdown text={answer} autoLink />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Conta › Uso de IA/ })).toHaveAttribute(
      'href',
      '/conta/uso-ia',
    );
    // Link com caminho inventado vai para a tela certa pelo nome.
    expect(screen.getByRole('link', { name: /Assinatura/ })).toHaveAttribute('href', '/plano');
    expect(screen.getByRole('link', { name: /DRE/ })).toHaveAttribute(
      'href',
      '/financeiro?aba=dre',
    );
  });

  it('só leva aonde a pessoa abre; garçom fica no app dele', () => {
    act(() => setGuideAccess({ role: 'cashier', perms: ['cash:operate', 'orders:write'] }));
    const { unmount } = render(
      <MemoryRouter>
        <Markdown text={answer} autoLink />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /Uso de IA/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /DRE/ })).toBeNull();
    unmount();
    act(() => setGuideAccess({ role: 'waiter', perms: ['orders:write', 'tables:operate'] }));
    render(
      <MemoryRouter>
        <Markdown text={'Vá em **Salão**.'} autoLink />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('sem pedir, o negrito fica negrito', () => {
    act(() => setGuideAccess(owner));
    render(
      <MemoryRouter>
        <Markdown text={'Veja em **Conta › Uso de IA**.'} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
