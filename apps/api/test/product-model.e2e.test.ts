import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** Menor JPEG que o servidor lê: cabeçalho, um bloco APP0 e o quadro (SOF) de 1024 × 768. */
/** Foto do site (WebP) regravada em JPEG, como a tela manda. */
async function realJpeg(name: string) {
  const { decodeImage } = await import('../src/store/media-thumbs');
  const webp = readFileSync(join(__dirname, '..', '..', 'web', 'public', 'site', 'food', name));
  const img = await decodeImage('image/webp', webp);
  const enc = await import('@jsquash/jpeg/encode.js');
  await enc.init(
    new WebAssembly.Module(
      readFileSync(require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')),
    ) as never,
  );
  const out = await enc.default(
    {
      data: new Uint8ClampedArray(img.data),
      width: img.width,
      height: img.height,
      colorSpace: 'srgb',
    } as ImageData,
    { quality: 85 },
  );
  return Buffer.from(out);
}

function jpeg() {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x00, 0x04, 0x00, 0x03, 0x01, 0x22, 0x00];
  return Buffer.from([0xff, 0xd8, ...app0, ...sof, ...Array(16).fill(0), 0xff, 0xd9]);
}

describe('3D pela foto do item', () => {
  const forma = encodeURIComponent(
    JSON.stringify({
      kind: 'plate',
      view: 'angle',
      box: { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.85 },
      diameterCm: 24,
      heightCm: 3,
      foodHeightCm: 4,
    }),
  );
  const generate = (q: string, type: string, body: Buffer, host = HOST, who = cookie) =>
    http
      .post(`/api/v1/products/${product}/model/generate${q}`)
      .set('Host', host)
      .set('Cookie', who)
      .set(CSRF)
      .set('Content-Type', type)
      .send(body);

  it('diz se a IA das fotos e do 3D pode ser usada', async () => {
    const res = await http
      .get('/api/v1/catalog-ai')
      .set('Host', HOST)
      .set('Cookie', cookie)
      .set(CSRF)
      .expect(200);
    expect(typeof res.body.photo).toBe('boolean');
    expect(typeof res.body.model3d).toBe('boolean');
  });

  it('com a forma escolhida, monta o GLB com a foto sem usar a IA', async () => {
    const res = await generate(`?forma=${forma}`, 'image/jpeg', jpeg()).expect(200);
    expect(res.body.byAi).toBe(false);
    expect(res.body.shape).toMatchObject({ kind: 'plate', diameterCm: 24 });
    expect(res.body.size.widthCm).toBeCloseTo(24, 1);
    const file = Buffer.from(res.body.glb as string, 'base64');
    expect(file.toString('latin1', 0, 4)).toBe('glTF');
    expect(file.length).toBe(res.body.bytes);
    // Publicar é o envio de sempre: o cardápio passa a ter o modelo.
    await put('glb', 'model/gltf-binary', file).expect(200);
    expect((await menuProduct()).model!.glb).toContain('modelo.glb');
  });

  it('foto de verdade: o lanche é recortado e o 3D segue a silhueta, sem o fundo', async () => {
    const photo = await realJpeg('burger-crispy.webp');
    const stack = encodeURIComponent(
      JSON.stringify({
        kind: 'stack',
        view: 'side',
        box: { x0: 0.1, y0: 0.08, x1: 0.9, y1: 0.85 },
        diameterCm: 12,
        heightCm: 10,
      }),
    );
    const res = await generate(`?forma=${stack}`, 'image/jpeg', photo).expect(200);
    expect(res.body.cutout).toBe(true);
    expect(res.body.size).toMatchObject({ widthCm: 12, heightCm: 10 });
    const file = Buffer.from(res.body.glb as string, 'base64');
    expect(file.toString('latin1', 0, 4)).toBe('glTF');
    // Foto que não abre (só o cabeçalho): monta como antes, pela caixa.
    expect((await generate(`?forma=${forma}`, 'image/jpeg', jpeg()).expect(200)).body.cutout).toBe(
      false,
    );
  }, 60_000);

  it('recusa foto que não serve de textura, forma estragada e produto de outro restaurante', async () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    await generate(`?forma=${forma}`, 'image/webp', webp).expect(422);
    await generate(`?forma=${forma}`, 'image/png', jpeg()).expect(422);
    await generate('?forma=%7Boops', 'image/jpeg', jpeg()).expect(422);
    const other = await http
      .post('/api/v1/auth/login')
      .set('Host', OTHER)
      .set(CSRF)
      .send({ email: 'admin@modelo-b.test', password: PASSWORD });
    const theirs = (other.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('cm_sid='))!
      .split(';')[0]!;
    await generate(`?forma=${forma}`, 'image/jpeg', jpeg(), OTHER, theirs).expect(404);
  });
});
