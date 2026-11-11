import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { testEnv } from './env';
import { PASSWORD, seedTwoTenants } from './fixtures';

/**
 * Item do cardápio em 3D: o restaurante envia o GLB (e, se quiser, o USDZ do iPhone), o cardápio
 * online passa a trazer os endereços do modelo e o arquivo é público, como as fotos.
 */
const HOST = 'modelo-a.comandou.test';
const OTHER = 'modelo-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let cookie = '';
let product = '';

/** Menor GLB aceito: cabeçalho "glTF", versão 2 e um bloco JSON vazio. */
function glb() {
  const json = Buffer.from('{"asset":{"version":"2.0"}}   ');
  const head = Buffer.alloc(20);
  head.write('glTF', 0, 'latin1');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + json.length, 8);
  head.writeUInt32LE(json.length, 12);
  head.write('JSON', 16, 'latin1');
  return Buffer.concat([head, json]);
}
const usdz = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]);

const put = (format: string, type: string, body: Buffer, host = HOST) =>
  http
    .put(`/api/v1/products/${product}/model/${format}`)
    .set('Host', host)
    .set('Cookie', cookie)
    .set(CSRF)
    .set('Content-Type', type)
    .send(body);
const menuProduct = async () => {
  const cats = (await http.get('/api/v1/store').set('Host', HOST).expect(200)).body.categories as {
    products: { id: string; model: { glb: string; usdz: string | null } | null }[];
  }[];
  return cats.flatMap((c) => c.products).find((p) => p.id === product)!;
};

beforeAll(async () => {
  await seedTwoTenants('modelo');
  app = await createApp(testEnv({ AUTH_LOGIN_RATE_LIMIT: '1000' }), { logger: false });
  await app.init();
  http = request(app.getHttpServer());
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', HOST)
    .set(CSRF)
    .send({ email: 'admin@modelo-a.test', password: PASSWORD });
  cookie = (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_sid='))!
    .split(';')[0]!;
  const auth = (r: request.Test) => r.set('Host', HOST).set('Cookie', cookie).set(CSRF);
  await auth(http.patch('/api/v1/store/settings'))
    .send({ enabled: true, isOpen: true })
    .expect(200);
  const cat = await auth(http.post('/api/v1/categories')).send({ name: 'Bolos' }).expect(201);
  const p = await auth(http.post('/api/v1/products'))
    .send({ categoryId: cat.body.id, name: 'Bolo de cenoura', price: '18.00' })
    .expect(201);
  product = p.body.id;
});

afterAll(async () => {
  await app.close();
});

describe('modelo 3D do item', () => {
  it('sem modelo, o cardápio não traz nada', async () => {
    expect((await menuProduct()).model).toBeNull();
  });

  it('recusa arquivo que não é modelo', async () => {
    await put('glb', 'model/gltf-binary', Buffer.from('isto não é um modelo')).expect(422);
    await put('usdz', 'model/vnd.usdz+zip', glb()).expect(422);
    await put('glb', 'image/png', glb()).expect(422);
  });

  it('guarda o GLB e o cardápio passa a apontar para ele', async () => {
    const res = await put('glb', 'model/gltf-binary', glb()).expect(200);
    expect(res.body.glb.size).toBe(glb().length);
    expect(res.body.usdz).toBeNull();
    const { model } = await menuProduct();
    expect(model).toMatchObject({ usdz: null });
    expect(model!.glb).toContain(`/store/models/${product}/modelo.glb?v=`);

    const file = await http.get(model!.glb).set('Host', HOST).buffer(true).expect(200);
    expect(file.headers['content-type']).toBe('model/gltf-binary');
    expect(file.headers['cache-control']).toContain('immutable');
  });

  it('o USDZ do iPhone é opcional e entra junto', async () => {
    await put('usdz', 'model/vnd.usdz+zip', usdz()).expect(200);
    const { model } = await menuProduct();
    expect(model!.usdz).toContain('modelo.usdz');
    await http.get(model!.usdz!).set('Host', HOST).expect(200);
  });

  it('outro restaurante não lê nem troca o modelo', async () => {
    await http.get(`/api/v1/store/models/${product}/modelo.glb`).set('Host', OTHER).expect(404);
    const other = await http
      .post('/api/v1/auth/login')
      .set('Host', OTHER)
      .set(CSRF)
      .send({ email: 'admin@modelo-b.test', password: PASSWORD });
    const theirs = (other.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('cm_sid='))!
      .split(';')[0]!;
    await http
      .put(`/api/v1/products/${product}/model/glb`)
      .set('Host', OTHER)
      .set('Cookie', theirs)
      .set(CSRF)
      .set('Content-Type', 'model/gltf-binary')
      .send(glb())
      .expect(404);
  });

  it('remover tira o modelo do cardápio', async () => {
    await http
      .delete(`/api/v1/products/${product}/model`)
      .set('Host', HOST)
      .set('Cookie', cookie)
      .set(CSRF)
      .expect(200);
    expect((await menuProduct()).model).toBeNull();
    await http.get(`/api/v1/store/models/${product}/modelo.glb`).set('Host', HOST).expect(404);
  });
});
