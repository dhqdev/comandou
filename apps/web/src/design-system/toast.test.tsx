import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setGuideAccess } from './fix-guide';
import { ToastProvider, useToast } from './toast';

const MSG = 'Nenhum agente de impressão ativo. Configure em Impressão.';

function Fail() {
  const toast = useToast();
  return <button onClick={() => toast(MSG, 'danger')}>imprimir</button>;
}

describe('aviso (toast)', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    act(() => setGuideAccess(null));
  });

  it('erro de impressão repetido não empilha, fecha no X e some sozinho', () => {
    vi.useFakeTimers();
    act(() => setGuideAccess({ role: 'owner', perms: ['printing:manage'] }));
    render(
      <MemoryRouter>
        <ToastProvider>
          <Fail />
        </ToastProvider>
      </MemoryRouter>,
    );
    const btn = screen.getByText('imprimir');
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.getAllByText(MSG)).toHaveLength(1);

    fireEvent.click(screen.getByLabelText('Fechar aviso'));
    expect(screen.queryByText(MSG)).toBeNull();

    fireEvent.click(btn);
    expect(screen.getByText(MSG)).toBeTruthy();
    act(() => vi.advanceTimersByTime(9500));
    expect(screen.queryByText(MSG)).toBeNull();
  });
});
