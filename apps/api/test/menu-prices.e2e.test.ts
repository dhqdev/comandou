import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { Fixture, PASSWORD, ownerQuery, seedTwoTenants } from './fixtures';

/**
 * Cardápio: categoria com ícone e cozinha, e "Reajustar preços" de um cardápio (prévia,
 * arredondamento, filtro de categoria e complementos). Dois restaurantes para checar isolamento.
 */
const HOST_A = 'mp-a.comandou.test';
const HOST_B = 'mp-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let fx: Fixture;
let http: ReturnType<typeof request>;
const cookies: Record<string, string> = {};

async function login(host: string, email: string, password = PASSWORD) {
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', host)
    .set(CSRF)
    .send({ email, password });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.find((c) => c.startsWith('cm_sid='))!.split(';')[0];
}

const hostOf = (w: string) => (w.endsWith('B') ? HOST_B : HOST_A);
const get = (w: string, url: string) =>
  http
    .get(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '');
const post = (w: string, url: string, body: object = {}, idem?: string) => {
  const r = http
    .post(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF);
  if (idem) r.set('Idempotency-Key', idem);
  return r.send(body);
};
const patch = (w: string, url: string, body: object) =>
  http
    .patch(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body);
const put = (w: string, url: string, body: object) =>
  http
    .put(`/api/v1${url}`)
    .set('Host', hostOf(w))
    .set('Cookie', cookies[w] ?? '')
    .set(CSRF)
    .send(body);

beforeAll(async () => {
  fx = await seedTwoTenants('mp');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.listen(0, '127.0.0.1');
  http = request(app.getHttpServer());
  cookies.adminA = await login(HOST_A, 'admin@mp-a.test');
  cookies.adminB = await login(HOST_B, 'admin@mp-b.test');
  cookies.waiterA = await login(HOST_A, 'garcom@mp-a.test');
});
afterAll(async () => {
  await app?.close();
});

interface Menu {
  id: string;
  kind: string;
  active: boolean;
}
interface Change {
  id: string;
  name: string;
  from: string;
  to: string;
}

describe('Categoria com ícone e cozinha', () => {
  it('a cozinha da categoria vale para os itens dela e para item novo', async () => {
    const [sector] = await ownerQuery<{ id: string }>(
      `INSERT INTO production_sectors (tenant_id, name) VALUES ($1, 'Chapa') RETURNING id`,
      [fx.tenantA],
    );
    const cat = (
      await post('adminA', '/categories', { name: 'Lanches', icon: '🍔', sectorId: null }).expect(
        201,
      )
    ).body as { id: string; icon: string };
    expect(cat.icon).toBe('🍔');
    const p1 = (
      await post('adminA', '/products', { categoryId: cat.id, name: 'Smash', price: '20.00' })
    ).body as { id: string; sectorId: string | null };
    expect(p1.sectorId).toBeNull();
    await patch('adminA', `/categories/${cat.id}`, { sectorId: sector.id }).expect(200);
    const after = (await get('adminA', `/products/${p1.id}`).expect(200)).body as {
      sectorId: string;
    };
    expect(after.sectorId).toBe(sector.id);
    const p2 = (
      await post('adminA', '/products', { categoryId: cat.id, name: 'Duplo', price: '25.00' })
    ).body as { sectorId: string };
    expect(p2.sectorId).toBe(sector.id);
    // Cozinha de outro restaurante não serve.
    const [sectorB] = await ownerQuery<{ id: string }>(
      `INSERT INTO production_sectors (tenant_id, name) VALUES ($1, 'Bar B') RETURNING id`,
      [fx.tenantB],
    );
    await patch('adminA', `/categories/${cat.id}`, { sectorId: sectorB.id }).expect(404);
  });
});

describe('Reajustar preços do cardápio', () => {
  it('prévia não grava; aplicar vira preço próprio só deste cardápio', async () => {
    const menus = (await get('adminA', '/menus').expect(200)).body as Menu[];
    const delivery = menus.find((m) => m.kind === 'delivery' && m.active)!;
    const principal = menus.find((m) => m.kind === 'principal' && m.active)!;
    const url = `/menus/${delivery.id}/price-adjust`;
    await post('waiterA', url, { percent: 10, rounding: 'none' }).expect(403);
    await post('adminA', url, { percent: 0, rounding: 'none' }).expect(400);
    await post('adminA', url, { percent: 500, rounding: 'none' }).expect(400);
    await post('adminB', url, { percent: 10, rounding: 'none' }).expect(404);

    const prev = (
      await post('adminA', url, { percent: 10, rounding: 'x90', preview: true }).expect(201)
    ).body as { applied: boolean; items: Change[] };
    expect(prev.applied).toBe(false);
    const x = prev.items.find((i) => i.id === fx.prodA)!;
    expect(x).toMatchObject({ from: '25.90', to: '28.90' }); // 28,49 sobe para 28,90
    let items = (await get('adminA', `/menus/${delivery.id}/items`).expect(200)).body as {
      productId: string;
      price: string | null;
    }[];
    expect(items.find((i) => i.productId === fx.prodA)!.price).toBeNull();

    const done = (await post('adminA', url, { percent: 10, rounding: 'x90' }).expect(201)).body as {
      applied: boolean;
      items: Change[];
    };
    expect(done.applied).toBe(true);
    items = (await get('adminA', `/menus/${delivery.id}/items`).expect(200)).body;
    expect(items.find((i) => i.productId === fx.prodA)!.price).toBe('28.90');
    // O Principal e o preço do item não mudam.
    const base = (await get('adminA', `/products/${fx.prodA}`).expect(200)).body as {
      price: string;
    };
    expect(base.price).toBe('25.90');
    const pItems = (await get('adminA', `/menus/${principal.id}/items`).expect(200)).body as {
      productId: string;
      price: string | null;
    }[];
    expect(pItems.find((i) => i.productId === fx.prodA)!.price).toBeNull();
    // A venda no delivery usa o preço novo.
    const tree = (await get('adminA', '/menu?channel=delivery').expect(200)).body as {
      products: { id: string; price: string }[];
    }[];
    const sold = tree.flatMap((c) => c.products).find((p) => p.id === fx.prodA)!;
    expect(sold.price).toBe('28.90');
  });

  it('filtra por categoria e reajusta os complementos quando pedido', async () => {
    const menus = (await get('adminA', '/menus').expect(200)).body as Menu[];
    const principal = menus.find((m) => m.kind === 'principal' && m.active)!;
    const group = (
      await post('adminA', '/option-groups', {
        name: 'Extras',
        minSelect: 0,
        maxSelect: 2,
        options: [
          { name: 'Bacon', priceDelta: '5.00' },
          { name: 'Sem cebola', priceDelta: '0.00' },
        ],
      }).expect(201)
    ).body as { id: string; options: { id: string; name: string }[] };
    const link = await put('adminA', `/products/${fx.prodA}/option-groups`, {
      groupIds: [group.id],
    });
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    const other = (await post('adminA', '/categories', { name: 'Bebidas', icon: '🥤' }).expect(201))
      .body as { id: string };
    const drink = (
      await post('adminA', '/products', { categoryId: other.id, name: 'Suco', price: '8.00' })
    ).body as { id: string };
    const url = `/menus/${principal.id}/price-adjust`;
    const r = (
      await post('adminA', url, {
        percent: -10,
        rounding: 'none',
        categoryId: fx.catA,
        options: true,
      }).expect(201)
    ).body as { items: Change[]; options: Change[] };
    expect(r.items.map((i) => i.id)).toContain(fx.prodA);
    expect(r.items.map((i) => i.id)).not.toContain(drink.id);
    // Sem preço continua sem preço: só o Bacon muda.
    expect(r.options).toEqual([
      {
        id: group.options.find((o) => o.name === 'Bacon')!.id,
        name: 'Extras: Bacon',
        from: '5.00',
        to: '4.50',
      },
    ]);
    const groups = (await get('adminA', '/option-groups').expect(200)).body as {
      id: string;
      options: { name: string; priceDelta: string }[];
    }[];
    const g = groups.find((x) => x.id === group.id)!;
    expect(g.options.find((o) => o.name === 'Bacon')!.priceDelta).toBe('4.50');
    expect(g.options.find((o) => o.name === 'Sem cebola')!.priceDelta).toBe('0.00');
  });
});
