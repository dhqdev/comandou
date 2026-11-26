import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../design-system';
import { UpdatePanel, updateProgress } from './UpdatePanel';
import type { ServerService } from './types';

const apiMock = vi.fn();
vi.mock('../lib/api', () => ({
  api: (...a: unknown[]) => apiMock(...a),
  ApiError: class extends Error {},
}));

const svc = (name: string, image: string): ServerService => ({
  id: name,
  name,
  stack: 'comandou',
  image,
  mode: 'replicated',
  desired: 1,
  running: 1,
  updatedAt: '',
  updateState: null,
  lastError: null,
});
const SERVICES = [
  svc('comandou_api', 'ghcr.io/dhqdev/comandou-api:v0.10.0'),
  svc('comandou_web', 'ghcr.io/dhqdev/comandou-web:v0.10.0'),
  svc('comandou_db', 'postgres:16-alpine'),
];
const renderIt = (services = SERVICES) =>
  render(
    <ToastProvider>
      <UpdatePanel services={services} onChanged={() => undefined} />
    </ToastProvider>,
  );

describe('Atualizar sistema', () => {
  beforeEach(() => apiMock.mockReset());
  afterEach(cleanup);

  it('mostra instalada x última e pede confirmação antes de atualizar', async () => {
    apiMock.mockResolvedValue({
      latest: { version: 'v0.11.0', url: '', publishedAt: null },
      job: null,
    });
    renderIt();
    const button = await screen.findByRole('button', { name: /Atualizar sistema/ });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByText('v0.10.0')).toBeInTheDocument();
    expect(screen.getByText('2 serviço(s) para atualizar')).toBeInTheDocument();
    fireEvent.click(button);
    expect(await screen.findByText(/migração do banco primeiro/)).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith(
      '/platform/server/update',
      expect.objectContaining({ method: 'POST' }),
    );
    fireEvent.click(screen.getByText('Atualizar para v0.11.0', { selector: 'button' }));
    expect(apiMock).toHaveBeenCalledWith('/platform/server/update', {
      method: 'POST',
      json: { version: 'v0.11.0' },
    });
    // O clique fecha a janela na hora e a barra já aparece.
    expect(screen.queryByText(/migração do banco primeiro/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Andamento da atualização' }),
    ).toBeInTheDocument();
  });

  it('a barra enche pelos serviços já trocados', () => {
    const step = (service: string, status: 'ok' | 'running' | 'pending') => ({
      service,
      from: 'v0.10.0',
      to: 'v0.11.0',
      status,
    });
    const p = updateProgress(
      {
        id: 'j',
        version: 'v0.11.0',
        startedAt: '',
        status: 'running',
        steps: [
          step('comandou_migrate', 'ok'),
          step('comandou_api', 'running'),
          step('comandou_web', 'pending'),
          step('comandou_agent', 'pending'),
        ],
      },
      false,
    );
    expect(p?.value).toBe(0.25);
    expect(p?.note).toBe('1 de 4 · api');
    expect(updateProgress(null, true)?.value).toBeNull();
    expect(updateProgress(null, false)).toBeNull();
  });

  it('já na última versão: botão desligado e selo "atualizado"', async () => {
    apiMock.mockResolvedValue({
      latest: { version: 'v0.10.0', url: '', publishedAt: null },
      job: null,
    });
    renderIt();
    expect(await screen.findByText('atualizado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Atualizar sistema/ })).toBeDisabled();
  });

  it('sem conseguir consultar o GitHub: avisa e não deixa atualizar', async () => {
    apiMock.mockResolvedValue({
      latest: null,
      error: 'Não consegui consultar a última versão: GitHub respondeu 403',
      job: null,
    });
    renderIt();
    expect(await screen.findByText(/Não consegui consultar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Atualizar sistema/ })).toBeDisabled();
  });

  it('mostra o andamento e o motivo quando para', async () => {
    apiMock.mockResolvedValue({
      latest: { version: 'v0.11.0', url: '', publishedAt: null },
      job: {
        id: 'j',
        version: 'v0.11.0',
        startedAt: '',
        status: 'failed',
        message: 'Parou em comandou_api: a versão nova não subiu',
        steps: [
          { service: 'comandou_migrate', from: 'v0.10.0', to: 'v0.11.0', status: 'ok' },
          {
            service: 'comandou_api',
            from: 'v0.10.0',
            to: 'v0.11.0',
            status: 'failed',
            message: 'rollback_completed',
          },
        ],
      },
    });
    renderIt();
    expect(await screen.findByText(/Parou em comandou_api/)).toBeInTheDocument();
    expect(screen.getByText('falhou')).toBeInTheDocument();
  });
});
