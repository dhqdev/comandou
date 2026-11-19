import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { test } from 'node:test';
import {
  looksLikePrinter,
  parseBluetoothctl,
  parseRfcomm,
  windowsPairedWithoutPort,
} from './bluetooth.mjs';
import {
  localSubnets,
  parseArp,
  parseStatus,
  printResilient,
  statusText,
  subnetHosts,
  tcpStatus,
} from './devices.mjs';
import { buildQuery, collectPrinters, parseResponse } from './mdns.mjs';
import { normalizeMac, parseSpec, registerTransport, printText, withOptions } from './printers.mjs';
import { cupsCandidates, queueName, validCupsUri, windowsCandidates } from './usb.mjs';

// ------------------------------------------------------------------ mDNS
const label = (s) => Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s)]);
const name = (...parts) => Buffer.concat([...parts.map(label), Buffer.from([0])]);
function rr(nameBuf, type, data) {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(0x8001, 2);
  head.writeUInt32BE(120, 4);
  head.writeUInt16BE(data.length, 8);
  return Buffer.concat([nameBuf, head, data]);
}

test('mDNS: pergunta PTR com bit QU para cada serviço de impressora', () => {
  const q = buildQuery(['_pdl-datastream._tcp.local']);
  assert.equal(q.readUInt16BE(4), 1);
  assert.ok(q.includes(Buffer.from('_pdl-datastream')));
  assert.equal(q.readUInt16BE(q.length - 2), 0x8001);
});

test('mDNS: resposta com PTR, SRV, TXT e A vira impressora com nome e modelo', () => {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(1, 6); // 1 resposta
  header.writeUInt16BE(3, 10); // 3 adicionais
  const service = name('_pdl-datastream', '_tcp', 'local');
  // Posição do nome do serviço no pacote (logo depois do cabeçalho): usado como ponteiro.
  const ptrTo = (off) => Buffer.from([0xc0 | (off >> 8), off & 0xff]);
  const instance = Buffer.concat([label('Cozinha'), ptrTo(12)]);
  const srvData = Buffer.concat([Buffer.from([0, 0, 0, 0, 0x23, 0x8c]), name('elgin-i9', 'local')]);
  const txt = Buffer.concat([label('usb_MFG=ELGIN'), label('usb_MDL=i9')]);
  const pkt = Buffer.concat([
    header,
    rr(service, 12, instance),
    rr(Buffer.concat([label('Cozinha'), ptrTo(12)]), 33, srvData),
    rr(Buffer.concat([label('Cozinha'), ptrTo(12)]), 16, txt),
    rr(name('elgin-i9', 'local'), 1, Buffer.from([192, 168, 0, 77])),
  ]);
  const recs = parseResponse(pkt);
  assert.equal(recs.length, 4);
  assert.deepEqual(collectPrinters(recs, '192.168.0.99'), [
    { host: '192.168.0.77', port: 9100, name: 'Cozinha (ELGIN i9)', service: 'pdl-datastream' },
  ]);
});

test('mDNS: pacote quebrado ou com laço de ponteiros não derruba', () => {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 6);
  const loop = Buffer.concat([header, Buffer.from([0xc0, 12, 0, 12, 0, 1])]);
  assert.deepEqual(parseResponse(loop), []);
  assert.deepEqual(parseResponse(Buffer.from([1, 2, 3])), []);
});

// ------------------------------------------------------------------ rede
test('redes: /22 entra inteira, /16 fica na /24 do próprio IP', () => {
  const nets = localSubnets({
    eth0: [{ family: 'IPv4', address: '10.0.5.20', netmask: '255.255.252.0', internal: false }],
    wlan0: [{ family: 'IPv4', address: '172.16.9.3', netmask: '255.255.0.0', internal: false }],
  });
  const hosts = subnetHosts(nets);
  assert.ok(hosts.includes('10.0.4.1'));
  assert.ok(hosts.includes('10.0.7.254'));
  assert.ok(!hosts.includes('10.0.5.20'));
  assert.ok(hosts.includes('172.16.9.200'));
  assert.ok(!hosts.includes('172.16.10.1'));
  assert.equal(hosts.length, 1021 + 253);
});

test('ARP: lê Linux, Windows e macOS', () => {
  const linux = `IP address       HW type     Flags       HW address            Mask     Device
192.168.0.50     0x1         0x2         00:11:22:aa:bb:cc     *        eth0
192.168.0.60     0x1         0x0         00:00:00:00:00:00     *        eth0`;
  assert.equal(parseArp(linux).get('192.168.0.50'), '00-11-22-AA-BB-CC');
  assert.ok(!parseArp(linux).has('192.168.0.60'));
  const win = `Interface: 192.168.0.12 --- 0x7
  Endereço IP           Endereço físico       Tipo
  192.168.0.50          00-11-22-aa-bb-cc     dinâmico
  224.0.0.251           01-00-5e-00-00-fb     estático`;
  assert.equal(parseArp(win).get('192.168.0.50'), '00-11-22-AA-BB-CC');
  assert.ok(!parseArp(win).has('224.0.0.251'));
  const mac = '? (192.168.0.50) at 0:11:22:a:b:c on en0 ifscope [ethernet]';
  assert.equal(parseArp(mac).get('192.168.0.50'), '00-11-22-0A-0B-0C');
});

test('MAC no endereço da impressora: ida e volta, só em rede', () => {
  assert.equal(normalizeMac('0:11:22:a:b:c'), '00-11-22-0A-0B-0C');
  assert.equal(normalizeMac('zz'), '');
  const s = withOptions('tcp://1.2.3.4:9100', { paper: 58, mac: '00:11:22:33:44:55' });
  assert.equal(s, 'tcp://1.2.3.4:9100?papel=58&mac=00-11-22-33-44-55');
  assert.equal(parseSpec(s).opts.mac, '00-11-22-33-44-55');
  assert.equal(withOptions('serial:COM5', { mac: '00:11:22:33:44:55' }), 'serial:COM5');
});

test('situação ESC/POS: papel, tampa e resposta que não é de impressora', () => {
  assert.deepEqual(parseStatus([0x16, 0x12, 0x12]), {
    answered: true,
    online: true,
    coverOpen: false,
    paperOut: false,
    paperLow: false,
    error: false,
  });
  const sem = parseStatus([0x1e, 0x32, 0x72]);
  assert.equal(sem.paperOut, true);
  assert.equal(sem.online, false);
  assert.match(statusText({ reachable: true, ...sem }), /Sem papel/);
  assert.match(statusText({ reachable: true, ...parseStatus([0x1e, 0x16, 0x12]) }), /Tampa/);
  assert.equal(parseStatus(Buffer.from('HTTP/1.1')).answered, false);
  assert.match(statusText({ reachable: false }), /Fora do ar/);
});

test('situação ESC/POS pela rede: manda só os pedidos DLE EOT', async () => {
  let got = Buffer.alloc(0);
  const srv = net.createServer((s) =>
    s.on('data', (d) => {
      got = Buffer.concat([got, d]);
      if (got.length >= 9) s.write(Buffer.from([0x16, 0x12, 0x1e]));
    }),
  );
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const st = await tcpStatus('127.0.0.1', srv.address().port, 1500);
  srv.close();
  assert.deepEqual([...got], [0x10, 0x04, 0x01, 0x10, 0x04, 0x02, 0x10, 0x04, 0x04]);
  assert.equal(st.reachable, true);
  assert.equal(st.paperLow, true);
});

test('IP mudou: acha pelo MAC, imprime no novo e avisa a troca', async () => {
  const sent = [];
  // Impressora falsa: o IP antigo está fora do ar, o novo imprime.
  const print = async (spec, text) => {
    if (spec.startsWith('tcp://10.0.0.5:'))
      throw new Error('Impressora 10.0.0.5:9100 fora do ar ou IP errado.');
    sent.push([spec, text]);
  };
  const old = 'tcp://10.0.0.5:9100?papel=58&mac=00-11-22-33-44-55';
  let moved;
  await printResilient(old, 'Pedido', {
    print,
    find: async (mac, p) => (mac === '00-11-22-33-44-55' && p === 9100 ? '10.0.0.9' : null),
    onMoved: (from, to) => (moved = [from, to]),
  });
  const now = 'tcp://10.0.0.9:9100?papel=58&mac=00-11-22-33-44-55';
  assert.deepEqual(sent, [[now, 'Pedido']]);
  assert.deepEqual(moved, [old, now]);
  // Sem MAC: o erro original volta, sem procurar.
  await assert.rejects(
    printResilient('tcp://10.0.0.5:9100', 'x', { print, find: async () => assert.fail() }),
    /fora do ar/,
  );
  // Outro tipo de erro (ex.: sem papel no spooler) também não procura.
  await assert.rejects(
    printResilient(old, 'x', {
      print: async () => {
        throw new Error('Impressora "Caixa" não encontrada');
      },
      find: async () => assert.fail(),
    }),
    /não encontrada/,
  );
});

// ------------------------------------------------------------------ USB sem driver
test('USB no Windows: portas livres, com o nome quando dá para saber', () => {
  assert.deepEqual(windowsCandidates({ free: ['USB001'], devices: ['ELGIN i9'] }), [
    { id: 'USB001', label: 'ELGIN i9', detail: 'Ligada na porta USB001, ainda sem driver' },
  ]);
  const two = windowsCandidates({ free: ['USB002', 'USB001', 'LPT1'], devices: ['A', 'B'] });
  assert.deepEqual(
    two.map((c) => c.label),
    ['Impressora USB (USB001)', 'Impressora USB (USB002)'],
  );
});

test('USB no CUPS: lista as que não têm fila e recusa endereço estranho', () => {
  const backend = `direct usb://EPSON/TM-T20II?serial=X123 "EPSON TM-T20II" "EPSON TM-T20II" "MFG:EPSON;" ""
direct usb://Bematech/MP-4200 "Unknown" "" "" ""
direct usb://Evil/x';rm -rf "Evil" "" "" ""
network socket "Unknown" "AppSocket/HP JetDirect"`;
  const lpstat = 'device for Caixa: usb://Bematech/MP-4200';
  assert.deepEqual(cupsCandidates(backend, lpstat), [
    {
      id: 'usb://EPSON/TM-T20II?serial=X123',
      label: 'EPSON TM-T20II',
      detail: 'Ligada no cabo USB, ainda sem fila no sistema',
    },
  ]);
  assert.ok(!validCupsUri("usb://a/b';reboot"));
  assert.equal(queueName('Térmica da Cozinha!'), 'Comandou_Termica_da_Cozinha');
});

// ------------------------------------------------------------------ Bluetooth
test('Bluetooth: pareadas sem porta, só as que parecem impressora', () => {
  const list = windowsPairedWithoutPort([
    { mac: 'AABBCCDDEEFF', name: 'MPT-II', cod: 0, com: false },
    { mac: '112233445566', name: 'Fone JBL', cod: 0x240404, com: false },
    { mac: '665544332211', name: 'Sem nome', cod: 0x040680, com: false },
    { mac: '010203040506', name: 'PT-210', cod: 0, com: true },
  ]);
  assert.deepEqual(
    list.map((d) => [d.mac, d.name]),
    [
      ['AA:BB:CC:DD:EE:FF', 'MPT-II'],
      ['66:55:44:33:22:11', 'Sem nome'],
    ],
  );
  assert.ok(looksLikePrinter('BlueTooth Printer'));
  assert.ok(!looksLikePrinter('Mouse'));
});

test('Linux: bluetoothctl e rfcomm', () => {
  assert.deepEqual(parseBluetoothctl('Device AA:BB:CC:DD:EE:FF MPT-II\nDevice xx Lixo'), [
    { mac: 'AA:BB:CC:DD:EE:FF', name: 'MPT-II' },
  ]);
  const map = parseRfcomm('rfcomm0: AA:BB:CC:DD:EE:FF channel 1 clean');
  assert.equal(map.get('AA:BB:CC:DD:EE:FF'), 0);
});

test('BLE: transporte do aplicativo; na linha de comando avisa', async () => {
  await assert.rejects(printText('ble:AA:BB', 'x'), /só funciona no aplicativo/);
  let got;
  registerTransport('ble:', async (base, data) => (got = [base, data.length]));
  await printText('ble:AA:BB?papel=58', 'Oi');
  assert.equal(got[0], 'ble:AA:BB');
  assert.ok(got[1] > 2);
});
