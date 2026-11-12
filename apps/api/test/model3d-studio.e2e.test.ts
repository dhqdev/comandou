import 'reflect-metadata';
import { NodeIO } from '@gltf-transform/core';
import type { INestApplication } from '@nestjs/common';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { Model3dService } from '../src/model3d/model3d.service';
import { readModel } from '../src/model3d/optimize';
import { MeshyProvider } from '../src/model3d/providers';
import { testEnv } from './env';
import { PASSWORD, seedTwoTenants } from './fixtures';
import { sphereDoc } from './model3d-helpers';

/**
 * Estúdio 3D: o servidor cria o 3D a partir das fotos (gerador falso no lugar da IA) e otimiza o
 * arquivo escaneado, publica no cardápio, respeita o limite do mês e o isolamento.
 */
const HOST = 'estudio-a.comandou.test';
const OTHER = 'estudio-b.comandou.test';
const CSRF = { 'X-Comandou-Request': '1' };

let app: INestApplication;
let http: ReturnType<typeof request>;
let studio: Model3dService;
let cookie = '';
let product = '';
let generator: Server;
const received: { images: { type: string; data: string }[]; auth?: string }[] = [];
let failNext = false;

const io = new NodeIO();
/** O que a "IA" devolve: um objeto de 2 m (escala típica de gerador), fora do centro. */
const aiGlb = async () =>
  Buffer.from(await io.writeBinary(await sphereDoc({ rings: 20, segs: 40, r: 1, texture: 256 })));

const auth = (r: request.Test, host = HOST, c = cookie) =>
  r.set('Host', host).set('Cookie', c).set(CSRF);
const info = async () =>
  (await auth(http.get(`/api/v1/products/${product}/model`)).expect(200)).body;
const photo = async () => {
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#c86' },
  })
    .png()
    .toBuffer();
  const r = await auth(http.post('/api/v1/media'))
    .set('Content-Type', 'image/png')
    .send(png)
    .expect(201);
  return r.body.id as string;
};

beforeAll(async () => {
  generator = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      if (req.url !== '/generate') return res.writeHead(404).end();
      received.push({ ...JSON.parse(body), auth: req.headers.authorization });
      if (failNext) {
        failNext = false;
        res.writeHead(422, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ message: 'Não achei o prato na foto' }));
      }
      res.writeHead(200, { 'Content-Type': 'model/gltf-binary' }).end(await aiGlb());
    });
  });
  await new Promise<void>((r) => generator.listen(0, '127.0.0.1', r));
  const port = (generator.address() as AddressInfo).port;

  await seedTwoTenants('estudio');
  app = await createApp(
    testEnv({
      AUTH_LOGIN_RATE_LIMIT: '1000',
      MODEL3D_LOCAL_URL: `http://127.0.0.1:${port}`,
      MODEL3D_LOCAL_TOKEN: 'token-do-gerador-local-123',
      MODEL3D_MONTHLY_GENERATIONS: '2',
    }),
    { logger: false },
  );
  await app.init();
  studio = app.get(Model3dService);
  http = request(app.getHttpServer());
  const res = await http
    .post('/api/v1/auth/login')
    .set('Host', HOST)
    .set(CSRF)
    .send({ email: 'admin@estudio-a.test', password: PASSWORD });
  cookie = (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('cm_sid='))!
    .split(';')[0]!;
  await auth(http.patch('/api/v1/store/settings'))
    .send({ enabled: true, isOpen: true })
    .expect(200);
  const cat = await auth(http.post('/api/v1/categories')).send({ name: 'Pratos' }).expect(201);
  const p = await auth(http.post('/api/v1/products'))
    .send({ categoryId: cat.body.id, name: 'Risoto', price: '48.00' })
    .expect(201);
  product = p.body.id;
});

afterAll(async () => {
  await app?.close();
  generator?.close();
});

describe('estúdio 3D', () => {
  it('mostra o que o servidor sabe fazer e o limite do mês', async () => {
    const i = await info();
    expect(i.job).toBeNull();
    expect(i.studio).toEqual({
      optimize: true,
      generate: true,
      provider: 'local',
      used: 0,
      limit: 2,
    });
    // Foto que não existe (ou de outro restaurante) não cria trabalho nem gasta o limite.
    await auth(http.post(`/api/v1/products/${product}/model/generate`))
      .send({ mediaIds: ['00000000-0000-4000-8000-000000000000'] })
      .expect(404);
    expect((await info()).job).toBeNull();
  });

  it('cria o 3D a partir das fotos, otimizado e no tamanho pedido', async () => {
    const [a, b] = [await photo(), await photo()];
    const job = await auth(http.post(`/api/v1/products/${product}/model/generate`))
      .send({ mediaIds: [a, b], sizeCm: 28 })
      .expect(202);
    expect(job.body).toMatchObject({ kind: 'generate', status: 'queued' });
    await studio.idle();

    expect(received).toHaveLength(1);
    expect(received[0]!.images).toHaveLength(2);
    expect(received[0]!.images[0]!.type).toBe('image/png');
    expect(received[0]!.auth).toBe('Bearer token-do-gerador-local-123');

    const i = await info();
    expect(i.job).toMatchObject({ status: 'done', progress: 100, provider: 'local', error: null });
    expect(Math.max(...i.job.stats.sizeCm)).toBeCloseTo(28, 0);
    expect(i.glb.size).toBeGreaterThan(0);
    expect(i.studio.used).toBe(1);

    const file = await http
      .get(i.glb.url)
      .set('Host', HOST)
      .buffer(true)
      .parse((res, done) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => done(null, Buffer.concat(parts)));
      })
      .expect(200);
    const out = await readModel(new Uint8Array(file.body as Buffer));
    expect(
      out
        .getRoot()
        .listExtensionsUsed()
        .map((e) => e.extensionName),
    ).toContain('KHR_draco_mesh_compression');
  });

  it('falha do gerador aparece com a mensagem e não gasta o limite', async () => {
    failNext = true;
    const m = await photo();
    await auth(http.post(`/api/v1/products/${product}/model/generate`))
      .send({ mediaIds: [m] })
      .expect(202);
    await studio.idle();
    const i = await info();
    expect(i.job).toMatchObject({ status: 'failed', error: 'Não achei o prato na foto' });
    expect(i.studio.used).toBe(1);
    expect(i.glb).not.toBeNull(); // o modelo anterior continua no cardápio
  });

  it('respeita o limite de criações por foto no mês', async () => {
    const [a, b] = [await photo(), await photo()];
    await auth(http.post(`/api/v1/products/${product}/model/generate`))
      .send({ mediaIds: [a] })
      .expect(202);
    await studio.idle();
    const r = await auth(http.post(`/api/v1/products/${product}/model/generate`))
      .send({ mediaIds: [b] })
      .expect(422);
    expect(r.body.message).toMatch(/limite/);
  });

  it('otimiza o arquivo escaneado enviado (GLB ou .zip)', async () => {
    // Escaneamento pesado: 160 mil triângulos, 22 cm, em metros como sai do aplicativo.
    const raw = Buffer.from(
      await io.writeBinary(await sphereDoc({ rings: 200, segs: 400, r: 0.11 })),
    );
    await auth(http.put(`/api/v1/products/${product}/model/source`))
      .set('Content-Type', 'application/vnd.comandou.model-source')
      .send(raw)
      .expect(202);
    await studio.idle();
    const i = await info();
    expect(i.job).toMatchObject({ kind: 'optimize', status: 'done', provider: 'studio' });
    expect(i.glb.size).toBeLessThan(raw.length / 3);
    expect(i.job.stats.trianglesAfter).toBeLessThanOrEqual(120_000);
    expect(Math.max(...i.job.stats.sizeCm)).toBeCloseTo(22, 0); // escala real do escaneamento
  });

  it('recusa arquivo que não é modelo', async () => {
    await auth(http.put(`/api/v1/products/${product}/model/source`))
      .set('Content-Type', 'application/vnd.comandou.model-source')
      .send(Buffer.from('isto não é um modelo'))
      .expect(422);
  });

  it('outro restaurante não vê nem cria modelo neste item', async () => {
    const other = await http
      .post('/api/v1/auth/login')
      .set('Host', OTHER)
      .set(CSRF)
      .send({ email: 'admin@estudio-b.test', password: PASSWORD });
    const theirs = (other.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('cm_sid='))!
      .split(';')[0]!;
    await auth(http.get(`/api/v1/products/${product}/model`), OTHER, theirs).expect(200, {
      glb: null,
      usdz: null,
      job: null,
      studio: { optimize: true, generate: true, provider: 'local', used: 0, limit: 2 },
    });
    await auth(http.put(`/api/v1/products/${product}/model/source`), OTHER, theirs)
      .set('Content-Type', 'application/vnd.comandou.model-source')
      .send(await aiGlb())
      .expect(404);
  });
});

describe('Meshy (serviço de mercado)', () => {
  it('manda a foto, acompanha o progresso e baixa o GLB', async () => {
    const calls: string[] = [];
    let polls = 0;
    const glb = await aiGlb();
    const fake = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        calls.push(`${req.method} ${req.url} ${req.headers.authorization}`);
        if (req.method === 'POST' && req.url === '/openapi/v1/image-to-3d') {
          expect(JSON.parse(body).image_url).toMatch(/^data:image\/png;base64,/);
          return res.end(JSON.stringify({ result: 'tarefa-1' }));
        }
        if (req.url === '/openapi/v1/image-to-3d/tarefa-1') {
          polls++;
          const port = (fake.address() as AddressInfo).port;
          return res.end(
            JSON.stringify(
              polls < 2
                ? { status: 'IN_PROGRESS', progress: 50 }
                : {
                    status: 'SUCCEEDED',
                    progress: 100,
                    model_urls: { glb: `http://127.0.0.1:${port}/arquivo.glb` },
                  },
            ),
          );
        }
        if (req.url === '/arquivo.glb') return res.end(glb);
        res.writeHead(404).end('{}');
      });
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
    const port = (fake.address() as AddressInfo).port;
    const seen: number[] = [];
    try {
      const meshy = new MeshyProvider('chave-de-teste', `http://127.0.0.1:${port}`, 10);
      const r = await meshy.generate([{ type: 'image/png', bytes: Buffer.from('foto') }], (p) => {
        seen.push(p);
      });
      expect(r.glb.equals(glb)).toBe(true);
      expect(calls[0]).toBe('POST /openapi/v1/image-to-3d Bearer chave-de-teste');
      expect(seen).toContain(43); // 5 + 50% de 75
      expect(seen.at(-1)).toBe(85);
    } finally {
      fake.close();
    }
  });
});
