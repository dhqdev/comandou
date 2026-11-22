import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { test } from 'node:test';
import { PrintAgent, makeConnectionCode, parseConnectionCode } from './core.mjs';
import {
  describePrinter,
  installedTwinOf,
  parseSpoolList,
  parseTcp,
  printText,
  spoolStatus,
  targetEnvName,
} from './printers.mjs';
import { documentHtml } from './desktop/pure.mjs';

const TOKEN = 'pma_' + 'a'.repeat(43);

test('código de conexão: ida e volta, e também pelo link do aplicativo', () => {
  const code = makeConnectionCode('https://burguer.comandou.com', TOKEN, 'PC do caixa');
  assert.ok(code.startsWith('CMD1-'));
  assert.deepEqual(parseConnectionCode(`  ${code}\n`), {
    url: 'https://burguer.comandou.com',
    token: TOKEN,
    name: 'PC do caixa',
  });
  const link = `comandou-impressao://conectar?codigo=${encodeURIComponent(code)}`;
  assert.equal(parseConnectionCode(link).token, TOKEN);
});

test('código de conexão: recusa lixo e endereços estranhos', () => {
  assert.throws(() => parseConnectionCode('pma_xxx'), /inválido/);
  assert.throws(() => parseConnectionCode('CMD1-@@@'), /incompleto|inválido/);
  assert.throws(
    () => parseConnectionCode(makeConnectionCode('javascript:alert(1)', TOKEN)),
    /inválido/,
  );
  assert.throws(
    () => parseConnectionCode(makeConnectionCode('https://a.com/x', 'pma_curto')),
    /inválido/,
  );
});

test('impressoras: nomes de destino, endereços de rede e rótulos', () => {
  assert.equal(targetEnvName('Chapa quente'), 'PRINTER_CHAPA_QUENTE');
  assert.equal(targetEnvName('Pâtisserie/Bar'), 'PRINTER_PATISSERIE_BAR');
  assert.deepEqual(parseTcp('tcp://192.168.0.50'), { host: '192.168.0.50', port: 9100 });
  assert.deepEqual(parseTcp('tcp://impressora.local:9101'), {
    host: 'impressora.local',
    port: 9101,
  });
  assert.equal(parseTcp('tcp://1.2.3.4:99999'), null);
  assert.equal(parseTcp('tcp://a b'), null);
  assert.equal(describePrinter('printer:ELGIN i9'), 'ELGIN i9');
  assert.equal(describePrinter(''), 'Não imprimir');
});

test('impressora de rede recebe ESC/POS pela porta 9100', async () => {
  const chunks = [];
  const srv = net.createServer((s) => s.on('data', (d) => chunks.push(d)));
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  await printText(`tcp://127.0.0.1:${srv.address().port}`, 'Pedido #7');
  await new Promise((r) => setTimeout(r, 50));
  srv.close();
  const data = Buffer.concat(chunks);
  assert.deepEqual([...data.subarray(0, 2)], [0x1b, 0x40]);
  assert.ok(data.includes(Buffer.from('Pedido #7')));
});

test('agente: conecta, imprime no destino certo e confirma', async () => {
  const calls = [];
  let served = false;
  const srv = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/heartbeat'))
      return res.end(JSON.stringify({ restaurant: 'Burguer', agent: 'PC', targets: ['Bar'] }));
    if (req.url.endsWith('/claim')) {
      const jobs = served
        ? []
        : [{ id: 'j1', kind: 'kitchen_ticket', target: 'Bar', payload: 'X', attempts: 1 }];
      served = true;
      return res.end(JSON.stringify({ jobs }));
    }
    res.end(JSON.stringify({ id: 'j1', status: 'done' }));
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');

  const printed = [];
  const agent = new PrintAgent({
    url: `http://127.0.0.1:${srv.address().port}/`,
    token: TOKEN,
    version: 't',
    pollMs: 1000,
    printerFor: (t) => (t === 'Bar' ? 'tcp://bar:9100' : 'none'),
    print: async (spec, text) => printed.push([spec, text]),
  });
  const statuses = [];
  agent.on('status', (s) => statuses.push(s));
  const job = once(agent, 'job');
  agent.start();
  const [ev] = await job;
  await new Promise((r) => setTimeout(r, 50));
  agent.stop();
  srv.close();

  assert.equal(ev.ok, true);
  assert.deepEqual(printed, [['tcp://bar:9100', 'X']]);
  assert.ok(statuses.some((s) => s.state === 'online' && s.restaurant === 'Burguer'));
  assert.deepEqual(statuses.at(-1).targets, ['Bar']);
  assert.equal(calls[0].auth, `Bearer ${TOKEN}`);
  assert.deepEqual(
    calls.find((c) => c.url.endsWith('/result')),
    { url: '/api/v1/print-agent/jobs/j1/result', auth: `Bearer ${TOKEN}`, body: { ok: true } },
  );
});

test('agente: token recusado para o laço e avisa', async () => {
  const srv = http.createServer((_req, res) => {
    res.statusCode = 401;
    res.end('{"message":"Token de agente inválido"}');
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const agent = new PrintAgent({
    url: `http://127.0.0.1:${srv.address().port}`,
    token: TOKEN,
    version: 't',
    printerFor: () => 'none',
    print: async () => undefined,
  });
  const done = new Promise((r) => agent.on('status', (s) => s.state === 'unauthorized' && r(s)));
  agent.start();
  await done;
  srv.close();
  assert.equal(agent.running, false);
});

/** Servidor falso do Comandou para os testes do laço: `jobs` sai uma vez em cada /claim. */
async function fakeComandou({ jobs = [], heartbeat = {}, result = () => ({ status: 'done' }) }) {
  const calls = [];
  const queue = [...jobs];
  const srv = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const b = JSON.parse(body || '{}');
    calls.push({ url: req.url, body: b });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/heartbeat'))
      return res.end(
        JSON.stringify({
          restaurant: 'R',
          agent: 'PC',
          targets: [],
          ...(typeof heartbeat === 'function' ? heartbeat(b) : heartbeat),
        }),
      );
    if (req.url.endsWith('/claim'))
      return res.end(JSON.stringify({ jobs: queue.splice(0, b.limit) }));
    const r = result(req.url, b);
    res.statusCode = r.statusCode ?? 200;
    res.end(JSON.stringify(r));
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  return { calls, srv, url: `http://127.0.0.1:${srv.address().port}` };
}

const job = (id) => ({ id, kind: 'kitchen_ticket', target: 'Cozinha', payload: id, attempts: 1 });

test('agente: pega um trabalho por vez e manda o nome da impressora', async () => {
  const f = await fakeComandou({ jobs: [job('a'), job('b')] });
  const agent = new PrintAgent({
    url: f.url,
    token: TOKEN,
    version: 't',
    printerFor: () => 'printer:EPSON',
    label: () => 'EPSON L4260',
    print: async () => undefined,
  });
  const seen = [];
  const both = new Promise((r) => agent.on('job', (j) => seen.push(j) === 2 && r()));
  agent.start();
  await both;
  agent.stop();
  f.srv.close();
  const claims = f.calls.filter((c) => c.url.endsWith('/claim'));
  assert.ok(claims.every((c) => c.body.limit === 1));
  assert.deepEqual(
    f.calls.filter((c) => c.url.endsWith('/result')).map((c) => c.body),
    [
      { ok: true, printer: 'EPSON L4260' },
      { ok: true, printer: 'EPSON L4260' },
    ],
  );
});

test('agente: falha depois de mandar (ou demora demais) vai como "sent", sem nova tentativa', async () => {
  const f = await fakeComandou({ jobs: [job('a'), job('b')] });
  let n = 0;
  const agent = new PrintAgent({
    url: f.url,
    token: TOKEN,
    version: 't',
    printTimeout: 100,
    printerFor: () => 'printer:EPSON',
    print: async () => {
      if (++n === 1) throw Object.assign(new Error('A impressora não confirmou'), { sent: true });
      await new Promise(() => undefined); // trava, como o driver às vezes trava
    },
  });
  const seen = [];
  const both = new Promise((r) => agent.on('job', (j) => seen.push(j) === 2 && r()));
  agent.start();
  await both;
  agent.stop();
  f.srv.close();
  const results = f.calls.filter((c) => c.url.endsWith('/result')).map((c) => c.body);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ok === false && r.sent === true));
  assert.match(results[1].error, /demorou/);
});

test('agente: falha antes de mandar não leva "sent" (o Comandou tenta de novo depois)', async () => {
  const f = await fakeComandou({ jobs: [job('a')] });
  const agent = new PrintAgent({
    url: f.url,
    token: TOKEN,
    version: 't',
    printerFor: () => 'tcp://10.0.0.9:9100',
    print: async () => {
      throw new Error('Impressora fora do ar');
    },
  });
  const ev = once(agent, 'job');
  agent.start();
  await ev;
  agent.stop();
  f.srv.close();
  const r = f.calls.find((c) => c.url.endsWith('/result')).body;
  assert.deepEqual(r, { ok: false, error: 'Impressora fora do ar' });
});

test('agente: trabalho tirado da fila enquanto imprimia (409) não vira falha', async () => {
  const f = await fakeComandou({
    jobs: [job('a')],
    result: () => ({ statusCode: 409, message: 'Trabalho não está reservado para este agente' }),
  });
  const agent = new PrintAgent({
    url: f.url,
    token: TOKEN,
    version: 't',
    printerFor: () => 'printer:X',
    print: async () => undefined,
  });
  const states = [];
  agent.on('status', (s) => states.push(s.state));
  const ev = once(agent, 'job');
  agent.start();
  const [j] = await ev;
  await new Promise((r) => setTimeout(r, 50));
  agent.stop();
  f.srv.close();
  assert.equal(j.cancelled, true);
  assert.ok(!states.includes('offline'));
});

test('agente: limpa a fila do sistema e tira impressoras a pedido do painel, e confirma', async () => {
  let beats = 0;
  const f = await fakeComandou({
    heartbeat: () =>
      ++beats === 1 ? { purge: '2026-11-20T18:00:00.000Z', remove: ['Caixa', null] } : {},
  });
  let purged = 0;
  const removed = [];
  const agent = new PrintAgent({
    url: f.url,
    token: TOKEN,
    version: 't',
    pollMs: 1000,
    printerFor: () => 'none',
    print: async () => undefined,
    purge: async () => purged++,
    removePrinters: async (t) => removed.push(...t),
  });
  agent.start();
  for (let i = 0; i < 50 && beats < 2; i++) await new Promise((r) => setTimeout(r, 50));
  agent.stop();
  f.srv.close();
  assert.equal(purged, 1);
  assert.deepEqual(removed, ['Caixa', null]);
  const hb = f.calls.filter((c) => c.url.endsWith('/heartbeat'));
  assert.equal(hb[1].body.purgedAt, '2026-11-20T18:00:00.000Z');
  assert.deepEqual(hb[1].body.removed, ['Caixa', null]);
});

test('jato de tinta escolhida como térmica pela rede é achada pelo fim do MAC', () => {
  const installed = [
    { name: 'Microsoft Print to PDF', driver: 'Microsoft Print To PDF' },
    { name: 'EPSON17C57B (L4260 Series)', driver: 'Microsoft IPP Class Driver' },
  ];
  assert.equal(
    installedTwinOf('tcp://192.168.0.10:9100?mac=E0-BB-9E-17-C5-7B', installed),
    'EPSON17C57B (L4260 Series)',
  );
  assert.equal(installedTwinOf('tcp://192.168.0.10:9100', installed), null);
  assert.equal(installedTwinOf('tcp://192.168.0.20:9100?mac=00-11-22-33-44-55', installed), null);
  // Térmica instalada com o MAC no nome continua na porta 9100.
  assert.equal(
    installedTwinOf('tcp://192.168.0.30:9100?mac=00-11-22-AA-BB-CC', [
      { name: 'POS-80 AABBCC', driver: '' },
    ]),
    null,
  );
});

test('impressora de rede que aceita e não responde: erro diz que pode ter saído', async () => {
  // Servidor que conecta e falha depois (como a jato de tinta na porta 9100).
  const srv = net.createServer((s) => s.destroy());
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const err = await printText(`tcp://127.0.0.1:${srv.address().port}`, 'X'.repeat(200_000)).then(
    () => null,
    (e) => e,
  );
  srv.close();
  if (err) assert.equal(err.sent, true);
});

test('agente: fila do Windows vai ao Comandou e o impresso pela fila sai como enviado', async () => {
  const calls = [];
  let served = false;
  const srv = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    calls.push({ url: req.url, body: JSON.parse(body || '{}') });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/heartbeat'))
      return res.end(JSON.stringify({ restaurant: 'B', agent: 'PC', maxAgeMinutes: 15 }));
    if (req.url.endsWith('/claim')) {
      const jobs = served
        ? []
        : [{ id: 'j9', kind: 'kitchen_ticket', target: 'Cozinha', payload: 'X', attempts: 1 }];
      served = true;
      return res.end(JSON.stringify({ jobs }));
    }
    res.end('{}');
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const docs = [];
  const ages = [];
  const agent = new PrintAgent({
    url: `http://127.0.0.1:${srv.address().port}`,
    token: TOKEN,
    version: 't',
    pollMs: 1000,
    printerFor: () => 'printer:EPSON',
    print: async (_spec, _text, meta) => {
      docs.push(meta.doc);
      return { spooled: true };
    },
    hold: () => ({ mainOn: true, on: [], off: ['Bar'] }),
    spool: async (maxAge) => {
      ages.push(maxAge);
      return {
        jobs: [{ printer: 'EPSON', name: 'Relatorio.pdf', status: 'Na fila', ours: false }],
        removed: [],
      };
    },
  });
  const job = once(agent, 'job');
  agent.start();
  await job;
  await new Promise((r) => setTimeout(r, 50));
  agent.stop();
  srv.close();
  assert.equal(ages[0], 15);
  assert.match(docs[0], /^Comandou - Comanda Cozinha - j9$/);
  const spoolCalls = calls.filter((c) => c.url.endsWith('/spool'));
  assert.equal(spoolCalls.length, 1);
  assert.equal(spoolCalls[0].body.jobs[0].name, 'Relatorio.pdf');
  assert.deepEqual(calls.find((c) => c.url.endsWith('/claim')).body.hold, {
    mainOn: true,
    on: [],
    off: ['Bar'],
  });
  assert.deepEqual(calls.find((c) => c.url.endsWith('/result')).body, { ok: true, spooled: true });
});

test('agente: principal desligada e nenhum setor ligado, não pega trabalhos', async () => {
  const urls = [];
  const srv = http.createServer(async (req, res) => {
    for await (const _ of req);
    urls.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    res.end(req.url.endsWith('/heartbeat') ? '{"restaurant":"B"}' : '{"jobs":[]}');
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const agent = new PrintAgent({
    url: `http://127.0.0.1:${srv.address().port}`,
    token: TOKEN,
    version: 't',
    printerFor: () => 'printer:EPSON',
    print: async () => undefined,
    hold: () => ({ mainOn: false, on: [], off: [] }),
  });
  const online = new Promise((r) => agent.on('status', (s) => s.state === 'online' && r()));
  agent.start();
  await online;
  await new Promise((r) => setTimeout(r, 50));
  agent.stop();
  srv.close();
  assert.ok(urls.some((u) => u.endsWith('/heartbeat')));
  assert.ok(!urls.some((u) => u.endsWith('/claim')));
});

test('fila do Windows: lê a saída do PowerShell e acha a comanda pelo nome', () => {
  const id = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
  const one = parseSpoolList(
    JSON.stringify({
      printer: 'EPSON',
      id: 7,
      name: `Comandou - Comanda Cozinha - ${id}`,
      status: 'Offline, Printing',
      at: '2026-11-22T19:00:00.1234567Z',
      pages: 1,
    }),
  );
  assert.equal(one.length, 1);
  assert.equal(one[0].jobId, id);
  assert.equal(one[0].ours, true);
  assert.equal(one[0].status, 'Impressora desligada');
  assert.equal(one[0].at, '2026-11-22T19:00:00.123Z');
  const other = parseSpoolList(
    '[{"printer":"EPSON","id":8,"name":"Relatorio.pdf","status":"Normal"}]',
  );
  assert.deepEqual(
    { ours: other[0].ours, jobId: other[0].jobId, status: other[0].status },
    { ours: false, jobId: null, status: 'Na fila' },
  );
  assert.deepEqual(parseSpoolList(''), []);
  assert.deepEqual(parseSpoolList('lixo'), []);
  assert.equal(spoolStatus('PaperOut'), 'Sem papel');
  assert.equal(spoolStatus('Error, Printing'), 'Com erro');
});

test('folha: o nome do documento vai no título, escapado', () => {
  assert.match(
    documentHtml('x', { title: 'Comandou - <Teste>' }),
    /<title>Comandou - &lt;Teste&gt;<\/title>/,
  );
  assert.match(documentHtml('x'), /<title>Comandou<\/title>/);
});
