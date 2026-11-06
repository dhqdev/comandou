import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary, ErrorFallback, isChunkLoadError } from './error-boundary';

let explode = true;
function Bomb() {
  if (explode) throw new Error('quebrou');
  return <p>tela ok</p>;
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    explode = true;
    vi.restoreAllMocks();
  });

  it('erro numa tela mostra o aviso em vez de apagar tudo, e "Tentar de novo" volta', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <div>
        <p>menu</p>
        <ErrorBoundary fallback={ErrorFallback}>
          <Bomb />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByText('menu')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Algo deu errado');
    explode = false;
    fireEvent.click(screen.getByText('Tentar de novo'));
    expect(screen.getByText('tela ok')).toBeTruthy();
  });

  it('trocar de tela (resetKey) limpa o erro', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <ErrorBoundary resetKey="/pdv" fallback={ErrorFallback}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    explode = false;
    rerender(
      <ErrorBoundary resetKey="/pedidos" fallback={ErrorFallback}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('tela ok')).toBeTruthy();
  });

  it('reconhece arquivo de tela que não chegou (Chrome, Firefox e Safari)', () => {
    expect(
      isChunkLoadError(
        new TypeError('Failed to fetch dynamically imported module: /assets/PdvPage-abc.js'),
      ),
    ).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});
