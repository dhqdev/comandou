import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppFrame, type FrameItem } from './app-frame';

// jsdom não rola elementos: a moldura volta o painel ao topo a cada tela.
Element.prototype.scrollTo ||= () => undefined;

const items: FrameItem[] = [
  { key: 'pdv', to: '/', label: 'PDV', icon: <svg /> },
  {
    key: 'cardapio',
    label: 'Cardápio',
    icon: <svg />,
    children: [
      { to: '/cardapio/itens', label: 'Itens', icon: <svg /> },
      { to: '/cardapio/grupos', label: 'Grupos de complementos', icon: <svg /> },
    ],
  },
];

function frame() {
  return render(
    <MemoryRouter>
      <AppFrame brand={<span>Loja</span>} items={items} top={null} tabs={[]}>
        <p>conteúdo</p>
      </AppFrame>
    </MemoryRouter>,
  );
}
const root = (c: HTMLElement) => c.querySelector('.cm-frame') as HTMLElement;
const rail = (c: HTMLElement) => c.querySelector('.cm-rail') as HTMLElement;
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

/** Escolhe um jeito pelo botão do topo da barra (o único lugar onde ele é escolhido). */
function choose(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /^Menu lateral:/ }));
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name }));
}

describe('menu lateral: três jeitos', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('abre aberto por padrão e o botão do topo diz o jeito atual', () => {
    const { container } = frame();
    expect(root(container)).toHaveAttribute('data-rail-mode', 'aberto');
    expect(root(container)).toHaveAttribute('data-pinned');
    expect(screen.getByRole('button', { name: 'Menu lateral: Aberto. Mudar' })).toBeInTheDocument();
  });

  it('quem tinha recolhido (chave antiga) entra no "abre com o mouse"', () => {
    localStorage.setItem('cm-rail-wide', '0');
    const { container } = frame();
    expect(root(container)).toHaveAttribute('data-rail-mode', 'mouse');
  });

  it('o botão do topo mostra os três jeitos e guarda a escolha no aparelho', () => {
    const { container } = frame();
    fireEvent.click(screen.getByRole('button', { name: /^Menu lateral:/ }));
    const options = within(screen.getByRole('menu')).getAllByRole('menuitemradio');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Aberto'),
      expect.stringContaining('Abre com o mouse'),
      expect.stringContaining('Fechado'),
    ]);
    expect(options[0]).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(options[2]);
    expect(root(container)).toHaveAttribute('data-rail-mode', 'fechado');
    expect(root(container)).not.toHaveAttribute('data-pinned');
    expect(localStorage.getItem('cm-rail-mode')).toBe('fechado');
    expect(
      screen.getByRole('button', { name: 'Menu lateral: Fechado. Mudar' }),
    ).toBeInTheDocument();
  });

  it('abre com o mouse: encostar o mouse abre a barra por cima', async () => {
    localStorage.setItem('cm-rail-mode', 'mouse');
    const { container } = frame();
    fireEvent.pointerOver(rail(container), { pointerType: 'mouse' });
    await wait(150);
    expect(root(container)).toHaveAttribute('data-peek');
    expect(root(container)).toHaveAttribute('data-rail', 'wide');
  });

  it('fechado: o mouse em cima não abre e o grupo abre o submenu ao lado', async () => {
    const { container } = frame();
    choose(/^Fechado/);
    fireEvent.pointerOver(rail(container), { pointerType: 'mouse' });
    await wait(150);
    expect(root(container)).not.toHaveAttribute('data-peek');
    expect(root(container)).toHaveAttribute('data-rail', 'narrow');
    // Só ícones: o nome do item fica na dica do mouse.
    expect(screen.getByRole('link', { name: 'PDV' })).toHaveAttribute('title', 'PDV');
    fireEvent.click(screen.getByRole('button', { name: /Cardápio/ }));
    const menu = screen.getByRole('menu', { name: 'Cardápio' });
    expect(within(menu).getByRole('menuitem', { name: 'Itens' })).toBeInTheDocument();
    expect(root(container)).toHaveAttribute('data-rail', 'narrow');
  });
});
