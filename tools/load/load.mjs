#!/usr/bin/env node
// Teste de carga do PedeMais (Node 22, sem dependências).
//
// Simula vários restaurantes ao mesmo tempo, cada um com vários caixas:
//   1. leitura   GET  /api/v1/menu                         (cardápio, a tela mais aberta)
//   2. venda     POST /api/v1/orders + POST .../payments    (pedido de balcão pago no PIX)
//   3. disputa   5 pagamentos simultâneos do saldo inteiro do mesmo pedido → só 1 pode passar
//
// Cada restaurante precisa existir e ter um usuário administrador. Uso:
//   LOAD_TARGET=http://127.0.0.1:3000 LOAD_BASE_DOMAIN=pedemais.localhost \
//   LOAD_TENANTS=load-1,load-2 LOAD_EMAIL='dono@{slug}.local' LOAD_PASSWORD=... \
//   LOAD_CONCURRENCY=8 LOAD_SECONDS=30 node tools/load/load.mjs
//
// A API do ambiente testado precisa de RATE_LIMIT_PER_MINUTE e AUTH_LOGIN_RATE_LIMIT altos,
// porque toda a carga sai de um único IP. NUNCA rode contra produção com dados reais: o teste
// cria pedidos e pagamentos de verdade nos restaurantes informados.
import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const env = process.env;
const TARGET = new URL(env.LOAD_TARGET ?? 'http://127.0.0.1:3000');
const DOMAIN = env.LOAD_BASE_DOMAIN ?? 'pedemais.localhost';
const TENANTS = (env.LOAD_TENANTS ?? '').split(',').filter(Boolean);
const EMAIL = env.LOAD_EMAIL ?? 'dono@{slug}.local';
const PASSWORD = env.LOAD_PASSWORD ?? '';
const CONCURRENCY = Number(env.LOAD_CONCURRENCY ?? 8); // clientes por restaurante
const SECONDS = Number(env.LOAD_SECONDS ?? 30);
const RACES = Number(env.LOAD_RACES ?? 20); // pedidos disputados por restaurante
const OUT = env.LOAD_OUT;

if (!TENANTS.length || !PASSWORD) {
  console.error('defina LOAD_TENANTS e LOAD_PASSWORD (veja o cabeçalho do arquivo)');
  process.exit(2);
}

const lib = TARGET.protocol === 'https:' ? https : http;
const agent = new lib.Agent({ keepAlive: true, maxSockets: 512 });

/** Requisição com o Host do restaurante (o restaurante vem do Host, como em produção). */
function call(slug, method, path, { body, cookie, idem } = {}) {
  const host = `${slug}.${DOMAIN}`;
  const data = body === undefined ? undefined : JSON.stringify(body);
  const headers = { Host: host, 'X-PedeMais-Request': '1', Accept: 'application/json' };
  if (data) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(data);
  }
  if (cookie) headers.Cookie = cookie;
  if (idem) headers['Idempotency-Key'] = idem;
  const started = process.hrtime.bigint();
  return new Promise((resolve) => {
    const req = lib.request(
      {
        agent,
        hostname: TARGET.hostname,
        port: TARGET.port || (TARGET.protocol === 'https:' ? 443 : 80),
        method,
        path: `/api/v1${path}`,
        headers,
        servername: host,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          let json;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString() || 'null');
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json, headers: res.headers, ms });
        });
      },
    );
    req.on('error', (e) => resolve({ status: 0, json: { message: e.message }, ms: 0 }));
    if (data) req.write(data);
    req.end();
  });
}

class Stats {
  constructor() {
    this.ms = [];
    this.status = {};
  }
  add(r) {
    this.ms.push(r.ms);
    this.status[r.status] = (this.status[r.status] ?? 0) + 1;
  }
  summary(seconds) {
    const s = [...this.ms].sort((a, b) => a - b);
    const p = (q) => (s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0);
    return {
      requests: s.length,
      perSecond: +(s.length / seconds).toFixed(1),
      p50: +p(0.5).toFixed(1),
      p95: +p(0.95).toFixed(1),
      p99: +p(0.99).toFixed(1),
      max: +(s[s.length - 1] ?? 0).toFixed(1),
      status: this.status,
    };
  }
}

async function prepare(slug) {
  const login = await call(slug, 'POST', '/auth/login', {
    body: { email: EMAIL.replace('{slug}', slug), password: PASSWORD },
  });
  if (login.status !== 200)
    throw new Error(`${slug}: login ${login.status} ${login.json?.message}`);
  const cookie = []
    .concat(login.headers['set-cookie'] ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
  const ok = (r, what) => {
    if (r.status >= 300) throw new Error(`${slug}: ${what} ${r.status} ${r.json?.message}`);
    return r.json;
  };
  const cat = ok(
    await call(slug, 'POST', '/categories', { cookie, body: { name: 'Carga' } }),
    'categoria',
  );
  const product = ok(
    await call(slug, 'POST', '/products', {
      cookie,
      body: {
        categoryId: cat.id,
        name: `Lanche carga ${randomUUID().slice(0, 6)}`,
        price: '27.90',
      },
    }),
    'produto',
  );
  const register = ok(
    await call(slug, 'POST', '/cash-registers', {
      cookie,
      body: { name: `Carga ${randomUUID().slice(0, 6)}` },
    }),
    'caixa',
  );
  const session = ok(
    await call(slug, 'POST', '/cash/sessions', {
      cookie,
      body: { registerId: register.id, openingAmount: '0.00' },
    }),
    'abertura de caixa',
  );
  return { slug, cookie, productId: product.id, sessionId: session.id };
}

const order = (t, quantity = 1) =>
  call(t.slug, 'POST', '/orders', {
    cookie: t.cookie,
    idem: randomUUID(),
    body: { channel: 'counter', items: [{ productId: t.productId, quantity, optionIds: [] }] },
  });
const pay = (t, o, idem = randomUUID()) =>
  call(t.slug, 'POST', `/orders/${o.id}/payments`, {
    cookie: t.cookie,
    idem,
    body: { cashSessionId: t.sessionId, method: 'pix', amount: o.total },
  });

async function runFor(seconds, worker) {
  const until = Date.now() + seconds * 1000;
  await Promise.all(
    tenants.flatMap((t) =>
      Array.from({ length: CONCURRENCY }, async () => {
        while (Date.now() < until) await worker(t);
      }),
    ),
  );
}

console.log(
  `alvo ${TARGET.origin} · ${TENANTS.length} restaurantes × ${CONCURRENCY} clientes · ${SECONDS}s por cenário`,
);
const tenants = [];
for (const slug of TENANTS) tenants.push(await prepare(slug));

const results = {};

// 1. Leitura do cardápio
const menu = new Stats();
await runFor(SECONDS, async (t) =>
  menu.add(await call(t.slug, 'GET', '/menu', { cookie: t.cookie })),
);
results.menu = menu.summary(SECONDS);

// 2. Venda: pedido + pagamento
const orders = new Stats();
const payments = new Stats();
let paidOk = 0;
await runFor(SECONDS, async (t) => {
  const o = await order(t);
  orders.add(o);
  if (o.status !== 201) return;
  const p = await pay(t, o.json);
  payments.add(p);
  if (p.status === 201) paidOk++;
});
results.orders = orders.summary(SECONDS);
results.payments = payments.summary(SECONDS);

// 3. Disputa: 5 pagamentos simultâneos do saldo inteiro, chaves diferentes → exatamente 1 passa
let races = 0;
let raceViolations = 0;
const race = new Stats();
for (const t of tenants) {
  await Promise.all(
    Array.from({ length: RACES }, async () => {
      const o = await order(t);
      if (o.status !== 201) return;
      const rs = await Promise.all(Array.from({ length: 5 }, () => pay(t, o.json)));
      rs.forEach((r) => race.add(r));
      races++;
      if (rs.filter((r) => r.status === 201).length !== 1) raceViolations++;
    }),
  );
}
results.race = { orders: races, violations: raceViolations, ...race.summary(1) };
delete results.race.perSecond;

// 4. Isolamento: o cookie de um restaurante não abre outro (sob carga, depois de tudo)
if (tenants.length > 1) {
  const r = await call(tenants[1].slug, 'GET', '/menu', { cookie: tenants[0].cookie });
  results.isolation = { crossTenantStatus: r.status, ok: r.status === 401 };
}

results.config = {
  target: TARGET.origin,
  tenants: TENANTS.length,
  concurrency: CONCURRENCY,
  seconds: SECONDS,
  paidOk,
};
console.log(JSON.stringify(results, null, 2));
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
agent.destroy();
const failed = raceViolations > 0 || (results.isolation && !results.isolation.ok);
process.exit(failed ? 1 : 0);
