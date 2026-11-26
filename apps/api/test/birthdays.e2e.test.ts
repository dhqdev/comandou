import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { localNow } from '@comandou/shared';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BirthdaysService } from '../src/birthdays/birthdays.service';
import { createApp } from '../src/bootstrap';
import { testEnv, PLATFORM_URL } from './env';
import { Fixture, ownerQuery, PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Parabéns de aniversário pelo WhatsApp (Clientes › Aniversários): o aniversário na ficha e na
 * Conta do cardápio, os ajustes, a prévia da arte, a varredura que manda uma vez só por ano (com
 * os pontos de presente), quem fica de fora (pediu para não receber, bloqueado) e a LGPD.
 */
const HOST_A = 'bd-a.comandou.test';
const HOST_B = 'bd-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const GW_TOKEN = 'token-interno-gateway-aniversario-123';
const TZ = 'America/Sao_Paulo';

type Doc = { tenant: string; to: string; fileName: string; caption: string; data: string };
const docs: Doc[] = [];
let gwConnected = true;
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
const cookieFrom = (res: request.Response, name: string) =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? [])
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0];

async function login(host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return cookieFrom(res, 'cm_sid')!;
}

async function until(check: () => boolean | Promise<boolean>, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Meio-dia no fuso do restaurante: depois da hora de envio e antes das 22 h.
const NOON = (() => {
  const d = new Date();
  const l = localNow(d, TZ);
  return new Date(Date.UTC(l.year, l.month - 1, l.day, 15, 0, 0));
})();
const TODAY = localNow(NOON, TZ);
const TOMORROW = localNow(new Date(NOON.getTime() + 86_400_000), TZ);

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
      const m = /^\/v1\/sessions\/([0-9a-f-]{36})(?:\/(start|messages|document))?$/.exec(req.url!);
      if (!m) return send(404, {});
      if (m[2] === 'document') {
        const b = JSON.parse(raw || '{}') as Omit<Doc, 'tenant'>;
        docs.push({ tenant: m[1]!, ...b });
        return send(200, { id: `BAE-doc-${docs.length}` });
      }
      if (m[2] === 'messages') return send(200, { id: 'BAE-text' });
      send(200, gwConnected ? { status: 'connected', phone: '5511999990000' } : { status: 'qr' });
    });
  });
  await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', r));
  fx = await seedTwoTenants('bd');
  const redis = process.env.TEST_REDIS_URL;
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      BIRTHDAY_INTERVAL_SECONDS: '0',
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      WHATSAPP_GATEWAY_URL: `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`,
      WHATSAPP_GATEWAY_TOKEN: GW_TOKEN,
      ...(redis ? { REDIS_URL: redis, QUEUE_PREFIX: `bd${Date.now()}` } : {}),
    }),
    { logger: false },
  );
  await app.listen(0, '127.0.0.1');
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@bd-a.test');
  cookies.waiterA = await login(HOST_A, 'garcom@bd-a.test');
  cookies.adminB = await login(HOST_B, 'admin@bd-b.test');
});
afterAll(async () => {
  await app?.close();
  await new Promise((r) => gateway?.close(r));
});

describe('Parabéns de aniversário', () => {
  const ids: Record<string, string> = {};
  let clientCookie = '';

  it('o cliente põe o aniversário na Conta do cardápio e pode recusar o parabéns', async () => {
    const r = await http
      .post('/api/v1/store/account/signup')
      .set('Host', HOST_A)
      .set(CSRF)
      .send({ name: 'joana souza', phone: '11977776666', password: 'segredo-da-joana' })
      .expect(201);
    clientCookie = cookieFrom(r, 'cm_cid')!;
    ids.joana = r.body.customer.id;
    expect(r.body.customer.birthDay).toBeNull();
    const patch = (body: object) =>
      http
        .patch('/api/v1/store/account')
        .set('Host', HOST_A)
        .set(CSRF)
        .set('Cookie', clientCookie)
        .send(body);
    await patch({ birthday: { day: 31, month: 4 } }).expect(400);
    await patch({ birthday: { day: 29, month: 2, year: 2001 } }).expect(400);
    const ok = await patch({
      birthday: { day: TODAY.day, month: TODAY.month, year: 1990 },
      birthdayOptOut: true,
    }).expect(200);
    expect(ok.body.customer).toMatchObject({
      birthDay: TODAY.day,
      birthMonth: TODAY.month,
      birthYear: 1990,
      birthdayOptOut: true,
    });
  });

  it('a equipe cadastra o aniversário na ficha (o garçom não)', async () => {
    const mk = async (name: string, phone: string) =>
      (await call('post', 'adminA', '/customers', { name, phone }).expect(201)).body.id as string;
    ids.ana = await mk('ana paula', '11966665555');
    ids.bia = await mk('Bia', '11955554444');
    ids.caio = await mk('Caio', '11944443333');
    await call('patch', 'waiterA', `/customers/${ids.ana}`, {
      birthday: { day: TODAY.day, month: TODAY.month },
    }).expect(403);
    const d = await call('patch', 'adminA', `/customers/${ids.ana}`, {
      birthday: { day: TODAY.day, month: TODAY.month },
    }).expect(200);
    expect(d.body).toMatchObject({ birthDay: TODAY.day, birthMonth: TODAY.month, birthYear: null });
    // Bia: amanhã. Caio: hoje, mas bloqueado.
    await call('patch', 'adminA', `/customers/${ids.bia}`, {
      birthday: { day: TOMORROW.day, month: TOMORROW.month },
    }).expect(200);
    await call('patch', 'adminA', `/customers/${ids.caio}`, {
      birthday: { day: TODAY.day, month: TODAY.month },
      blocked: true,
    }).expect(200);
    const list = (await call('get', 'adminA', '/customers').expect(200)).body.customers;
    expect(list.find((c: { id: string }) => c.id === ids.ana)).toMatchObject({
      birthDay: TODAY.day,
      birthMonth: TODAY.month,
    });
  });

  it('ajustes: presente em pontos só com a fidelidade ligada', async () => {
    const o = (await call('get', 'adminA', '/birthdays').expect(200)).body;
    expect(o.settings).toMatchObject({ enabled: false, theme: 'festa', sendHour: 10 });
    expect(o.whatsapp).toEqual({ ready: false, reason: 'off' });
    expect(o.stats).toMatchObject({ withBirthday: 4, optedOut: 1 });
    await call('put', 'waiterA', '/birthdays/settings', { enabled: true }).expect(403);
    await call('put', 'adminA', '/birthdays/settings', {
      giftKind: 'points',
      giftPoints: 50,
    }).expect(422);
    await call('patch', 'adminA', '/loyalty', { enabled: true }).expect(200);
    const s = await call('put', 'adminA', '/birthdays/settings', {
      enabled: true,
      sendHour: 9,
      theme: 'bolo',
      giftKind: 'points',
      giftPoints: 50,
      message: 'Parabéns, {cliente}! Beijo do {restaurante}.\n\n{presente}',
    }).expect(200);
    expect(s.body).toMatchObject({ enabled: true, theme: 'bolo', giftPoints: 50 });
    await call('put', 'adminA', '/birthdays/settings', { theme: 'neon' }).expect(400);
  });

  it('prévia da arte em PNG', async () => {
    const r = await call('get', 'adminA', '/birthdays/preview?theme=elegante&name=Zé')
      .buffer(true)
      .parse((res, cb) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => cb(null, Buffer.concat(parts)));
      })
      .expect(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect((r.body as Buffer).subarray(1, 4).toString()).toBe('PNG');
    await call('get', 'adminA', '/birthdays/preview?theme=neon').expect(400);
  });

  it('varredura: antes da hora ou sem WhatsApp não manda nada', async () => {
    const svc = app.get(BirthdaysService);
    // WhatsApp da loja desligado.
    expect(await svc.sweepTenant(fx.tenantA, NOON)).toBe(0);
    await call('put', 'adminA', '/messaging/settings', {
      provider: 'baileys',
      enabled: true,
    }).expect(200);
    const o = (await call('get', 'adminA', '/birthdays').expect(200)).body;
    expect(o.whatsapp).toEqual({ ready: true, reason: 'ok' });
    // 8 h no restaurante (a hora escolhida é 9 h).
    expect(await svc.sweepTenant(fx.tenantA, new Date(NOON.getTime() - 4 * 3600_000))).toBe(0);
    // Desconectado agora: tenta na próxima volta.
    gwConnected = false;
    expect(await svc.sweepTenant(fx.tenantA, NOON)).toBe(0);
    gwConnected = true;
    expect(docs).toHaveLength(0);
  });

  it('manda uma vez só, com a arte, o texto e os pontos de presente', async () => {
    const svc = app.get(BirthdaysService);
    expect(await svc.sweep(NOON)).toBe(1);
    expect(await svc.sweep(NOON)).toBe(0);
    await until(() => docs.length >= 1);
    expect(docs).toHaveLength(1);
    const d = docs[0]!;
    expect(d.tenant).toBe(fx.tenantA);
    expect(d.to).toBe('5511966665555');
    expect(d.fileName).toBe('Feliz aniversario.png');
    expect(Buffer.from(d.data, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(d.caption).toContain('Parabéns, Ana! Beijo do Restaurante A bd.');
    expect(d.caption).toContain('*50 pontos*');
    // Joana pediu para não receber; Caio está bloqueado; Bia é amanhã.
    expect(docs.some((x) => x.to.endsWith('77776666'))).toBe(false);

    await until(
      async () =>
        (
          await ownerQuery<{ status: string }>(
            `SELECT status FROM birthday_greetings WHERE customer_id = $1`,
            [ids.ana],
          )
        )[0]?.status === 'sent',
    );
    const o = (await call('get', 'adminA', '/birthdays').expect(200)).body;
    expect(o.history).toHaveLength(1);
    expect(o.history[0]).toMatchObject({
      customerId: ids.ana,
      status: 'sent',
      giftKind: 'points',
      giftPoints: 50,
    });
    expect(o.upcoming.map((u: { id: string }) => u.id)).toEqual(
      expect.arrayContaining([ids.ana, ids.bia]),
    );
    const loyalty = (await call('get', 'adminA', `/loyalty/customers/${ids.ana}`).expect(200)).body;
    expect(loyalty.balance).toBe(50);
    const detail = (await call('get', 'adminA', `/customers/${ids.ana}`).expect(200)).body;
    expect(detail.greetings[0]).toMatchObject({ year: TODAY.year, status: 'sent' });
    // Só reenvia o que falhou.
    await call('post', 'adminA', `/birthdays/greetings/${o.history[0].id}/retry`).expect(409);
    await call('post', 'adminB', `/birthdays/greetings/${o.history[0].id}/retry`).expect(404);
  });

  it('outro restaurante não vê nada', async () => {
    const o = (await call('get', 'adminB', '/birthdays').expect(200)).body;
    expect(o.history).toEqual([]);
    expect(o.upcoming).toEqual([]);
    await call('get', 'adminB', `/customers/${ids.ana}`).expect(404);
  });

  it('teste: manda a arte com o nome de quem pediu', async () => {
    await call('post', 'adminA', '/birthdays/test', { phone: '123' }).expect(400);
    await call('post', 'adminA', '/birthdays/test', { phone: '0000-00000' }).expect(422);
    await call('post', 'adminA', '/birthdays/test', {
      phone: '(11) 93333-2222',
      theme: 'simples',
      giftKind: 'text',
      giftText: 'Sobremesa grátis',
      giftDays: 0,
    }).expect(200);
    const d = docs.at(-1)!;
    expect(d.to).toBe('5511933332222');
    expect(d.caption).toContain('Parabéns, Admin!');
    expect(d.caption).toContain('*Sobremesa grátis*. Vale só hoje.');
  });

  it('LGPD: o aniversário vai no arquivo e sai junto quando a conta é apagada', async () => {
    const exp = await http
      .post('/api/v1/store/account/privacy/export')
      .set('Host', HOST_A)
      .set(CSRF)
      .set('Cookie', clientCookie)
      .send({ password: 'segredo-da-joana' });
    expect(exp.status).toBeLessThan(300);
    const body = typeof exp.body === 'object' && exp.body.conta ? exp.body : JSON.parse(exp.text);
    expect(body.conta.aniversario).toBe(
      `${String(TODAY.day).padStart(2, '0')}/${String(TODAY.month).padStart(2, '0')}/1990`,
    );
    expect(body.conta.aceitaParabens).toBe(false);

    await call('post', 'adminA', `/privacy/customers/${ids.ana}/erase`, {
      confirm: 'APAGAR',
    }).expect(200);
    const left = await ownerQuery(
      `SELECT count(*)::int AS n FROM birthday_greetings WHERE customer_id = $1`,
      [ids.ana],
    );
    expect(left[0]!.n).toBe(0);
  });
});
