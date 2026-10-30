import { act, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { lazyPage } from './lazy-page';

describe('lazyPage', () => {
  it('baixa uma vez e depois desenha sem passar pelo carregando', async () => {
    const load = vi.fn(async () => ({ Hello: ({ name }: { name: string }) => <p>Oi {name}</p> }));
    const Page = lazyPage(load, (m) => m.Hello);
    const ui = render(
      <Suspense fallback={<p>carregando</p>}>
        <Page name="Ana" />
      </Suspense>,
    );
    expect(screen.getByText('carregando')).toBeTruthy();
    await act(() => Page.preload());
    expect(await screen.findByText('Oi Ana')).toBeTruthy();
    ui.unmount();
    render(
      <Suspense fallback={<p>carregando</p>}>
        <Page name="Bia" />
      </Suspense>,
    );
    // já baixada: aparece na primeira pintura
    expect(screen.getByText('Oi Bia')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('tenta de novo quando o download falha', async () => {
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error('rede');
      return { P: () => <p>ok</p> };
    });
    const Page = lazyPage(load, (m) => m.P);
    await expect(Page.preload()).rejects.toThrow('rede');
    fail = false;
    await act(() => Page.preload());
    render(<Page />);
    expect(screen.getByText('ok')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
