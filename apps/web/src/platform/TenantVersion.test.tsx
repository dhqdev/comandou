import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../design-system';
import { TenantVersionCard, type TenantVersionInfo } from './TenantVersion';

const apiMock = vi.fn();
vi.mock('../lib/api', () => ({
  api: (...a: unknown[]) => apiMock(...a),
  ApiError: class extends Error {},
}));

const behind: TenantVersionInfo = {
  version: 'v0.108.5',
  main: 'v0.110.0',
  separable: true,
  reason: null,
  scheduled: null,
  lastUpgrade: null,
};

const renderIt = () =>
  render(
    <ToastProvider>
      <TenantVersionCard tenantId="t1" />
    </ToastProvider>,
  );

describe('Versão do restaurante', () => {
  beforeEach(() => apiMock.mockReset());
  afterEach(cleanup);

  it('versão anterior: atualiza só depois de confirmar', async () => {
    apiMock.mockResolvedValueOnce(behind).mockResolvedValueOnce({
      ...behind,
      lastUpgrade: { status: 'queued', step: null, error: null, createdAt: '', finishedAt: null },
    });
    renderIt();
    expect(await screen.findByText('versão anterior')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Atualizar agora/ }));
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Atualizar para a v0.110.0?')).toBeInTheDocument();
    const buttons = screen.getAllByText('Atualizar agora', { selector: 'button, button *' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/platform/tenants/t1/version/upgrade', {
        method: 'POST',
        json: {},
      }),
    );
    expect(await screen.findByText('atualizando')).toBeInTheDocument();
  });

  it('na mais nova: selo "atualizado" e sem botões', async () => {
    apiMock.mockResolvedValue({ ...behind, version: 'v0.110.0' });
    renderIt();
    expect(await screen.findByText('atualizado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Atualizar agora/ })).toBeNull();
  });

  it('banco central: explica que acompanha o sistema', async () => {
    apiMock.mockResolvedValue({
      ...behind,
      separable: false,
      reason: 'Restaurante no banco central: acompanha sempre o sistema principal.',
    });
    renderIt();
    expect(await screen.findByText(/acompanha sempre o sistema principal/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Agendar/ })).toBeNull();
  });
});
