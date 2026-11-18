import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, existsSync, cpSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantDir, useEncryptedAuthState } from './auth-store.js';
import { InboundForwarder } from './forwarder.js';
import { createGatewayServer } from './server.js';
import {
  brazilVariants,
  SessionManager,
  TooManyMessagesError,
  type InboundMessage,
  type ConnectionUpdate,
  type SocketLike,
  type SocketOptions,
} from './sessions.js';

const key = randomBytes(32);
const TOKEN = 'token-interno-de-teste-1234567890';

/** Socket falso: os testes disparam os eventos que o WhatsApp mandaria. */
class FakeSocket implements SocketLike {
  handlers: Record<string, ((u: ConnectionUpdate) => void)[]> = {};
  user: { id: string } | null = null;
  sent: { jid: string; text: string }[] = [];
  presences: string[] = [];
  reads: unknown[] = [];
  reacts: unknown[] = [];
  docs: { jid: string; fileName: string; caption?: string; size: number }[] = [];
  ws = { isOpen: true, on: () => undefined };
  /** Falha o próximo envio como se o socket tivesse morrido por baixo. */
  failNext = false;
  query?: SocketLike['query'];
  generateMessageTag?: () => string;
  ended = false;
  loggedOut = false;
  /** Números que "têm WhatsApp" (JID devolvido pela consulta). */
  accounts = new Set(['5511987654321', '551187654321', '5511999990000']);
  opts?: SocketOptions;
  ev = {
    on: (event: string, fn: (u: ConnectionUpdate) => void) => {
      (this.handlers[event] ??= []).push(fn);
    },
  } as SocketLike['ev'];
  emit(u: ConnectionUpdate) {
    for (const h of this.handlers['connection.update'] ?? []) h(u);
  }
  emitUpsert(messages: unknown[], type = 'notify') {
    for (const h of this.handlers['messages.upsert'] ?? [])
      (h as unknown as (u: unknown) => void)({ messages, type });
  }
  async sendMessage(
    jid: string,
    c:
      | { text: string }
      | { react: unknown }
      | { document: Buffer; fileName: string; caption?: string },
  ) {
    if (this.failNext) {
      this.failNext = false;
      throw Object.assign(new Error('Connection Closed'), { output: { statusCode: 428 } });
    }
    if ('document' in c) {
      this.docs.push({ jid, fileName: c.fileName, caption: c.caption, size: c.document.length });
      return { key: { id: `DOC${this.docs.length}` } };
    }
    if ('react' in c) {
      this.reacts.push({ jid, ...c });
      return { key: { id: 'R' } };
    }
    this.sent.push({ jid, text: c.text });
    return { key: { id: `MSG${this.sent.length}` } };
  }
  async onWhatsApp(...jids: string[]) {
    return jids
      .map((j) => j.split('@')[0])
      .filter((n) => this.accounts.has(n))
      .map((n) => ({ jid: `${n}@s.whatsapp.net`, exists: true }));
  }
  async sendPresenceUpdate(type: string, jid?: string) {
    this.presences.push(jid ? `${type}:${jid}` : type);
  }
  async readMessages(keys: unknown[]) {
    this.reads.push(...keys);
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
  const mgr = new SessionManager(dir, key, (_state, opts) => {
    const s = new FakeSocket();
    s.opts = opts;
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
    expect(await (await call(`/v1/sessions/${t}`)).json()).toMatchObject({
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
    expect(sent).toEqual({ id: 'MSG1', jid: '5511987654321@s.whatsapp.net' });
    expect(socks[0].sent[0]).toEqual({
      jid: '5511987654321@s.whatsapp.net',
      text: 'Pedido pronto',
    });
    // PDF (cardápio, calendário): só PDF de verdade, nome .pdf e dentro do limite.
    const pdf = Buffer.from('%PDF-1.7\nconteudo').toString('base64');
    const doc = await call(`/v1/sessions/${t}/document`, 'POST', {
      to: '5511987654321',
      fileName: 'Cardápio Casa.pdf',
      caption: 'Nosso cardápio',
      data: pdf,
    });
    expect(doc.status).toBe(200);
    expect(socks[0].docs[0]).toMatchObject({
      fileName: 'Cardápio Casa.pdf',
      caption: 'Nosso cardápio',
    });
    for (const bad of [
      { fileName: 'virus.exe', data: pdf },
      { fileName: '../x.pdf', data: pdf },
      { fileName: 'a.pdf', data: Buffer.from('MZ executavel').toString('base64') },
    ])
      expect(
        (await call(`/v1/sessions/${t}/document`, 'POST', { to: '5511987654321', ...bad })).status,
      ).toBe(422);
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

  const close = (sock: FakeSocket, statusCode: number) =>
    sock.emit({ connection: 'close', lastDisconnect: { error: { output: { statusCode } } } });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('acha o JID certo (com ou sem o 9), recusa número sem WhatsApp e guarda para reenvio', async () => {
    const t3 = randomUUID();
    await call(`/v1/sessions/${t3}/start`, 'POST');
    const sock = socks.at(-1)!;
    sock.emit({ connection: 'open' });
    // Conta antiga, sem o 9: o envio vai para o JID que o WhatsApp devolveu.
    sock.accounts.delete('5511987654321');
    const r = await call(`/v1/sessions/${t3}/messages`, 'POST', {
      to: '5511987654321',
      text: 'Saiu para entrega',
    });
    expect(r.status).toBe(200);
    expect(sock.sent.at(-1)!.jid).toBe('551187654321@s.whatsapp.net');
    const { id } = await r.json();
    expect(await sock.opts!.getMessage({ id })).toEqual({ conversation: 'Saiu para entrega' });
    // Sem WhatsApp: 422 (a API marca como falha, sem ficar tentando).
    const no = await call(`/v1/sessions/${t3}/messages`, 'POST', {
      to: '5521912345678',
      text: 'x',
    });
    expect(no.status).toBe(422);
    await call(`/v1/sessions/${t3}/logout`, 'POST');
  });

  it('QR Code não lido expira sem reconectar e apaga a sessão incompleta', async () => {
    const t4 = randomUUID();
    await call(`/v1/sessions/${t4}/start`, 'POST');
    const sock = socks.at(-1)!;
    sock.emit({ qr: 'QR' });
    const n = socks.length;
    close(sock, 408);
    await wait(1200);
    expect(socks.length).toBe(n);
    const st = await (await call(`/v1/sessions/${t4}`)).json();
    expect(st.status).toBe('disconnected');
    expect(st.error).toMatch(/expirou/);
    expect(existsSync(tenantDir(dir, t4))).toBe(false);
    // Dá para gerar outro QR Code.
    expect((await (await call(`/v1/sessions/${t4}/start`, 'POST')).json()).status).toBe(
      'connecting',
    );
    expect(socks.length).toBe(n + 1);
    await call(`/v1/sessions/${t4}/logout`, 'POST');
  });

  it('reinício pedido pelo WhatsApp reconecta na hora; sessão aberta em outro lugar para', async () => {
    const t5 = randomUUID();
    await call(`/v1/sessions/${t5}/start`, 'POST');
    const a = socks.at(-1)!;
    close(a, 515);
    await wait(50);
    const b = socks.at(-1)!;
    expect(b).not.toBe(a);
    b.emit({ connection: 'open' });
    const n = socks.length;
    close(b, 440);
    await wait(1200);
    expect(socks.length).toBe(n);
    const st = await (await call(`/v1/sessions/${t5}`)).json();
    expect(st.status).toBe('disconnected');
    expect(existsSync(tenantDir(dir, t5))).toBe(true); // credenciais mantidas
    // Evento atrasado do socket antigo não muda nada.
    a.emit({ connection: 'open' });
    expect((await (await call(`/v1/sessions/${t5}`)).json()).status).toBe('disconnected');
    await call(`/v1/sessions/${t5}/logout`, 'POST');
  });

  it('logout durante a espera da reconexão cancela a reconexão', async () => {
    const t6 = randomUUID();
    await call(`/v1/sessions/${t6}/start`, 'POST');
    const a = socks.at(-1)!;
    a.emit({ connection: 'open' });
    close(a, 428);
    const n = socks.length;
    await call(`/v1/sessions/${t6}/logout`, 'POST');
    await wait(1200);
    expect(socks.length).toBe(n);
    expect((await (await call(`/v1/sessions/${t6}`)).json()).status).toBe('logged_out');
  });
});

describe('reabrir sessões ao iniciar', () => {
  it('pula a pasta de QR nunca lido e não trava nas outras se uma estiver corrompida', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-'));
    const pending = randomUUID();
    await useEncryptedAuthState(dir, pending, key).then((a) => a.saveCreds());
    const bad = randomUUID();
    const b = await useEncryptedAuthState(dir, bad, key);
    b.state.creds.me = { id: '5511999990000:1@s.whatsapp.net' };
    await b.saveCreds();
    const good = randomUUID();
    const g = await useEncryptedAuthState(dir, good, key);
    g.state.creds.me = { id: '5511999990001:1@s.whatsapp.net' };
    await g.saveCreds();
    // Corrompe a sessão "bad".
    const f = readdirSync(tenantDir(dir, bad))[0];
    writeFileSync(join(tenantDir(dir, bad), f), randomBytes(64));
    const opened: string[] = [];
    const mgr = new SessionManager(dir, key, (state) => {
      opened.push(state.creds.me!.id);
      return new FakeSocket();
    });
    await mgr.restoreAll();
    expect(opened).toEqual(['5511999990001:1@s.whatsapp.net']);
    expect(existsSync(tenantDir(dir, pending))).toBe(false);
    expect(mgr.status(good).status).toBe('connecting');
    expect(mgr.status(bad)).toMatchObject({ status: 'disconnected' });
    mgr.close();
  });

  it('variações do celular brasileiro', () => {
    expect(brazilVariants('5511987654321')).toEqual(['5511987654321', '551187654321']);
    expect(brazilVariants('551187654321')).toEqual(['551187654321', '5511987654321']);
    expect(brazilVariants('551132654321')).toEqual(['551132654321']); // fixo
    expect(brazilVariants('14155550123')).toEqual(['14155550123']);
  });
});

describe('religação e recursos do Baileys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wa-'));
  const socks: FakeSocket[] = [];
  const inbound: InboundMessage[] = [];
  const mgr = new SessionManager(
    dir,
    key,
    (_state, opts) => {
      const s = new FakeSocket();
      s.opts = opts;
      socks.push(s);
      return s;
    },
    undefined,
    {
      timings: {
        heartbeatMs: 3_600_000, // o teste chama o vigia na mão
        staleMs: 1000,
        keepAliveMs: 1, // só o socket com query (teste do ping) pinga de verdade
        openTimeoutMs: 150,
        backoffBaseMs: 10,
        sendWaitMs: 1500,
        onlineMs: 100,
        reconnectSpreadMs: 0,
        sendGapMs: 0,
      },
      onInbound: (m) => inbound.push(m),
    },
  );
  const server = createGatewayServer(mgr, TOKEN);
  let base = '';
  const call = (path: string, body?: object) =>
    fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** Sessão nova já conectada (pareada). */
  async function connected() {
    const t = randomUUID();
    await mgr.start(t);
    const sock = socks.at(-1)!;
    sock.user = { id: '5511999990000:3@s.whatsapp.net' };
    sock.emit({ connection: 'open' });
    return { t, sock };
  }
  /** Espera o próximo socket (religação) e abre a conexão. */
  async function nextOpen(prev: FakeSocket) {
    for (let i = 0; i < 100 && socks.at(-1) === prev; i++) await wait(10);
    const s = socks.at(-1)!;
    expect(s).not.toBe(prev);
    s.user = prev.user;
    s.emit({ connection: 'open' });
    return s;
  }

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    mgr.close();
    server.close();
  });

  it('vigia derruba conexão muda (meio-aberta) e religa sozinho', async () => {
    const { t, sock } = await connected();
    mgr.watchdog(Date.now()); // acabou de receber: nada muda
    expect(socks.at(-1)).toBe(sock);
    mgr.watchdog(Date.now() + 5000); // 5 s sem nada do servidor (limite do teste: 1 s)
    expect(sock.ended).toBe(true);
    expect(mgr.status(t)).toMatchObject({ status: 'connecting', reconnecting: true });
    await nextOpen(sock);
    expect(mgr.status(t).status).toBe('connected');
    await mgr.logout(t);
  });

  it('vigia religa websocket fechado sem evento de close', async () => {
    const { t, sock } = await connected();
    sock.ws.isOpen = false;
    mgr.watchdog();
    expect(sock.ended).toBe(true);
    await nextOpen(sock);
    expect(mgr.status(t).status).toBe('connected');
    await mgr.logout(t);
  });

  it('servidor que não responde ao conectar: tenta de novo', async () => {
    const t = randomUUID();
    await mgr.start(t);
    const a = socks.at(-1)!;
    a.emit({ connection: 'open' });
    close(a, 428);
    // o socket da religação nunca responde (nem QR, nem open): o prazo vence e vem outro
    for (let i = 0; i < 100 && socks.at(-1) === a; i++) await wait(10);
    const mute = socks.at(-1)!;
    await nextOpen(mute);
    expect(mute.ended).toBe(true);
    expect(mgr.status(t).status).toBe('connected');
    await mgr.logout(t);
  });

  it('envio com a conexão caindo espera a religação em vez de falhar', async () => {
    const { t, sock } = await connected();
    close(sock, 428);
    const sending = call(`/v1/sessions/${t}/messages`, {
      to: '5511987654321',
      text: 'Pedido pronto',
    });
    const s2 = await nextOpen(sock);
    const r = await sending;
    expect(r.status).toBe(200);
    expect(s2.sent.at(-1)!.text).toBe('Pedido pronto');
    await mgr.logout(t);
  });

  it('socket que morre no meio do envio: religa e manda de novo uma vez', async () => {
    const { t, sock } = await connected();
    sock.failNext = true;
    const sending = mgr.send(t, { to: '5511987654321' }, 'oi');
    const s2 = await nextOpen(sock);
    expect(await sending).toMatchObject({ id: 'MSG1' });
    expect(sock.sent).toHaveLength(0);
    expect(s2.sent).toHaveLength(1);
    await mgr.logout(t);
  });

  it('parado há muito tempo: ping antes de enviar; sem resposta, religa', async () => {
    const { t, sock } = await connected();
    let pings = 0;
    sock.generateMessageTag = () => 'tag';
    sock.query = async () => {
      pings++;
      throw new Error('Timed Out');
    };
    await wait(5); // parado há mais que o ping (no teste, 1 ms)
    const sending = mgr.send(t, { to: '5511987654321' }, 'oi');
    const s2 = await nextOpen(sock);
    await sending;
    expect(pings).toBe(1);
    expect(s2.sent).toHaveLength(1);
    await mgr.logout(t);
  });

  it('QR Code ainda não lido: enviar responde 409 na hora', async () => {
    const t = randomUUID();
    await mgr.start(t);
    socks.at(-1)!.emit({ qr: 'QR' });
    const started = Date.now();
    expect(
      (await call(`/v1/sessions/${t}/messages`, { to: '5511987654321', text: 'x' })).status,
    ).toBe(409);
    expect(Date.now() - started).toBeLessThan(500);
    await mgr.logout(t);
  });

  it('repassa mensagens de clientes (texto, legenda, LID) e ignora grupo, status e as próprias', async () => {
    const { t, sock } = await connected();
    inbound.length = 0;
    sock.emitUpsert([
      {
        key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'A1' },
        message: { conversation: 'Oi, tem pizza?' },
        pushName: 'Ana',
        messageTimestamp: 1_760_000_000,
      },
      {
        key: {
          remoteJid: '123456789012345@lid',
          id: 'A2',
          senderPn: '5511911112222@s.whatsapp.net',
        },
        message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'quero 2' } } } },
      },
      {
        key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'A3' },
        message: { imageMessage: { caption: 'essa aqui' } },
      },
      {
        key: { remoteJid: '120363000000000000@g.us', id: 'G1', participant: '5511@s.whatsapp.net' },
        message: { conversation: 'grupo' },
      },
      { key: { remoteJid: 'status@broadcast', id: 'S1' }, message: { conversation: 'status' } },
      {
        key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'M1', fromMe: true },
        message: { conversation: 'minha' },
      },
      {
        key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'P1' },
        message: { protocolMessage: { type: 0 } },
      },
      {
        key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'R1' },
        message: { reactionMessage: { text: '👍' } },
      },
    ]);
    sock.emitUpsert(
      [
        {
          key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'H1' },
          message: { conversation: 'histórico' },
        },
      ],
      'append',
    );
    expect(inbound.map((m) => [m.id, m.kind, m.text, m.from, m.jid])).toEqual([
      ['A1', 'text', 'Oi, tem pizza?', '5511987654321', '5511987654321@s.whatsapp.net'],
      ['A2', 'text', 'quero 2', '5511911112222', '123456789012345@lid'],
      ['A3', 'image', 'essa aqui', '5511987654321', '5511987654321@s.whatsapp.net'],
    ]);
    expect(inbound[0]).toMatchObject({
      tenantId: t,
      pushName: 'Ana',
      timestamp: '2025-10-09T08:53:20.000Z',
    });
    await mgr.logout(t);
  });

  it('digitando, lido, reação e online pelo HTTP; responde no JID da conversa', async () => {
    const { t, sock } = await connected();
    const jid = '123456789012345@lid';
    expect((await call(`/v1/sessions/${t}/read`, { jid, id: 'A2' })).status).toBe(200);
    expect(sock.reads).toEqual([{ remoteJid: jid, id: 'A2', fromMe: false }]);
    expect((await call(`/v1/sessions/${t}/typing`, { jid, ms: 50 })).status).toBe(200);
    expect(sock.presences).toEqual(['available', `composing:${jid}`]);
    await wait(80);
    expect(sock.presences.at(-1)).toBe(`paused:${jid}`);
    const r = await call(`/v1/sessions/${t}/messages`, { jid, text: 'Temos sim!', typingMs: 30 });
    expect(await r.json()).toMatchObject({ jid });
    expect(sock.sent.at(-1)).toEqual({ jid, text: 'Temos sim!' });
    expect(sock.presences.at(-1)).toBe(`paused:${jid}`);
    await wait(150); // passou o tempo de "online": volta a offline (o celular notifica de novo)
    expect(sock.presences.at(-1)).toBe('unavailable');
    expect((await call(`/v1/sessions/${t}/react`, { jid, id: 'A2', emoji: '👍' })).status).toBe(
      200,
    );
    expect(sock.reacts).toHaveLength(1);
    expect((await call(`/v1/sessions/${t}/presence`, { state: 'available' })).status).toBe(200);
    expect(sock.presences.at(-1)).toBe('available');
    // validação
    expect((await call(`/v1/sessions/${t}/read`, { jid: '120363@g.us', id: 'A2' })).status).toBe(
      422,
    );
    expect((await call(`/v1/sessions/${t}/presence`, { state: 'x' })).status).toBe(422);
    expect(
      (await call(`/v1/sessions/${t}/messages`, { jid: 'status@broadcast', text: 'x' })).status,
    ).toBe(422);
    await mgr.logout(t);
  });

  it('cada restaurante com o próprio número, ao mesmo tempo e isolado dos outros', async () => {
    // conexões de vários restaurantes abertas ao mesmo tempo, cada uma com o seu número
    const lojas: { t: string; sock: FakeSocket; phone: string }[] = [];
    for (const phone of ['5511911110001', '5521922220002', '5531933330003']) {
      const t = randomUUID();
      await mgr.start(t);
      const sock = socks.at(-1)!;
      sock.user = { id: `${phone}:7@s.whatsapp.net` };
      sock.emit({ connection: 'open' });
      lojas.push({ t, sock, phone });
    }
    // cada sessão tem a própria pasta cifrada e o próprio número
    for (const l of lojas) {
      expect(mgr.status(l.t)).toMatchObject({ status: 'connected', phone: l.phone });
      expect(existsSync(tenantDir(dir, l.t))).toBe(true);
    }
    // envios em paralelo: cada um sai só pelo socket do seu restaurante
    await Promise.all(
      lojas.map((l, i) =>
        call(`/v1/sessions/${l.t}/messages`, { to: '5511987654321', text: `loja ${i}` }),
      ),
    );
    lojas.forEach((l, i) => expect(l.sock.sent.map((m) => m.text)).toEqual([`loja ${i}`]));
    // mensagem recebida vem marcada com o restaurante do número que recebeu
    inbound.length = 0;
    lojas[1].sock.emitUpsert([
      {
        key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'X1' },
        message: { conversation: 'oi' },
      },
    ]);
    expect(inbound.map((m) => m.tenantId)).toEqual([lojas[1].t]);
    // queda e logout de um não mexem nos outros
    const before = socks.length;
    close(lojas[0].sock, 428);
    await mgr.logout(lojas[2].t);
    expect(existsSync(tenantDir(dir, lojas[2].t))).toBe(false);
    expect(mgr.status(lojas[1].t).status).toBe('connected');
    for (let i = 0; i < 100 && socks.length === before; i++) await wait(10);
    const back = socks.at(-1)!;
    back.user = lojas[0].sock.user;
    back.emit({ connection: 'open' });
    expect(mgr.status(lojas[0].t)).toMatchObject({ status: 'connected', phone: lojas[0].phone });
    expect(lojas[1].sock.ended).toBe(false);
    await Promise.all([mgr.logout(lojas[0].t), mgr.logout(lojas[1].t)]);
  });

  const close = (sock: FakeSocket, statusCode: number) =>
    sock.emit({ connection: 'close', lastDisconnect: { error: { output: { statusCode } } } });
});

describe('entrega das mensagens recebidas para a API', () => {
  const T1 = randomUUID();
  const msg = (id: string): InboundMessage => ({
    tenantId: T1,
    id,
    jid: '5511987654321@s.whatsapp.net',
    from: '5511987654321',
    kind: 'text',
    text: 'oi',
    pushName: null,
    timestamp: new Date().toISOString(),
  });

  it('manda na ordem, com o token, e tenta de novo quando a API está fora', async () => {
    const got: { id: string; auth: string | null }[] = [];
    let fails = 1;
    const fake = (async (_url: string, init: RequestInit) => {
      if (fails-- > 0) return new Response('', { status: 503 });
      const body = JSON.parse(String(init.body));
      got.push({ id: body.id, auth: new Headers(init.headers).get('authorization') });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const f = new InboundForwarder('http://api/x', TOKEN, undefined, {
      retryMs: [5, 5],
      fetchFn: fake,
    });
    f.push(msg('1'));
    f.push(msg('2'));
    for (let i = 0; i < 50 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    expect(got).toEqual([
      { id: '1', auth: `Bearer ${TOKEN}` },
      { id: '2', auth: `Bearer ${TOKEN}` },
    ]);
  });

  it('desiste da mensagem recusada (4xx) ou depois das tentativas, sem travar a fila', async () => {
    const seen: string[] = [];
    const fake = (async (_u: string, init: RequestInit) => {
      const id = JSON.parse(String(init.body)).id as string;
      seen.push(id);
      if (id === 'bad') return new Response('', { status: 422 });
      if (id === 'down') throw new Error('ECONNREFUSED');
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const f = new InboundForwarder('http://api/x', TOKEN, undefined, {
      retryMs: [5],
      fetchFn: fake,
    });
    const tenant = randomUUID();
    f.push({ ...msg('bad'), tenantId: tenant });
    f.push({ ...msg('down'), tenantId: tenant });
    f.push({ ...msg('ok'), tenantId: tenant });
    for (let i = 0; i < 50 && f.pending; i++) await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual(['bad', 'down', 'down', 'ok']);
  });

  it('conversa lenta não segura as outras; a mesma conversa segue na ordem', async () => {
    const order: string[] = [];
    const release: (() => void)[] = [];
    const fake = (async (_u: string, init: RequestInit) => {
      const id = JSON.parse(String(init.body)).id as string;
      order.push(`in:${id}`);
      if (id === 'lenta1') await new Promise<void>((r) => release.push(r));
      order.push(`ok:${id}`);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const f = new InboundForwarder('http://api/x', TOKEN, undefined, { fetchFn: fake });
    const other = randomUUID();
    f.push({ ...msg('lenta1'), jid: '5511900000001@s.whatsapp.net' });
    f.push({ ...msg('lenta2'), jid: '5511900000001@s.whatsapp.net' });
    f.push({ ...msg('outra'), tenantId: other });
    for (let i = 0; i < 50 && !order.includes('ok:outra'); i++)
      await new Promise((r) => setTimeout(r, 5));
    expect(order).toContain('ok:outra'); // outro restaurante não esperou
    expect(order).not.toContain('in:lenta2'); // a mesma conversa espera a anterior
    release.forEach((r) => r());
    for (let i = 0; i < 50 && f.pending; i++) await new Promise((r) => setTimeout(r, 5));
    expect(order.indexOf('ok:lenta1')).toBeLessThan(order.indexOf('in:lenta2'));
  });

  it('restaurante inundado não ocupa a fila dos outros', async () => {
    const logs: string[] = [];
    const hang = (() => new Promise(() => undefined)) as unknown as typeof fetch;
    const f = new InboundForwarder('http://api/x', TOKEN, (m) => logs.push(m), {
      fetchFn: hang,
      maxPerTenant: 3,
      maxPending: 10,
    });
    for (let i = 0; i < 5; i++) f.push(msg(`a${i}`));
    expect(f.pending).toBe(3);
    expect(logs.some((l) => l.includes('cheia'))).toBe(true);
    f.push({ ...msg('b'), tenantId: randomUUID() });
    expect(f.pending).toBe(4);
    f.close();
  });
});

describe('muitos restaurantes e mensagens', () => {
  it('mesmo número envia com intervalo; fila longa demais responde "muitas mensagens"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-'));
    const socks: FakeSocket[] = [];
    const mgr = new SessionManager(
      dir,
      key,
      () => {
        const s = new FakeSocket();
        socks.push(s);
        return s;
      },
      undefined,
      { timings: { sendGapMs: 100, sendQueueMaxMs: 250, heartbeatMs: 3_600_000 } },
    );
    const t = randomUUID();
    await mgr.start(t);
    socks[0].user = { id: '5511999990000:1@s.whatsapp.net' };
    socks[0].emit({ connection: 'open' });
    const at: number[] = [];
    const t0 = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        mgr.send(t, { to: '5511987654321' }, `m${i}`).then(() => at.push(Date.now() - t0)),
      ),
    );
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBeGreaterThan(0);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(TooManyMessagesError);
    at.sort((a, b) => a - b);
    // a 2ª mensagem saiu pelo menos ~80 ms depois da 1ª (100 ms ± 20%)
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(70);
    expect(mgr.stats()).toMatchObject({ total: 1, connected: 1 });
    mgr.close();
  });

  it('reabre as sessões salvas com um respiro entre elas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-'));
    for (let i = 0; i < 3; i++) {
      const a = await useEncryptedAuthState(dir, randomUUID(), key);
      a.state.creds.me = { id: `551199999000${i}:1@s.whatsapp.net` };
      await a.saveCreds();
    }
    const at: number[] = [];
    const mgr = new SessionManager(
      dir,
      key,
      () => {
        at.push(Date.now());
        return new FakeSocket();
      },
      undefined,
      { timings: { restoreGapMs: 60, heartbeatMs: 3_600_000 } },
    );
    await mgr.restoreAll();
    expect(at).toHaveLength(3);
    expect(at[2] - at[0]).toBeGreaterThanOrEqual(110);
    mgr.close();
  });
});
