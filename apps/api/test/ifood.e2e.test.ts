import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { IfoodCatalogService } from '../src/integrations/ifood/ifood-catalog.service';
import { testEnv } from './env';
import { approveChannelStores, Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Cardápio de integração com o iFood, com um servidor falso no lugar da Merchant API.
 * Cobre: ligar a loja (e não deixar outro restaurante ligar a mesma), criar o cardápio do iFood,
 * primeira sincronização (categoria + item completo), segunda sem alteração, preço por PATCH,
 * item retirado fica indisponível, envio automático depois de uma edição e isolamento.
 */
const HOST_A = 'if-a.comandou.test';
const HOST_B = 'if-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const MERCHANT = '11111111-2222-3333-4444-555555555555';

interface Call {
  method: string;
  path: string;
  body?: unknown;
  auth?: string;
}
const calls: Call[] = [];
/** O que está "no iFood": categorias criadas e itens enviados (o portal pode mexer aqui). */
interface RemoteItemPut {
  item: {
    id: string;
    categoryId: string;
    status: string;
    price: { value: number };
    externalCode?: string;
    productId: string;
  };
  products: {
    id: string;
    name: string;
    description?: string;
    optionGroups?: { id: string; min: number; max: number }[];
  }[];
  optionGroups: { id: string; name: string; status: string; optionIds: string[] }[];
  options: { id: string; productId: string; status: string; price: { value: number } }[];
}
const remote = {
  categories: new Map<string, { id: string; name: string; externalCode?: string }>(),
  items: new Map<string, RemoteItemPut>(),
};
let ifood: Server;
let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;
const cookies: Record<string, string> = {};

function handler(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const path = new URL(req.url!, 'http://x').pathname;
    let body: unknown;
    try {
      body = raw && req.headers['content-type']?.includes('json') ? JSON.parse(raw) : raw;
    } catch {
      body = raw;
    }
    calls.push({ method: req.method!, path, body, auth: req.headers.authorization });
    const send = (code: number, b: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(b));
    };
    if (path === '/authentication/v1.0/oauth/token') {
      const f = new URLSearchParams(raw);
      if (f.get('grantType') !== 'client_credentials' || f.get('clientSecret') !== 'segredo-ifood')
        return send(401, { message: 'invalid' });
      return send(200, { accessToken: 'tok-ifood', type: 'bearer', expiresIn: 21600 });
    }
    if (req.headers.authorization !== 'Bearer tok-ifood') return send(401, {});
    if (path === `/merchant/v1.0/merchants/${MERCHANT}`)
      return send(200, { id: MERCHANT, name: 'Teste - Loja iFood' });
    if (path.startsWith('/merchant/v1.0/merchants/')) return send(404, { message: 'not found' });
    const base = `/catalog/v2.0/merchants/${MERCHANT}`;
    if (path === `${base}/catalogs`)
      return send(200, [{ catalogId: 'catalogo-1', context: ['DEFAULT'], status: 'AVAILABLE' }]);
    if (req.method === 'POST' && path === `${base}/catalogs/catalogo-1/categories`) {
      const c = { id: randomUUID(), ...(body as { name: string; externalCode?: string }) };
      remote.categories.set(c.id, c);
      return send(201, c);
    }
    if (req.method === 'GET' && path === `${base}/catalogs/catalogo-1/categories`)
      return send(200, [...remote.categories.values()]);
    const ci = new RegExp(`^${base}/categories/([^/]+)/items$`).exec(path);
    if (req.method === 'GET' && ci) {
      const list = [...remote.items.values()].filter((x) => x.item.categoryId === ci[1]);
      return send(200, {
        categoryId: ci[1],
        items: list.map((x) => x.item),
        products: list.flatMap((x) => x.products),
        optionGroups: list.flatMap((x) => x.optionGroups),
        options: list.flatMap((x) => x.options),
      });
    }
    if (req.method === 'PATCH' && path.startsWith(`${base}/catalogs/catalogo-1/categories/`))
      return send(200, {});
    if (req.method === 'PUT' && path === `${base}/items`) {
      const b = structuredClone(body) as RemoteItemPut;
      remote.items.set(b.item.id, b);
      return send(200, body);
    }
    if (
      req.method === 'PATCH' &&
      (path === `${base}/items/price` || path === `${base}/items/status`)
    ) {
      const b = body as { itemId: string; price?: { value: number }; status?: string };
      const it = remote.items.get(b.itemId);
      if (it && b.price) it.item.price = b.price;
      if (it && b.status) it.item.status = b.status;
      return send(200, {});
    }
    if (req.method === 'POST' && path === `${base}/image/upload`)
      return send(201, { imagePath: `${MERCHANT}/foto.jpeg` });
    send(404, { message: `rota falsa ausente: ${req.method} ${path}` });
  });
}

const hostOf = (who: string) => (who.endsWith('B') ? HOST_B : HOST_A);
const get = (w: string, url: string) =>
  http
    .get(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '');
const send = (method: 'post' | 'put' | 'patch' | 'delete', w: string, url: string, body?: object) =>
  http[method](`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body ?? {});

async function login(host: string, email: string) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0];
}

const since = (n: number) => calls.slice(n);
let connectionId = '';
let menuId = '';

beforeAll(async () => {
  ifood = createServer(handler);
  await new Promise<void>((r) => ifood.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(ifood.address() as AddressInfo).port}`;
  fx = await seedTwoTenants('if');
  const redis = process.env.TEST_REDIS_URL;
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      IFOOD_API_URL: url,
      IFOOD_CLIENT_ID: 'cliente-ifood',
      IFOOD_CLIENT_SECRET: 'segredo-ifood',
      IFOOD_SYNC_DELAY_SECONDS: '2',
      ...(redis ? { REDIS_URL: redis, QUEUE_PREFIX: `t${Date.now()}` } : {}),
    }),
    { logger: false },
  );
  await app.listen(0, '127.0.0.1');
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@if-a.test');
  cookies.adminB = await login(HOST_B, 'admin@if-b.test');
  cookies.waiterA = await login(HOST_A, 'garcom@if-a.test');
});
afterAll(async () => {
  await app?.close();
  await new Promise((r) => ifood?.close(r));
});

async function waitFor(check: () => boolean, ms = 12_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('iFood: lojas ligadas', () => {
  it('mostra que a integração está configurada', async () => {
    const s = (await get('adminA', '/ifood/status').expect(200)).body;
    expect(s).toMatchObject({ configured: true, mode: 'centralized' });
  });

  it('garçom não liga loja; id desconhecido é recusado', async () => {
    await send('post', 'waiterA', '/ifood/connections', { merchantId: MERCHANT }).expect(403);
    await send('post', 'adminA', '/ifood/connections', {
      merchantId: '99999999-0000-0000-0000-000000000000',
    }).expect(400);
  });

  it('liga a loja e não deixa outro restaurante ligar a mesma', async () => {
    const c = (
      await send('post', 'adminA', '/ifood/connections', { merchantId: MERCHANT }).expect(201)
    ).body;
    expect(c.merchantName).toBe('Teste - Loja iFood');
    connectionId = c.id;
    await approveChannelStores();
    await send('post', 'adminB', '/ifood/connections', { merchantId: MERCHANT }).expect(409);
    const list = (await get('adminA', '/ifood/connections').expect(200)).body;
    expect(list).toHaveLength(1);
    expect((await get('adminB', '/ifood/connections').expect(200)).body).toHaveLength(0);
  });
});

describe('iFood: cardápio de integração', () => {
  it('cria o cardápio do iFood ligado à loja (sem loja é recusado)', async () => {
    await send('post', 'adminA', '/menus', { name: 'iFood', kind: 'ifood' }).expect(400);
    const m = (
      await send('post', 'adminA', '/menus', {
        name: 'iFood',
        kind: 'ifood',
        ifoodConnectionId: connectionId,
      }).expect(201)
    ).body;
    expect(m).toMatchObject({ kind: 'ifood', active: true });
    menuId = m.id;
    // Pausa o envio automático para os testes de sincronização manual serem previsíveis.
    await send('patch', 'adminA', `/menus/${menuId}`, { active: false }).expect(200);
    // Segunda loja não pode receber o mesmo cardápio; o Delivery continua ativo.
    await send('post', 'adminA', '/menus', {
      name: 'Outro iFood',
      kind: 'ifood',
      ifoodConnectionId: connectionId,
    }).expect(409);
    const menus = (await get('adminA', '/menus').expect(200)).body as {
      kind: string;
      active: boolean;
      ifoodMerchantName?: string;
    }[];
    expect(menus.some((x) => x.kind === 'delivery' && x.active)).toBe(true);
    expect(menus.find((x) => x.kind === 'ifood')?.ifoodMerchantName).toBe('Teste - Loja iFood');
    await new Promise((r) => setTimeout(r, 2500));
  });

  it('primeira sincronização cria categoria e itens completos', async () => {
    const n = calls.length;
    const r = (await send('post', 'adminA', `/ifood/menus/${menuId}/sync`).expect(200)).body;
    expect(r.status).toBe('ok');
    expect(r.summary.created).toBeGreaterThanOrEqual(1);
    expect(r.summary).toMatchObject({ updated: 0, unchanged: 0, unavailable: 0, failed: 0 });
    expect(r.text).toMatch(/criado\(s\), 0 atualizado\(s\), 0 sem alteração/);
    const puts = since(n).filter((c) => c.method === 'PUT');
    const x = puts.find(
      (c) => (c.body as { products: { name: string }[] }).products[0]?.name === 'X-Burguer A',
    );
    expect(x).toBeTruthy();
    const body = x!.body as {
      item: { price: { value: number }; status: string; categoryId: string };
    };
    expect(body.item.price.value).toBe(25.9);
    expect(body.item.status).toBe('AVAILABLE');
    expect(since(n).some((c) => c.method === 'POST' && c.path.endsWith('/categories'))).toBe(true);
  });

  it('segunda sincronização sem mudança não manda nada', async () => {
    const n = calls.length;
    const r = (await send('post', 'adminA', `/ifood/menus/${menuId}/sync`).expect(200)).body;
    expect(r.summary.created).toBe(0);
    expect(r.summary.updated).toBe(0);
    expect(r.summary.unchanged).toBeGreaterThanOrEqual(1);
    expect(since(n).filter((c) => c.method !== 'GET' && !c.path.includes('oauth'))).toHaveLength(0);
  });

  it('preço próprio no cardápio vai por PATCH, sem reenviar o item', async () => {
    const items = (await get('adminA', `/menus/${menuId}/items`).expect(200)).body as {
      productId: string;
      price: string | null;
    }[];
    await send('put', 'adminA', `/menus/${menuId}/items`, {
      items: items.map((i) => ({
        productId: i.productId,
        price: i.productId === fx.prodA ? '29.90' : i.price,
      })),
    }).expect(200);
    const n = calls.length;
    const r = (await send('post', 'adminA', `/ifood/menus/${menuId}/sync`).expect(200)).body;
    expect(r.summary.updated).toBe(1);
    const writes = since(n).filter((c) => c.method !== 'GET' && !c.path.includes('oauth'));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: 'PATCH', body: { price: { value: 29.9 } } });
    expect(writes[0]!.path).toMatch(/\/items\/price$/);
  });

  it('item esgotado e item retirado do cardápio ficam indisponíveis', async () => {
    const items = (await get('adminA', `/menus/${menuId}/items`).expect(200)).body as {
      productId: string;
      price: string | null;
    }[];
    await send('put', 'adminA', `/menus/${menuId}/items`, {
      items: items.filter((i) => i.productId !== fx.prodA),
    }).expect(200);
    const n = calls.length;
    const r = (await send('post', 'adminA', `/ifood/menus/${menuId}/sync`).expect(200)).body;
    expect(r.summary.unavailable).toBe(1);
    expect(
      since(n).some(
        (c) =>
          c.method === 'PATCH' &&
          c.path.endsWith('/items/status') &&
          (c.body as { status: string }).status === 'UNAVAILABLE',
      ),
    ).toBe(true);
    // Volta ao cardápio: reativa no iFood.
    await send('put', 'adminA', `/menus/${menuId}/items`, {
      items: [
        ...items.filter((i) => i.productId !== fx.prodA),
        { productId: fx.prodA, price: null },
      ],
    }).expect(200);
    const n2 = calls.length;
    const r2 = (await send('post', 'adminA', `/ifood/menus/${menuId}/sync`).expect(200)).body;
    expect(r2.summary.updated).toBe(1);
    expect(
      since(n2).some(
        (c) => c.method === 'PATCH' && (c.body as { status?: string }).status === 'AVAILABLE',
      ),
    ).toBe(true);
  });

  it('foto em WebP: o navegador manda em JPG e o item vai com a foto', async () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBPVP8 '),
      Buffer.alloc(20),
    ]);
    const [m] = await ownerQuery<{ id: string }>(
      `INSERT INTO media (tenant_id, content_type, bytes, size) VALUES ($1, 'image/webp', $2, $3) RETURNING id`,
      [fx.tenantA, webp, webp.length],
    );
    await ownerQuery(`UPDATE products SET image_id = $1 WHERE id = $2`, [m!.id, fx.prodA]);
    const st = (await get('adminA', `/ifood/menus/${menuId}/sync`).expect(200)).body;
    expect(st.pendingImages).toContain(m!.id);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
    await http
      .post(`/api/v1/ifood/menus/${menuId}/images/${m!.id}`)
      .set('Host', HOST_A)
      .set('Cookie', cookies.adminA!)
      .set(CSRF)
      .set('Content-Type', 'image/jpeg')
      .send(jpg)
      .expect(200);
    const up = calls.filter((c) => c.path.endsWith('/image/upload')).at(-1)!;
    expect(String((up.body as { image: string }).image)).toMatch(/^data:image\/jpeg;base64,/);
    const n = calls.length;
    const r = (await send('post', 'adminA', `/ifood/menus/${menuId}/sync`).expect(200)).body;
    expect(r.summary.updated).toBe(1);
    expect(r.pendingImages ?? []).not.toContain(m!.id);
    const put = since(n).find((c) => c.method === 'PUT')!;
    expect((put.body as { products: { imagePath?: string }[] }).products[0]!.imagePath).toBe(
      `${MERCHANT}/foto.jpeg`,
    );
  });

  it('com o cardápio ativo, uma edição já vai sozinha para o iFood', async () => {
    await send('patch', 'adminA', `/menus/${menuId}`, { active: true }).expect(200);
    await new Promise((r) => setTimeout(r, 3000));
    const items = (await get('adminA', `/menus/${menuId}/items`).expect(200)).body as {
      productId: string;
      price: string | null;
    }[];
    const n = calls.length;
    await send('put', 'adminA', `/menus/${menuId}/items`, {
      items: items.map((i) => ({
        productId: i.productId,
        price: i.productId === fx.prodA ? '31.00' : i.price,
      })),
    }).expect(200);
    await waitFor(() =>
      since(n).some(
        (c) =>
          c.path.endsWith('/items/price') &&
          (c.body as { price: { value: number } }).price.value === 31,
      ),
    );
    const s = (await get('adminA', `/ifood/menus/${menuId}/sync`).expect(200)).body;
    expect(s.merchantName).toBe('Teste - Loja iFood');
  });

  it('item sem estoque pela ficha técnica fica indisponível no iFood e volta sozinho', async () => {
    const catalog = app.get(IfoodCatalogService);
    const [st] = await ownerQuery<{ id: string }>(
      `INSERT INTO stock_items (tenant_id, name, unit, quantity) VALUES ($1, 'Pão', 'un', 0) RETURNING id`,
      [fx.tenantA],
    );
    await ownerQuery(
      `INSERT INTO product_recipes (tenant_id, product_id, stock_item_id, quantity) VALUES ($1,$2,$3,1)`,
      [fx.tenantA, fx.prodA, st!.id],
    );
    const n = calls.length;
    expect(await catalog.stockChanged(fx.tenantA)).toBe(true);
    await waitFor(() =>
      since(n).some(
        (c) =>
          c.path.endsWith('/items/status') &&
          (c.body as { status: string }).status === 'UNAVAILABLE',
      ),
    );
    await new Promise((r) => setTimeout(r, 500));
    // Já está igual no iFood: não agenda de novo.
    expect(await catalog.stockChanged(fx.tenantA)).toBe(false);
    await ownerQuery(`UPDATE stock_items SET quantity = 10 WHERE id = $1`, [st!.id]);
    const n2 = calls.length;
    expect(await catalog.stockChanged(fx.tenantA)).toBe(true);
    await waitFor(() =>
      since(n2).some(
        (c) =>
          c.path.endsWith('/items/status') && (c.body as { status: string }).status === 'AVAILABLE',
      ),
    );
    await new Promise((r) => setTimeout(r, 500));
    // Daqui para a frente, envio só manual (testes previsíveis).
    await send('patch', 'adminA', `/menus/${menuId}`, { active: false }).expect(200);
    await new Promise((r) => setTimeout(r, 2500));
  });

  it('mudança feita no portal do iFood aparece e "Mandar o do Comandou" corrige', async () => {
    const [row] = await ownerQuery<{ remote_id: string }>(
      `SELECT remote_id FROM ifood_sync_map WHERE menu_id = $1 AND entity = 'item' AND local_id = $2`,
      [menuId, fx.prodA],
    );
    const it = remote.items.get(row!.remote_id)!;
    it.item.price = { value: 99.9 };
    it.item.status = 'UNAVAILABLE';
    const fresh = () =>
      ownerQuery(`UPDATE menus SET ifood_drift_at = NULL WHERE id = $1`, [menuId]);
    await fresh();
    const d = (await get('adminA', `/ifood/menus/${menuId}/drift`).expect(200)).body;
    const a = d.changed.find((c: { localId: string }) => c.localId === fx.prodA);
    expect(a.changes).toEqual(
      expect.arrayContaining([
        { field: 'price', remote: '99.90', local: '31.00' },
        { field: 'status', remote: 'unavailable', local: 'available' },
      ]),
    );
    // Garçom não manda; outro restaurante não vê.
    await send('post', 'waiterA', `/ifood/menus/${menuId}/drift/resend`).expect(403);
    await get('adminB', `/ifood/menus/${menuId}/drift`).expect(404);
    const n = calls.length;
    const r = (await send('post', 'adminA', `/ifood/menus/${menuId}/drift/resend`).expect(200))
      .body;
    expect(r.resent).toBeGreaterThanOrEqual(1);
    const put = since(n).find(
      (c) => c.method === 'PUT' && (c.body as RemoteItemPut).item.id === row!.remote_id,
    );
    expect((put!.body as RemoteItemPut).item).toMatchObject({
      price: { value: 31 },
      status: 'AVAILABLE',
    });
    await fresh();
    const d2 = (await send('post', 'adminA', `/ifood/menus/${menuId}/drift/check`).expect(200))
      .body;
    expect(d2.changed).toEqual([]);
    // Conferir de novo logo em seguida não lê o iFood outra vez.
    const n2 = calls.length;
    await send('post', 'adminA', `/ifood/menus/${menuId}/drift/check`).expect(200);
    expect(since(n2).filter((c) => c.path.includes('/categories'))).toHaveLength(0);
  });

  it('item que só existe no iFood é trazido para o Comandou, já ligado', async () => {
    const catId = randomUUID();
    remote.categories.set(catId, { id: catId, name: 'Sobremesas do iFood' });
    remote.items.set('item-portal-1', {
      item: {
        id: 'item-portal-1',
        categoryId: catId,
        status: 'AVAILABLE',
        price: { value: 18.5 },
        externalCode: 'PORTAL-77',
        productId: 'prod-portal-1',
      },
      products: [
        {
          id: 'prod-portal-1',
          name: 'Pudim',
          description: 'Pudim de leite',
          optionGroups: [{ id: 'grp-portal-1', min: 0, max: 1 }],
        },
        { id: 'prod-opt-1', name: 'Calda extra' },
      ],
      optionGroups: [
        {
          id: 'grp-portal-1',
          name: 'Adicionais',
          status: 'AVAILABLE',
          optionIds: ['opt-portal-1'],
        },
      ],
      options: [
        { id: 'opt-portal-1', productId: 'prod-opt-1', status: 'AVAILABLE', price: { value: 2.5 } },
      ],
    });
    await ownerQuery(`UPDATE menus SET ifood_drift_at = NULL WHERE id = $1`, [menuId]);
    const d = (await send('post', 'adminA', `/ifood/menus/${menuId}/drift/check`).expect(200)).body;
    const only = d.onlyRemote as { id: string; name: string; price: string }[];
    expect(only.map((x) => x.id)).toEqual(['item-portal-1']);
    expect(only[0]).toMatchObject({ name: 'Pudim', price: '18.50' });
    await send('post', 'adminA', `/ifood/menus/${menuId}/import`, { itemIds: ['outro'] }).expect(
      409,
    );
    await send('post', 'adminB', `/ifood/menus/${menuId}/import`, {
      itemIds: ['item-portal-1'],
    }).expect(404);
    const r = (
      await send('post', 'adminA', `/ifood/menus/${menuId}/import`, {
        itemIds: ['item-portal-1'],
      }).expect(200)
    ).body;
    expect(r.imported).toBe(1);
    const [p] = await ownerQuery<{ name: string; price: string; category: string }>(
      `SELECT p.name, p.price::text, c.name AS category FROM products p
         JOIN categories c ON c.id = p.category_id WHERE p.id = $1`,
      [r.productIds[0]],
    );
    expect(p).toEqual({ name: 'Pudim', price: '18.50', category: 'Sobremesas do iFood' });
    const [g] = await ownerQuery<{ name: string; options: string[] }>(
      `SELECT g.name, array_agg(o.name || ' ' || o.price_delta) AS options
         FROM product_option_groups pog JOIN option_groups g ON g.id = pog.group_id
         JOIN options o ON o.group_id = g.id WHERE pog.product_id = $1 GROUP BY g.name`,
      [r.productIds[0]],
    );
    expect(g).toEqual({ name: 'Adicionais', options: ['Calda extra 2.50'] });
    const [link] = await ownerQuery<{ item_key: string }>(
      `SELECT item_key FROM channel_item_links WHERE product_id = $1`,
      [r.productIds[0]],
    );
    expect(link!.item_key).toBe('code:PORTAL-77');
    // O próximo envio não cria outro igual no iFood (nem a categoria).
    const n = calls.length;
    const s = (await send('post', 'adminA', `/ifood/menus/${menuId}/sync`).expect(200)).body;
    expect(s.status).toBe('ok');
    const writes = since(n).filter((c) => c.method !== 'GET' && !c.path.includes('oauth'));
    expect(writes).toEqual([]);
    const d2 = (await get('adminA', `/ifood/menus/${menuId}/drift`).expect(200)).body;
    expect(d2.onlyRemote).toEqual([]);
  });

  it('isolamento: outro restaurante não vê nem sincroniza o cardápio', async () => {
    await get('adminB', `/ifood/menus/${menuId}/sync`).expect(404);
    await send('post', 'adminB', `/ifood/menus/${menuId}/sync`).expect(404);
    await send('delete', 'adminB', `/ifood/connections/${connectionId}`).expect(404);
  });

  it('desligar a loja libera para ligar de novo', async () => {
    await send('delete', 'adminA', `/ifood/connections/${connectionId}`).expect(200);
    const c = (
      await send('post', 'adminB', '/ifood/connections', { merchantId: MERCHANT }).expect(201)
    ).body;
    expect(c.merchantId).toBe(MERCHANT);
    await approveChannelStores();
  });
});
