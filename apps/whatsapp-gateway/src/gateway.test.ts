import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, existsSync, cpSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantDir, useEncryptedAuthState } from './auth-store.js';
import { createGatewayServer } from './server.js';
import { SessionManager, type ConnectionUpdate, type SocketLike } from './sessions.js';

const key = randomBytes(32);
const TOKEN = 'token-interno-de-teste-1234567890';

/** Socket falso: os testes disparam os eventos que o WhatsApp mandaria. */
class FakeSocket implements SocketLike {
  handlers: Record<string, ((u: ConnectionUpdate) => void)[]> = {};
  user: { id: string } | null = null;
  sent: { jid: string; text: string }[] = [];
  ended = false;
  loggedOut = false;
  ev = {
    on: (event: string, fn: (u: ConnectionUpdate) => void) => {
      (this.handlers[event] ??= []).push(fn);
    },
  } as SocketLike['ev'];
  emit(u: ConnectionUpdate) {
    for (const h of this.handlers['connection.update'] ?? []) h(u);
  }
  async sendMessage(jid: string, c: { text: string }) {
    this.sent.push({ jid, text: c.text });
    return { key: { id: `MSG${this.sent.length}` } };
  }
  async logout() {
    this.loggedOut = true;
  }
  end() {
    this.ended = true;
  }
}

describe('sessão cifrada em disco', () => {
  it('guarda credenciais cifradas, sem nomes legíveis, e não abre em outro restaurante', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-'));
    const t1 = randomUUID();
    const a = await useEncryptedAuthState(dir, t1, key);
    await a.saveCreds();
    await a.state.keys.set({
      'pre-key': { '1': { public: Buffer.from('pub'), private: Buffer.from('priv') } },
    });
    const files = readdirSync(tenantDir(dir, t1));
    expect(files.length).toBe(2);
    for (const f of files) {
      expect(f).toMatch(/^[0-9a-f]{64}\.bin$/);
      expect(readFileSync(join(tenantDir(dir, t1), f)).toString('latin1')).not.toMatch(
        /noiseKey|priv/,
      );
    }
    const b = await useEncryptedAuthState(dir, t1, key);
    expect(b.state.creds.registrationId).toBe(a.state.creds.registrationId);
    const k = await b.state.keys.get('pre-key', ['1']);
    expect(Buffer.from(k['1'].private).toString()).toBe('priv');
    // Copiar a pasta para outro restaurante não funciona (contexto autenticado).
    const t2 = randomUUID();
    cpSync(tenantDir(dir, t1), tenantDir(dir, t2), { recursive: true });
    await expect(useEncryptedAuthState(dir, t2, key)).rejects.toThrow();
    // Outra chave também não.
    await expect(useEncryptedAuthState(dir, t1, randomBytes(32))).rejects.toThrow();
  });

  it('recusa tenantId que não é UUID (sem path traversal)', () => {
    expect(() => tenantDir('/data', '../etc')).toThrow();
  });
});

describe('sessões e API interna', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wa-'));
  const socks: FakeSocket[] = [];
  const mgr = new SessionManager(dir, key, () => {
    const s = new FakeSocket();
    socks.push(s);
    return s;
  });
  const server = createGatewayServer(mgr, TOKEN);
  let base = '';
  const t = randomUUID();
  const call = (path: string, method = 'GET', body?: object, auth = `Bearer ${TOKEN}`) =>
    fetch(`${base}${path}`, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    mgr.close();
    server.close();
  });

  it('exige o token interno', async () => {
    expect((await call(`/v1/sessions/${t}`, 'GET', undefined, 'Bearer errado')).status).toBe(401);
    expect((await call(`/v1/sessions/${t}`, 'GET', undefined, '')).status).toBe(401);
    expect((await call('/v1/sessions/nao-uuid')).status).toBe(404);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('QR Code → conectado → envia; desconectado no celular apaga a sessão', async () => {
    const r1 = await (await call(`/v1/sessions/${t}/start`, 'POST')).json();
    expect(r1.status).toBe('connecting');
    // Sem conexão, enviar dá 409.
    expect(
      (await call(`/v1/sessions/${t}/messages`, 'POST', { to: '5511987654321', text: 'oi' }))
        .status,
    ).toBe(409);
    socks[0].emit({ qr: 'QR-DE-TESTE' });
    expect(await (await call(`/v1/sessions/${t}`)).json()).toMatchObject({
      status: 'qr',
      qr: 'QR-DE-TESTE',
    });
    socks[0].user = { id: '5511999990000:12@s.whatsapp.net' };
    socks[0].emit({ connection: 'open' });
    expect(await (await call(`/v1/sessions/${t}`)).json()).toEqual({
      status: 'connected',
      phone: '5511999990000',
    });
    expect(
      (await call(`/v1/sessions/${t}/messages`, 'POST', { to: '55119', text: 'oi' })).status,
    ).toBe(422);
    const sent = await (
      await call(`/v1/sessions/${t}/messages`, 'POST', {
        to: '5511987654321',
        text: 'Pedido pronto',
      })
    ).json();
    expect(sent).toEqual({ id: 'MSG1' });
    expect(socks[0].sent[0]).toEqual({
      jid: '5511987654321@s.whatsapp.net',
      text: 'Pedido pronto',
    });
    // Outro restaurante não usa a conexão deste.
    expect(
      (
        await call(`/v1/sessions/${randomUUID()}/messages`, 'POST', {
          to: '5511987654321',
          text: 'x',
        })
      ).status,
    ).toBe(409);
    expect(existsSync(tenantDir(dir, t))).toBe(true);
    socks[0].emit({
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect((await (await call(`/v1/sessions/${t}`)).json()).status).toBe('logged_out');
    expect(existsSync(tenantDir(dir, t))).toBe(false);
  });

  it('queda comum reconecta sozinha; logout encerra e apaga', async () => {
    const t2 = randomUUID();
    await call(`/v1/sessions/${t2}/start`, 'POST');
    const first = socks.at(-1)!;
    first.emit({ connection: 'open' });
    first.emit({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 428 } } } });
    expect((await (await call(`/v1/sessions/${t2}`)).json()).status).toBe('connecting');
    await new Promise((r) => setTimeout(r, 1200));
    const second = socks.at(-1)!;
    expect(second).not.toBe(first);
    second.emit({ connection: 'open' });
    expect((await (await call(`/v1/sessions/${t2}`)).json()).status).toBe('connected');
    const out = await (await call(`/v1/sessions/${t2}/logout`, 'POST')).json();
    expect(out.status).toBe('logged_out');
    expect(second.loggedOut).toBe(true);
    expect(existsSync(tenantDir(dir, t2))).toBe(false);
  });
});
