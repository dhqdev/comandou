import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/password';
import { seal } from '../src/common/secret-box';
import { PLATFORM_WA_ID, WhatsAppInboundService } from '../src/messaging/whatsapp-inbound.service';
import { PlatformWaAlerts } from '../src/platform-whatsapp/admin-alerts.service';
import { brasiliaNow } from '../src/platform-whatsapp/admin-menu';
import { totpContext } from '../src/platform/platform-auth';
import { newTotpSecret, totpCode, totpStep } from '../src/platform/totp';
import { PLATFORM_URL, testEnv } from './env';
import { Fixture, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Menu do Super Admin pelo WhatsApp do painel: só números cadastrados recebem o menu; escolher
 * restaurante, varredura, ação com SIM (no histórico), avisos automáticos e resumo do dia, cada
 * um uma vez só.
 */
const ADMIN_HOST = 'admin.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const KEY = randomBytes(32).toString('base64');
const SECRET = newTotpSecret();
const GW_TOKEN = 'token-interno-gateway-de-teste-789';
const OP_JID = '5511988887777@s.whatsapp.net';

let app: INestApplication;
let http: ReturnType<typeof request>;
let gateway: Server;
let fx: Fixture;
let admin = '';
let adminId = '';
let gwStatus: 'disconnected' | 'connected' = 'connected';
const sent: { jid?: string; to?: string; text: string }[] = [];

const pget = (url: string) =>
  http.get(`/api/v1/platform/whatsapp${url}`).set('Host', ADMIN_HOST).set('Cookie', admin);
const psend = (method: 'post' | 'put' | 'patch' | 'delete', url: string, b: object = {}) =>
  http[method](`/api/v1/platform/whatsapp${url}`)
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .set('Cookie', admin)
    .send(b);

let seq = 0;
/** Mensagem do número do Super Admin (ou de outro) e a resposta que o menu mandou. */
async function say(text: string, from = '5511988887777', jid = OP_JID) {
  const before = sent.length;
  await app.get(WhatsAppInboundService).receive({
    tenantId: PLATFORM_WA_ID,
    id: `MENU${++seq}`,
    jid,
    from,
    kind: 'text',
    text,
    pushName: 'Dono',
    timestamp: new Date(),
  });
  return sent.slice(before).map((s) => s.text);
}

beforeAll(async () => {
  fx = await seedTwoTenants('pwm');
  gateway = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.headers.authorization !== `Bearer ${GW_TOKEN}`) {
        res.writeHead(401).end();
        return;
      }
      const m = /^\/v1\/sessions\/([^/]+)(\/[a-z]+)?$/.exec(req.url ?? '');
      const path = m?.[2] ?? '';
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const json = (code: number, b: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(b));
      };
      if (path === '') return json(200, { status: gwStatus });
      if (path === '/messages') {
        if (gwStatus !== 'connected') return json(409, { error: 'WhatsApp desconectado' });
        sent.push({ jid: body.jid as string, to: body.to as string, text: String(body.text) });
        return json(200, {
          id: `OUT${sent.length}`,
          jid: body.jid ?? `${String(body.to)}@s.whatsapp.net`,
        });
      }
      return json(200, { ok: true });
    });
  });
  await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', r));

  const [{ id }] = await ownerQuery<{ id: string }>(
    `INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc)
     VALUES ('menu@plataforma.test', 'Claudio Dono', $1, '\\x00') RETURNING id`,
    [await hashPassword('senha-super-admin-123')],
  );
  adminId = id;
  await ownerQuery(`UPDATE platform_admins SET totp_secret_enc = $2 WHERE id = $1`, [
    id,
    seal(KEY, SECRET, totpContext(id)),
  ]);
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      PLATFORM_DATABASE_URL: PLATFORM_URL,
      INTEGRATIONS_KEY: KEY,
      WHATSAPP_GATEWAY_URL: `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`,
      WHATSAPP_GATEWAY_TOKEN: GW_TOKEN,
    }),
    { logger: false },
  );
  await app.init();
  http = request(app.getHttpServer());
  const r = await http
    .post('/api/v1/platform/auth/login')
    .set('Host', ADMIN_HOST)
    .set(CSRF)
    .send({
      email: 'menu@plataforma.test',
      password: 'senha-super-admin-123',
      code: totpCode(SECRET, totpStep()),
    })
    .expect(200);
  admin = (r.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_admin='))!
    .split(';')[0]!;
});

afterAll(async () => {
  // O banco de teste é um só: não deixa conversas nem números para o teste da tela WhatsApp.
  await ownerQuery(`DELETE FROM platform_wa_operators`);
  await ownerQuery(`DELETE FROM platform_wa_chats`);
  await ownerQuery(`DELETE FROM platform_wa_alerts`);
  await ownerQuery(
    `UPDATE platform_wa_bot_settings SET enabled = true, summary_hour = 8, last_summary_on = NULL`,
  );
  await app?.close();
  await new Promise((r) => gateway?.close(r));
});

describe('Menu do Super Admin pelo WhatsApp', () => {
  it('só o painel mexe nos números do menu', async () => {
    await http.get('/api/v1/platform/whatsapp/menu').set('Host', ADMIN_HOST).expect(401);
    await http
      .get('/api/v1/platform/whatsapp/menu')
      .set('Host', 'pwm-a.comandou.test')
      .set('Cookie', admin)
      .expect(404);
  });

  it('número que não está cadastrado não recebe resposta automática', async () => {
    expect(await say('menu')).toEqual([]);
  });

  it('cadastra o número (com ou sem 55) e o menu responde', async () => {
    const r = await psend('post', '/menu/operators', { phone: '(11) 98888-7777', label: 'Meu' });
    expect(r.status).toBe(201);
    expect(r.body.operators).toHaveLength(1);
    expect(r.body.operators[0]).toMatchObject({ phone: '5511988887777', adminId, alerts: true });
    expect(r.body.operators[0]).not.toHaveProperty('adminEmail');
    await psend('post', '/menu/operators', { phone: '11 98888-7777' }).expect(409);
    await psend('post', '/menu/operators', { phone: 'telefone' }).expect(422);

    const [menu] = await say('Oi');
    expect(menu).toContain('Comandou · Super Admin');
    expect(menu).toContain('Olá, Claudio!');
    // Conversa do menu não fica como "não lida" no painel.
    const list = (await pget('/chats').expect(200)).body as { jid: string; unread: number }[];
    expect(list.find((c) => c.jid === OP_JID)?.unread).toBe(0);
    // Mesmo número escrito sem o 9 (WhatsApp antigo) também é reconhecido.
    const [again] = await say('menu', '551188887777', '551188887777@s.whatsapp.net');
    expect(again).toContain('Comandou · Super Admin');
  });

  it('resumo, saúde, varredura geral e cobrança', async () => {
    expect((await say('1'))[0]).toContain('Resumo do sistema');
    expect((await say('3'))[0]).toContain('Saúde do servidor');
    expect((await say('4'))[0]).toContain('Varredura geral');
    expect((await say('8'))[0]).toContain('Cobrança');
    expect((await say('6'))[0]).toContain('Bancos e servidores');
    expect((await say('7'))[0]).toContain('Restaurantes novos');
  });

  it('escolhe o restaurante pela lista ou pelo nome', async () => {
    const [list] = await say('2');
    expect(list).toContain('Escolha o restaurante');
    expect(list).toContain('Restaurante A pwm');
    // Pelo nome: um só encontrado já abre.
    const [menu] = await say('Restaurante A pwm');
    expect(menu).toContain('*Restaurante A pwm* (pwm-a)');
    expect(menu).toContain('3. Varredura completa');
    const [over] = await say('1');
    expect(over).toContain('Assinatura');
    expect(over).toContain('Donos: Admin A');
    expect((await say('2'))[0]).toContain('Movimento');
    const [scan] = await say('3');
    expect(scan).toContain('Varredura · Restaurante A pwm');
    expect(scan).toContain('dono(s) ativo(s)');
    expect((await say('4'))[0]).toContain('Admin A');
    expect((await say('5'))[0]).toContain('Histórico do painel');
    expect((await say('6'))[0]).toContain('Banco de dados e backup');
    // Busca com mais de um: lista numerada.
    const [many] = await say('8');
    expect(many).toContain('Escolha o restaurante');
    const [found] = await say('pwm');
    expect(found).toContain('Restaurante B pwm');
  });

  it('ação que muda algo pede SIM e entra no histórico no nome do Super Admin', async () => {
    await say('Restaurante B pwm');
    const [ask] = await say('7');
    expect(ask).toContain('Responda *SIM*');
    const [no] = await say('não');
    expect(no).toContain('Ok, não fiz nada');
    await say('r');
    await say('7');
    const [done] = await say('Sim');
    expect(done).toContain('Cache limpo');
    const log = await ownerQuery<{ action: string; admin_id: string; tenant_id: string }>(
      `SELECT action, admin_id, tenant_id FROM platform_audit_log
        WHERE action IN ('platform.tenant.cache_cleared', 'whatsapp.menu_action')
          AND tenant_id = $1 ORDER BY id`,
      [fx.tenantB],
    );
    expect(log).toEqual([
      { action: 'platform.tenant.cache_cleared', admin_id: adminId, tenant_id: fx.tenantB },
      { action: 'whatsapp.menu_action', admin_id: adminId, tenant_id: fx.tenantB },
    ]);
  });

  it('liga e desliga os próprios avisos pelo WhatsApp', async () => {
    await say('0');
    expect((await say('9'))[0]).toContain('Avisos automáticos: ✅ ligados');
    expect((await say('1'))[0]).toContain('Avisos automáticos: ⚪ desligados');
    expect((await say('1'))[0]).toContain('Avisos automáticos: ✅ ligados');
  });

  it('avisos automáticos saem uma vez só; desconectado, esperam', async () => {
    const alerts = app.get(PlatformWaAlerts);
    gwStatus = 'disconnected';
    expect(await alerts.sweep()).toEqual({ alerts: 0, summary: false });
    gwStatus = 'connected';
    await ownerQuery(`UPDATE platform_wa_bot_settings SET summary_hour = NULL WHERE id`);
    const before = sent.length;
    const r = await alerts.sweep();
    expect(r.alerts).toBeGreaterThan(0);
    const out = sent.slice(before);
    expect(out).toHaveLength(1);
    expect(out[0].jid).toBe(OP_JID);
    expect(out[0].text).toContain('Aviso do Comandou');
    expect(out[0].text).toContain('Restaurante novo: Restaurante A pwm');
    // Segunda volta: nada novo.
    expect(await alerts.sweep()).toEqual({ alerts: 0, summary: false });
  });

  it('resumo do dia na hora marcada, uma vez por dia', async () => {
    const alerts = app.get(PlatformWaAlerts);
    await ownerQuery(
      `UPDATE platform_wa_bot_settings SET summary_hour = $1, last_summary_on = NULL WHERE id`,
      [brasiliaNow().hour],
    );
    const before = sent.length;
    expect((await alerts.sweep()).summary).toBe(true);
    expect(sent.slice(before).map((s) => s.text)[0]).toContain('Resumo do dia');
    expect((await alerts.sweep()).summary).toBe(false);
  });

  it('teste de envio, desligar o menu e remover o número', async () => {
    const m = (await pget('/menu').expect(200)).body;
    const op = m.operators[0].id as string;
    await psend('post', `/menu/operators/${op}/test`).expect(200);
    expect(sent.at(-1)?.text).toContain('Menu do Super Admin ligado');
    await psend('patch', `/menu/operators/${op}`, { summary: false }).expect(200);
    await psend('put', '/menu', { enabled: false, summaryHour: 8 }).expect(200);
    expect(await say('menu')).toEqual([]);
    await psend('put', '/menu', { enabled: true, summaryHour: 8 }).expect(200);
    expect(await say('menu')).toHaveLength(1);
    const r = await psend('delete', `/menu/operators/${op}`).expect(200);
    expect(r.body.operators).toHaveLength(0);
    expect(await say('menu')).toEqual([]);
    const log = await ownerQuery<{ action: string }>(
      `SELECT action FROM platform_audit_log WHERE action LIKE 'whatsapp.operator_%' ORDER BY id`,
    );
    expect(log.map((l) => l.action)).toEqual([
      'whatsapp.operator_added',
      'whatsapp.operator_updated',
      'whatsapp.operator_removed',
    ]);
  });
});
