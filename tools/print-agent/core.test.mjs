import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { test } from 'node:test';
import { PrintAgent, makeConnectionCode, parseConnectionCode } from './core.mjs';
import { describePrinter, parseTcp, printText, targetEnvName } from './printers.mjs';

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
