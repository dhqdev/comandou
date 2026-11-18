import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgendaService, chargeText, reminderText } from '../src/agenda/agenda.service';
import { createApp } from '../src/bootstrap';
import { testEnv, PLATFORM_URL } from './env';
import { Fixture, ownerQuery, PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Agenda pessoal (menu, embaixo): compromissos, tags, a permissão dos lembretes pelo
 * WhatsApp e a varredura que manda o lembrete na hora escolhida. Cada pessoa só vê a sua.
 */
const HOST_A = 'ag-a.comandou.test';
const HOST_B = 'ag-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const GW_TOKEN = 'token-interno-gateway-agenda-123';

const gwSent: { tenant: string; to: string; text: string }[] = [];
let app: INestApplication;
let gateway: Server;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};

type Who = 'adminA' | 'waiterA' | 'adminB';
const hostOf = (w: Who) => (w === 'adminB' ? HOST_B : HOST_A);
const call = (
  m: 'get' | 'post' | 'patch' | 'put' | 'delete',
  w: Who,
  url: string,
  body?: object,
) => {
  const r = http[m](`/api/v1${url}`).set('Host', hostOf(w)).set('Cookie', cookies[w]!);
  return m === 'get' ? r : r.set(CSRF).send(body ?? {});
};

async function login(host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0]!;
}

const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const range = () =>
  `?from=${encodeURIComponent(at(-2 * 1440))}&to=${encodeURIComponent(at(3 * 1440))}`;

beforeAll(async () => {
  gateway = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (code: number, b: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(b));
      };
      if (req.headers.authorization !== `Bearer ${GW_TOKEN}`) return send(401, {});
      const m = /^\/v1\/sessions\/([0-9a-f-]{36})(?:\/(start|messages))?$/.exec(req.url!);
      if (!m) return send(404, {});
      if (m[2] === 'messages') {
        const b = JSON.parse(raw || '{}') as { to: string; text: string };
        gwSent.push({ tenant: m[1]!, ...b });
        return send(200, { id: `BAE${gwSent.length}` });
      }
      send(200, { status: 'connected', phone: '5511999990000' });
    });
  });
  await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', r));
  fx = await seedTwoTenants('ag');
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      AGENDA_INTERVAL_SECONDS: '0',
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      WHATSAPP_GATEWAY_URL: `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`,
      WHATSAPP_GATEWAY_TOKEN: GW_TOKEN,
    }),
    { logger: false },
  );
  await app.init();
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@ag-a.test');
  cookies.waiterA = await login(HOST_A, 'garcom@ag-a.test');
  cookies.adminB = await login(HOST_B, 'admin@ag-b.test');
});
afterAll(async () => {
  await app?.close();
  await new Promise((r) => gateway?.close(r));
});

describe('Agenda', () => {
  let tagId = '';
  let evId = '';

  it('tags: cria, não repete o nome e é de cada pessoa', async () => {
    const t = await call('post', 'adminA', '/agenda/tags', {
      name: 'Fornecedores',
      color: '#0C8040',
    }).expect(201);
    tagId = t.body.id;
    await call('post', 'adminA', '/agenda/tags', { name: 'fornecedores', color: '#E03150' }).expect(
      409,
    );
    await call('post', 'adminA', '/agenda/tags', { name: 'X', color: 'verde' }).expect(400);
    // O garçom do mesmo restaurante não vê nem usa a tag do admin.
    expect((await call('get', 'waiterA', '/agenda/setup').expect(200)).body.tags).toEqual([]);
    await call('post', 'waiterA', '/agenda/events', {
      title: 'Teste',
      startsAt: at(60),
      endsAt: at(120),
      tagId,
    }).expect(422);
  });

  it('compromisso: cria, lista no período, edita e marca como concluído', async () => {
    const r = await call('post', 'adminA', '/agenda/events', {
      title: 'Receber o fornecedor de carnes',
      notes: 'Conferir a nota e o peso',
      startsAt: at(120),
      endsAt: at(180),
      tagId,
    }).expect(201);
    evId = r.body.id;
    expect(r.body).toMatchObject({ allDay: false, done: false, remindAt: null, tagId });
    await call('post', 'adminA', '/agenda/events', {
      title: 'Fim antes do começo',
      startsAt: at(120),
      endsAt: at(60),
    }).expect(400);
    const list = (await call('get', 'adminA', `/agenda/events${range()}`).expect(200)).body;
    expect(list.map((e: { id: string }) => e.id)).toContain(evId);
    // Ninguém mais vê: nem o garçom, nem o outro restaurante.
    expect((await call('get', 'waiterA', `/agenda/events${range()}`).expect(200)).body).toEqual([]);
    expect((await call('get', 'adminB', `/agenda/events${range()}`).expect(200)).body).toEqual([]);
    await call('patch', 'waiterA', `/agenda/events/${evId}`, { done: true }).expect(404);
    await call('patch', 'adminB', `/agenda/events/${evId}`, { done: true }).expect(404);
    const done = await call('patch', 'adminA', `/agenda/events/${evId}`, { done: true }).expect(
      200,
    );
    expect(done.body.done).toBe(true);
    await call('patch', 'adminA', `/agenda/events/${evId}`, { done: false }).expect(200);
  });

  it('excluir a tag deixa o compromisso, sem a tag', async () => {
    await call('delete', 'adminA', `/agenda/tags/${tagId}`).expect(204);
    const list = (await call('get', 'adminA', `/agenda/events${range()}`).expect(200)).body;
    expect(list.find((e: { id: string }) => e.id === evId).tagId).toBeNull();
  });

  it('lembretes: exigem o número; o horário anda junto quando o compromisso muda de hora', async () => {
    await call('put', 'adminA', '/agenda/settings', { whatsappEnabled: true, phone: null }).expect(
      422,
    );
    await call('put', 'adminA', '/agenda/settings', { whatsappEnabled: true, phone: '123' }).expect(
      422,
    );
    const s = await call('put', 'adminA', '/agenda/settings', {
      whatsappEnabled: true,
      phone: '(11) 98765-4321',
    }).expect(200);
    expect(s.body).toMatchObject({
      whatsappEnabled: true,
      phone: '5511987654321',
      whatsappReady: false,
    });

    const ev = await call('patch', 'adminA', `/agenda/events/${evId}`, { remindAt: at(90) }).expect(
      200,
    );
    const before = new Date(ev.body.remindAt).getTime();
    const start = new Date(ev.body.startsAt).getTime();
    const moved = await call('patch', 'adminA', `/agenda/events/${evId}`, {
      startsAt: new Date(start + 3600_000).toISOString(),
      endsAt: new Date(start + 2 * 3600_000).toISOString(),
    }).expect(200);
    expect(new Date(moved.body.remindAt).getTime()).toBe(before + 3600_000);
    expect(moved.body.remindedAt).toBeNull();
  });

  it('varredura: manda o lembrete vencido uma vez só, pelo WhatsApp do restaurante', async () => {
    // Liga o WhatsApp do restaurante pelo QR Code.
    await call('put', 'adminA', '/messaging/settings', {
      provider: 'baileys',
      enabled: true,
    }).expect(200);
    const setup = (await call('get', 'adminA', '/agenda/setup').expect(200)).body;
    expect(setup.settings.whatsappReady).toBe(true);

    // O lembrete venceu (o banco não deixa marcar no passado pela API).
    await ownerQuery(
      `UPDATE agenda_events SET remind_at = now() - interval '1 minute' WHERE id = $1`,
      [evId],
    );
    const agenda = app.get(AgendaService);
    await agenda.sweep();
    await agenda.sweep();
    const mine = gwSent.filter((m) => m.tenant === fx.tenantA);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.to).toContain('5511987654321');
    expect(mine[0]!.text).toContain('Receber o fornecedor de carnes');
    const list = (await call('get', 'adminA', `/agenda/events${range()}`).expect(200)).body;
    const e = list.find((x: { id: string }) => x.id === evId);
    expect(e.remindedAt).toBeTruthy();
    expect(e.remindError).toBeNull();
  });

  it('com a permissão desligada, o lembrete não sai e fica o motivo', async () => {
    await call('put', 'adminA', '/agenda/settings', {
      whatsappEnabled: false,
      phone: '11987654321',
    }).expect(200);
    const r = await call('post', 'adminA', '/agenda/events', {
      title: 'Pagar o gás',
      startsAt: at(30),
      endsAt: at(30),
      remindAt: at(5),
    }).expect(201);
    await ownerQuery(
      `UPDATE agenda_events SET remind_at = now() - interval '1 minute' WHERE id = $1`,
      [r.body.id],
    );
    const n = gwSent.length;
    await app.get(AgendaService).sweep();
    expect(gwSent.length).toBe(n);
    const list = (await call('get', 'adminA', `/agenda/events${range()}`).expect(200)).body;
    expect(list.find((x: { id: string }) => x.id === r.body.id).remindError).toMatch(/desligados/);
    await call('delete', 'adminA', `/agenda/events/${r.body.id}`).expect(204);
    await call('delete', 'adminA', `/agenda/events/${r.body.id}`).expect(404);
  });

  describe('fiado', () => {
    let orderId = '';
    let fiadoEv = '';
    const newOrder = async () =>
      (
        await call('post', 'adminA', '/orders', {
          channel: 'counter',
          items: [{ productId: fx.prodA, quantity: 2 }],
        })
          .set('Idempotency-Key', `fiado-${Date.now()}-${Math.random()}`)
          .expect(201)
      ).body as { id: string; number: number };

    it('vender fiado: vai para a agenda de quem vendeu, com a tag Fiado e a cobrança', async () => {
      const o = await newOrder();
      orderId = o.id;
      // Garçom não dá fiado; número inválido não passa.
      await call('post', 'waiterA', `/orders/${orderId}/fiado`, {
        name: 'João',
        phone: '11912345678',
        dueAt: at(120),
      }).expect(403);
      await call('post', 'adminA', `/orders/${orderId}/fiado`, {
        name: 'João',
        phone: '1234-5678',
        dueAt: at(120),
      }).expect(422);
      const r = await call('post', 'adminA', `/orders/${orderId}/fiado`, {
        name: 'João da Silva',
        phone: '(11) 91234-5678',
        dueAt: at(120),
      }).expect(200);
      expect(r.body.order).toMatchObject({
        fiadoName: 'João da Silva',
        fiadoPhone: '5511912345678',
      });
      expect(r.body.event.charge).toMatchObject({ phone: '5511912345678', sentAt: null });
      expect(r.body.event.order).toMatchObject({ id: orderId, balance: '51.80' });
      fiadoEv = r.body.event.id;
      const setup = (await call('get', 'adminA', '/agenda/setup').expect(200)).body;
      const tag = setup.tags.find((t: { name: string }) => t.name === 'Fiado');
      expect(tag).toBeTruthy();
      expect(r.body.event.tagId).toBe(tag.id);
      // Marcar de novo muda o mesmo compromisso (não cria outro).
      const again = await call('post', 'adminA', `/orders/${orderId}/fiado`, {
        name: 'João da Silva',
        phone: '11912345678',
        dueAt: at(240),
      }).expect(200);
      expect(again.body.event.id).toBe(fiadoEv);
    });

    it('Nova venda › Fiado: lança o pedido já com o fiado (e confere antes de lançar)', async () => {
      const body = (fiado: object) => ({
        channel: 'counter',
        items: [{ productId: fx.prodA, quantity: 1 }],
        fiado,
      });
      const key = () => `fiado-new-${Date.now()}-${Math.random()}`;
      const before = (await call('get', 'adminA', '/orders?active=true&limit=500').expect(200)).body
        .length;
      // Garçom não vende fiado e número inválido barra antes de lançar: nenhum pedido sobra.
      await call(
        'post',
        'waiterA',
        '/orders',
        body({ name: 'Ana', phone: '11955554444', dueAt: at(60) }),
      )
        .set('Idempotency-Key', key())
        .expect(403);
      await call(
        'post',
        'adminA',
        '/orders',
        body({ name: 'Ana', phone: '1234-5678', dueAt: at(60) }),
      )
        .set('Idempotency-Key', key())
        .expect(422);
      expect(
        (await call('get', 'adminA', '/orders?active=true&limit=500').expect(200)).body.length,
      ).toBe(before);
      const r = await call(
        'post',
        'adminA',
        '/orders',
        body({ name: 'Ana Souza', phone: '(11) 95555-4444', dueAt: at(90) }),
      )
        .set('Idempotency-Key', key())
        .expect(201);
      expect(r.body).toMatchObject({ fiadoName: 'Ana Souza', fiadoPhone: '5511955554444' });
      const list = (
        await call(
          'get',
          'adminA',
          `/agenda/events?from=${encodeURIComponent(at(-60))}&to=${encodeURIComponent(at(600))}`,
        ).expect(200)
      ).body;
      const ev = list.find((e: { order?: { id: string } }) => e.order?.id === r.body.id);
      expect(ev.charge).toMatchObject({ name: 'Ana Souza', phone: '5511955554444' });
    });

    it('fiado conclui com saldo sem pedir o "a receber"', async () => {
      for (const to of ['ready', 'completed'])
        await call('post', 'adminA', `/orders/${orderId}/status`, { to }).expect(201);
      const o = (await call('get', 'adminA', `/orders/${orderId}`).expect(200)).body;
      expect(o.status).toBe('completed');
      expect(o.receivableReason).toBe('Fiado: João da Silva');
    });

    it('no dia e hora, o WhatsApp do restaurante cobra o cliente (uma vez só)', async () => {
      await ownerQuery(
        `UPDATE agenda_events SET charge_at = now() - interval '1 minute' WHERE id = $1`,
        [fiadoEv],
      );
      const n = gwSent.length;
      await app.get(AgendaService).sweep();
      await app.get(AgendaService).sweep();
      const sent = gwSent.slice(n);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toContain('5511912345678');
      expect(sent[0]!.text).toContain('R$');
      expect(sent[0]!.text).toContain('51,80');
      const list = (
        await call(
          'get',
          'adminA',
          `/agenda/events?from=${encodeURIComponent(at(-60))}&to=${encodeURIComponent(at(600))}`,
        ).expect(200)
      ).body;
      const e = list.find((x: { id: string }) => x.id === fiadoEv);
      expect(e.charge.sentAt).toBeTruthy();
      expect(e.charge.error).toBeNull();
    });

    it('pedido já pago na hora: a cobrança não sai e o compromisso fica concluído', async () => {
      const o = await newOrder();
      const r = await call('post', 'adminA', `/orders/${o.id}/fiado`, {
        name: 'Maria',
        phone: '11955554444',
        dueAt: at(60),
      }).expect(200);
      await ownerQuery(`UPDATE orders SET paid_amount = total WHERE id = $1`, [o.id]);
      await ownerQuery(
        `UPDATE agenda_events SET charge_at = now() - interval '1 minute' WHERE id = $1`,
        [r.body.event.id],
      );
      const n = gwSent.length;
      await app.get(AgendaService).sweep();
      expect(gwSent.length).toBe(n);
      const list = (
        await call(
          'get',
          'adminA',
          `/agenda/events?from=${encodeURIComponent(at(-60))}&to=${encodeURIComponent(at(600))}`,
        ).expect(200)
      ).body;
      expect(list.find((x: { id: string }) => x.id === r.body.event.id).done).toBe(true);
      // O outro restaurante não marca fiado em pedido de A.
      await call('post', 'adminB', `/orders/${o.id}/fiado`, {
        name: 'X',
        phone: '11955554444',
        dueAt: at(60),
      }).expect(404);
    });

    it('texto da cobrança', () => {
      const t = chargeText(
        {
          name: 'João da Silva',
          number: 42,
          balance: '51.80',
          orderedAt: new Date('2026-11-18T15:00:00Z'),
        },
        { name: 'Fumaça Burger', tz: 'America/Sao_Paulo' },
      );
      expect(t).toMatch(/^Olá, João!/);
      expect(t).toContain('*Fumaça Burger*');
      expect(t).toContain('pedido #42, de 18/11');
      expect(t).toMatch(/R\$\s51,80/);
    });
  });

  it('texto do lembrete com dia e hora no fuso do restaurante', () => {
    const t = reminderText(
      {
        title: 'Reunião com a equipe',
        notes: 'Levar a escala',
        starts_at: new Date('2026-11-20T17:30:00Z'),
        ends_at: new Date('2026-11-20T18:30:00Z'),
        all_day: false,
        tag: 'Equipe',
      },
      { name: 'Fumaça Burger', tz: 'America/Sao_Paulo' },
    );
    expect(t).toContain('*Reunião com a equipe*');
    expect(t).toContain('14:30 às 15:30');
    expect(t).toMatch(/Sexta-feira, 20\/11/);
    expect(t).toContain('🏷️ Equipe');
    expect(t).toContain('Fumaça Burger');
  });
});
