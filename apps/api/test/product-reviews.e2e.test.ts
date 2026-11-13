import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Item do cardápio com mais fotos e avaliações: a equipe envia as fotos extras e esconde
 * avaliações; o cliente com a conta aberta avalia (nota e comentário) e curte avaliações.
 */
const HOST = 'avalia-a.comandou.test';
const OTHER = 'avalia-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };
const FAKE_WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(14, 1),
]);

let app: INestApplication;
let http: ReturnType<typeof request>;
let staff = '';
let product = '';
const cookieFrom = (res: request.Response, name: string) =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? [])
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0];
const as = (r: request.Test, cookie = staff, host = HOST) =>
  r.set('Host', host).set('Cookie', cookie).set(CSRF);
const pub = (r: request.Test, cookie?: string) => {
  r.set('Host', HOST).set(CSRF);
  return cookie ? r.set('Cookie', cookie) : r;
};
const menuProduct = async () => {
  const cats = (await http.get('/api/v1/store').set('Host', HOST).expect(200)).body.categories as {
    products: {
      id: string;
      photos: string[];
      rating: { average: number; count: number } | null;
    }[];
  }[];
  return cats.flatMap((c) => c.products).find((p) => p.id === product)!;
};
async function signup(name: string, phone: string) {
  const r = await pub(http.post('/api/v1/store/account/signup'))
    .send({ name, phone, password: 'segredo1' })
    .expect(201);
  return cookieFrom(r, 'cm_cid')!;
}

beforeAll(async () => {
  await seedTwoTenants('avalia');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', HOST)
    .set(CSRF)
    .send({ email: 'admin@avalia-a.test', password: PASSWORD });
  staff = cookieFrom(res, 'cm_sid')!;
  await as(http.patch('/api/v1/store/settings')).send({ enabled: true, isOpen: true }).expect(200);
  const cat = await as(http.post('/api/v1/categories')).send({ name: 'Lanches' }).expect(201);
  const p = await as(http.post('/api/v1/products'))
    .send({ categoryId: cat.body.id, name: 'X-Salada', price: '25.00' })
    .expect(201);
  product = p.body.id;
});

afterAll(async () => {
  await app.close();
});

describe('fotos extras do item', () => {
  it('a equipe envia, ordena e o cardápio mostra; outro restaurante não mexe', async () => {
    expect((await menuProduct()).photos).toEqual([]);
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const up = await as(http.post('/api/v1/media?w=800&h=800'))
        .set('Content-Type', 'image/webp')
        .send(FAKE_WEBP)
        .expect(201);
      ids.push(up.body.id);
    }
    await as(http.put(`/api/v1/products/${product}/photos`))
      .send({ imageIds: [ids[1], ids[0]] })
      .expect(200);
    expect((await as(http.get(`/api/v1/products/${product}/photos`)).expect(200)).body).toEqual({
      imageIds: [ids[1], ids[0]],
    });
    expect((await menuProduct()).photos).toEqual(ids.reverse().map((id) => `/api/v1/media/${id}`));
    // Repetida ou de mais: recusa.
    await as(http.put(`/api/v1/products/${product}/photos`))
      .send({ imageIds: [ids[0], ids[0]] })
      .expect(400);
    // Outro restaurante: o produto não existe para ele.
    const other = await http
      .post('/api/v1/auth/login')
      .set('Host', OTHER)
      .set(CSRF)
      .send({ email: 'admin@avalia-b.test', password: PASSWORD });
    await as(http.put(`/api/v1/products/${product}/photos`), cookieFrom(other, 'cm_sid')!, OTHER)
      .send({ imageIds: [] })
      .expect(404);
  });
});

describe('avaliações do item', () => {
  let ana = '';
  let bia = '';
  let anaReview = '';

  it('sem conta só lê; com conta avalia, e avaliar de novo troca a nota', async () => {
    const empty = (await pub(http.get(`/api/v1/store/products/${product}/reviews`)).expect(200))
      .body;
    expect(empty).toMatchObject({ average: null, count: 0, reviews: [], mine: null });
    await pub(http.put(`/api/v1/store/products/${product}/reviews`))
      .send({ rating: 5 })
      .expect(401);
    ana = await signup('Ana Paula Souza', '11977776666');
    bia = await signup('Bia', '11977775555');
    await pub(http.put(`/api/v1/store/products/${product}/reviews`), ana)
      .send({ rating: 6 })
      .expect(400);
    await pub(http.put(`/api/v1/store/products/${product}/reviews`), ana)
      .send({ rating: 3, comment: 'Bom' })
      .expect(200);
    const r = await pub(http.put(`/api/v1/store/products/${product}/reviews`), ana)
      .send({ rating: 5, comment: '  Muito bom!  ' })
      .expect(200);
    // Só o primeiro nome aparece, e nada do telefone.
    expect(r.body).toMatchObject({ rating: 5, comment: 'Muito bom!', name: 'Ana', mine: true });
    expect(JSON.stringify(r.body)).not.toContain('11977776666');
    anaReview = r.body.id;
    await pub(http.put(`/api/v1/store/products/${product}/reviews`), bia)
      .send({ rating: 4, comment: '' })
      .expect(200);
    const list = (await pub(http.get(`/api/v1/store/products/${product}/reviews`)).expect(200))
      .body;
    expect(list).toMatchObject({ average: 4.5, count: 2, breakdown: [0, 0, 0, 1, 1] });
    expect(list.reviews.find((x: { id: string }) => x.id === anaReview).mine).toBe(false);
    expect(await menuProduct()).toMatchObject({ rating: { average: 4.5, count: 2 } });
  });

  it('o coração numa avaliação liga e desliga, uma vez por cliente', async () => {
    const like = (cookie: string, liked: boolean) =>
      pub(http.post(`/api/v1/store/products/${product}/reviews/${anaReview}/like`), cookie).send({
        liked,
      });
    expect((await like(bia, true).expect(201)).body).toEqual({ liked: true, likes: 1 });
    expect((await like(bia, true).expect(201)).body).toEqual({ liked: true, likes: 1 });
    expect((await like(ana, true).expect(201)).body).toEqual({ liked: true, likes: 2 });
    expect((await like(ana, false).expect(201)).body).toEqual({ liked: false, likes: 1 });
    const seen = (await pub(http.get(`/api/v1/store/products/${product}/reviews`), bia).expect(200))
      .body;
    expect(seen.reviews[0]).toMatchObject({ id: anaReview, likes: 1, liked: true });
    expect(seen.mine).toMatchObject({ rating: 4, comment: null });
  });

  it('a equipe esconde: some do cardápio e da média', async () => {
    const all = (await as(http.get(`/api/v1/products/${product}/reviews`)).expect(200)).body;
    expect(all).toHaveLength(2);
    await as(http.patch(`/api/v1/product-reviews/${anaReview}`))
      .send({ hidden: true })
      .expect(200);
    const list = (await pub(http.get(`/api/v1/store/products/${product}/reviews`)).expect(200))
      .body;
    expect(list).toMatchObject({ average: 4, count: 1 });
    expect(await menuProduct()).toMatchObject({ rating: { average: 4, count: 1 } });
    await as(http.patch(`/api/v1/product-reviews/${anaReview}`))
      .send({ hidden: false })
      .expect(200);
    // O cliente apaga a própria avaliação.
    await pub(http.delete(`/api/v1/store/products/${product}/reviews`), bia).expect(200);
    expect(await menuProduct()).toMatchObject({ rating: { average: 5, count: 1 } });
  });
});
