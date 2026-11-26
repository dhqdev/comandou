import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_BUILD } from '../lib/app-version';
import { FILL_MS, UpdatePrompt } from './UpdatePrompt';

const freshReload = vi.fn(async () => undefined);
vi.mock('../lib/fresh-reload', async (orig) => ({
  ...(await orig<typeof import('../lib/fresh-reload')>()),
  freshReload: () => freshReload(),
}));

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
const NOTE = 'Atualizando para a versão nova…';

beforeEach(() => {
  serverBuild = APP_BUILD;
  sw.waiting = false;
  sw.update.mockClear();
  freshReload.mockClear();
  sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ build: serverBuild }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('UpdatePrompt (atualiza sozinho)', () => {
  it('não mostra nada enquanto o servidor entrega a mesma versão', async () => {
    render(<UpdatePrompt />);
    await act(async () => undefined);
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(freshReload).not.toHaveBeenCalled();
  });

  it('versão nova: mostra a faixa, sem botão, e no fim limpa o cache e recarrega', async () => {
    vi.useFakeTimers();
    render(<UpdatePrompt />);
    await act(async () => undefined);

    serverBuild = 'outra-build';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(freshReload).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FILL_MS);
    });
    expect(freshReload).toHaveBeenCalledOnce();
  });

  it('espera a pessoa parar de digitar', async () => {
    vi.useFakeTimers();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    serverBuild = 'outra-build';
    render(<UpdatePrompt />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();

    input.blur();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it('espera a janela aberta fechar (venda no meio)', async () => {
    vi.useFakeTimers();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);
    serverBuild = 'outra-build';
    render(<UpdatePrompt />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();

    dialog.remove();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it('a mesma build já tentada nesta aba não recarrega de novo (sem loop)', async () => {
    sessionStorage.setItem('cm.freshReload', 'outra-build');
    serverBuild = 'outra-build';
    render(<UpdatePrompt />);
    await act(async () => undefined);
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('service worker em espera com a tela já na versão do servidor: troca sem aviso', async () => {
    sw.waiting = true;
    render(<UpdatePrompt />);
    await waitFor(() => expect(sw.update).toHaveBeenCalledWith(false));
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('service worker em espera sem resposta do servidor: troca em silêncio, sem aviso', async () => {
    sw.waiting = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('sem internet');
      }),
    );
    render(<UpdatePrompt />);
    await waitFor(() => expect(sw.update).toHaveBeenCalledWith(false));
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('ignora resposta inválida (ex.: index.html no lugar do version.json)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 200 })),
    );
    render(<UpdatePrompt />);
    await act(async () => undefined);
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });
});
