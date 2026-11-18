import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_BUILD } from '../lib/app-version';
import { UpdatePrompt } from './UpdatePrompt';

const freshReload = vi.fn(async () => undefined);
vi.mock('../lib/fresh-reload', () => ({ freshReload: () => freshReload() }));

const sw = vi.hoisted(() => ({
  waiting: false,
  update: vi.fn(async (_reload?: boolean) => undefined),
}));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [sw.waiting, () => undefined],
    offlineReady: [false, () => undefined],
    updateServiceWorker: sw.update,
  }),
}));

let serverBuild = APP_BUILD;

beforeEach(() => {
  serverBuild = APP_BUILD;
  sw.waiting = false;
  sw.update.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ build: serverBuild }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('UpdatePrompt', () => {
  it('fica escondido enquanto o servidor entrega a mesma versão', async () => {
    render(<UpdatePrompt />);
    await act(async () => undefined);
    expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument();
  });

  it('mostra "Atualizar" quando sai versão nova e some ao dispensar', async () => {
    vi.useFakeTimers();
    render(<UpdatePrompt />);
    await act(async () => undefined);
    expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument();

    serverBuild = 'outra-build';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText('Nova versão disponível')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(freshReload).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument();
  });

  it('service worker em espera com a tela já na versão do servidor: troca sem aviso', async () => {
    sw.waiting = true;
    render(<UpdatePrompt />);
    await waitFor(() => expect(sw.update).toHaveBeenCalledWith(false));
    expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument();
  });

  it('service worker em espera sem resposta do servidor: mostra o aviso', async () => {
    sw.waiting = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('sem internet');
      }),
    );
    render(<UpdatePrompt />);
    expect(await screen.findByText('Nova versão disponível')).toBeInTheDocument();
    expect(sw.update).not.toHaveBeenCalled();
  });

  it('ignora resposta inválida (ex.: index.html no lugar do version.json)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 200 })),
    );
    render(<UpdatePrompt />);
    await act(async () => undefined);
    expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument();
  });
});
