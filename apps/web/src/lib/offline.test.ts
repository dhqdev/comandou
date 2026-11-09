import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';
import {
  enableOffline,
  flushOutbox,
  isOfflineResult,
  needsInternet,
  offlineSnapshot,
  remap,
  resetOfflineForTests,
  setSender,
  type QueuedOp,
} from './offline';
import { memoryStore, setOfflineStore } from './offline-store';

const setOnline = (v: boolean) =>
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(async () => {
  resetOfflineForTests();
  setOfflineStore(memoryStore());
  setOnline(true);
  await enableOffline('u1');
});

afterEach(() => {
  vi.restoreAllMocks();
  resetOfflineForTests();
});

describe('o que funciona sem internet', () => {
  it('cadastros vão para a fila; dinheiro, nota e login precisam de internet', () => {
    expect(needsInternet('POST', '/orders')).toBeNull();
    expect(needsInternet('PATCH', '/customers/1')).toBeNull();
    expect(needsInternet('POST', '/kitchen/items/1/ready')).toBeNull();
    expect(needsInternet('POST', '/orders/1/payments')).toMatch(/Pagamentos/);
    expect(needsInternet('POST', '/tabs/1/payments')).toMatch(/Pagamentos/);
    expect(needsInternet('POST', '/orders/1/pix-receipts/2/approve')).toMatch(/Pix/);
    expect(needsInternet('POST', '/tabs/1/close')).toMatch(/conta/);
    expect(needsInternet('POST', '/cash/sessions')).toMatch(/caixa/);
    expect(needsInternet('POST', '/orders/1/nfce')).toMatch(/nota fiscal/);
    expect(needsInternet('POST', '/auth/login')).toMatch(/Entrar/);
    expect(needsInternet('POST', '/messaging/test')).toMatch(/WhatsApp/);
    expect(needsInternet('POST', '/orders/1/print')).toMatch(/Imprimir/);
    expect(needsInternet('POST', '/products/1/image', new FormData())).toMatch(/fotos/);
  });
});

describe('leitura sem internet', () => {
  it('devolve a última resposta guardada', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json([{ id: 'a' }]));
    expect(await api('/tables')).toEqual([{ id: 'a' }]);
    await new Promise((r) => setTimeout(r, 0));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await api('/tables')).toEqual([{ id: 'a' }]);
    expect(offlineSnapshot().fromCache).toBe(true);
  });

  it('sem nada guardado, avisa que está sem conexão', async () => {
    setOnline(false);
    await expect(api('/nunca-lido')).rejects.toMatchObject({ status: 0 });
  });
});

describe('gravação sem internet', () => {
  it('vai para a fila e devolve um resultado provisório', async () => {
    setOnline(false);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const r = await api<{ id: string; name: string }>('/customers', {
      method: 'POST',
      json: { name: 'Ana' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isOfflineResult(r)).toBe(true);
    expect(r.name).toBe('Ana');
    expect(offlineSnapshot().pending).toHaveLength(1);
    expect(offlineSnapshot().pending[0]!.headers['X-Comandou-Op']).toBeTruthy();
  });

  it('pagamento sem internet não entra na fila', async () => {
    setOnline(false);
    await expect(
      api('/orders/1/payments', { method: 'POST', json: { amount: '10.00' } }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(offlineSnapshot().pending).toHaveLength(0);
  });

  it('rede caiu no meio do envio: entra na fila com a mesma chave que já foi tentada', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await api('/customers', { method: 'POST', json: { name: 'Bia' } });
    const sent = (fetchMock.mock.calls[0]![1]!.headers as Record<string, string>)['X-Comandou-Op'];
    expect(sent).toBeTruthy();
    expect(offlineSnapshot().pending[0]!.headers['X-Comandou-Op']).toBe(sent);
  });
});

describe('sincronização', () => {
  async function queue(path: string, body: unknown, method = 'POST') {
    setOnline(false);
    const r = await api<{ id: string }>(path, { method, json: body });
    setOnline(true);
    return r;
  }

  it('envia na ordem, troca o id provisório e esvazia a fila', async () => {
    const tmp = await queue('/customers', { name: 'Ana' });
    await queue(`/customers/${tmp.id}`, { name: 'Ana Souza' }, 'PATCH');
    const sent: QueuedOp[] = [];
    setSender(async (op) => {
      sent.push(op);
      return { status: 200, body: { id: 'real-1' } };
    });
    await flushOutbox();
    expect(sent.map((o) => `${o.method} ${o.path}`)).toEqual([
      'POST /customers',
      'PATCH /customers/real-1',
    ]);
    expect(offlineSnapshot().pending).toHaveLength(0);
  });

  it('sem rede, para e mantém a fila; recusada vai para revisão', async () => {
    await queue('/customers', { name: 'A' });
    await queue('/customers', { name: 'B' });
    setSender(async () => {
      throw new TypeError('Failed to fetch');
    });
    await flushOutbox();
    expect(offlineSnapshot().pending).toHaveLength(2);

    let n = 0;
    setSender(async () =>
      n++ === 0 ? { status: 422, body: { message: 'Nome inválido' } } : { status: 201, body: {} },
    );
    await flushOutbox();
    expect(offlineSnapshot().pending).toHaveLength(0);
    expect(offlineSnapshot().failed).toHaveLength(1);
    expect(offlineSnapshot().failed[0]!.error).toBe('Nome inválido');
  });

  it('servidor fora (5xx) ou sessão vencida: espera e tenta depois', async () => {
    await queue('/customers', { name: 'A' });
    setSender(async () => ({ status: 503, body: undefined }));
    await flushOutbox();
    setSender(async () => ({ status: 401, body: undefined }));
    await flushOutbox();
    expect(offlineSnapshot().pending).toHaveLength(1);
    expect(offlineSnapshot().failed).toHaveLength(0);
  });

  it('a fila é de quem a fez', async () => {
    await queue('/customers', { name: 'A' });
    await enableOffline('u2');
    expect(offlineSnapshot().pending).toHaveLength(0);
    await enableOffline('u1');
    expect(offlineSnapshot().pending).toHaveLength(1);
  });
});

describe('remap', () => {
  const op = (path: string, json: unknown): QueuedOp => ({
    id: '1',
    opKey: 'k',
    userId: 'u',
    host: 'h',
    method: 'POST',
    path,
    json,
    headers: {},
    label: '',
    createdAt: 0,
    attempts: 0,
    status: 'pending',
  });

  it('mudanças seguidas no mesmo pedido levam a versão nova', () => {
    const out = remap(
      op('/orders/o1/status', { to: 'ready', expectedVersion: 3 }),
      new Map(),
      new Map([['o1', 4]]),
    );
    expect(out.json).toEqual({ to: 'ready', expectedVersion: 4 });
  });

  it('troca o id provisório também no corpo', () => {
    const out = remap(
      op('/orders', { tabId: 'offline-abc', items: [] }),
      new Map([['offline-abc', 'tab-9']]),
    );
    expect(out.json).toEqual({ tabId: 'tab-9', items: [] });
  });
});
