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
import { mergeFound, toFound } from './desktop/discover.mjs';
import { DOT, documentHtml, pngToIco } from './desktop/pure.mjs';
import { QR_MARK } from './escpos.mjs';
import {
  isVirtualPrinter,
  looksLikeReceipt,
  normalizeMac,
  parseSpec,
  registerTransport,
  printText,
  withOptions,
} from './printers.mjs';
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

// ------------------------------------------------------------------ impressora comum e busca

test('térmica x impressora comum pelo nome e pelo driver', () => {
  assert.equal(looksLikeReceipt('EPSON TM-T20X', 'EPSON TM-T20X Receipt'), true);
  assert.equal(looksLikeReceipt('Caixa', 'Generic / Text Only'), true);
  assert.equal(looksLikeReceipt('ELGIN i9'), true);
  assert.equal(looksLikeReceipt('POS-80'), true);
  assert.equal(looksLikeReceipt('EPSON L3250 Series', 'EPSON L3250 Series'), false);
  assert.equal(looksLikeReceipt('EPSON L3250 Series'), false); // Windows sem o driver
  assert.equal(looksLikeReceipt('HP DeskJet 2700'), false);
  assert.equal(looksLikeReceipt('Brother_HL_L2350DW', 'Brother HL-L2350DW series'), false);
  assert.equal(looksLikeReceipt('Impressora', 'Canon G3010 series'), false);
  assert.equal(looksLikeReceipt('Impressora'), true); // na dúvida, térmica
  assert.equal(looksLikeReceipt('Microsoft Print to PDF'), false);
  assert.equal(isVirtualPrinter('Microsoft Print to PDF'), true);
  assert.equal(isVirtualPrinter('OneNote (Desktop)'), true);
  assert.equal(isVirtualPrinter('EPSON L3250 Series'), false);
});

test('modo folha só vale para impressora do sistema e passa pelo transporte "doc"', async () => {
  assert.equal(parseSpec('printer:EPSON L3250?modo=folha').opts.mode, 'doc');
  assert.equal(parseSpec('tcp://10.0.0.5:9100?modo=folha').opts.mode, undefined);
  assert.match(withOptions('printer:EPSON L3250?modo=folha', { paper: 58 }), /modo=folha/);
  const got = [];
  registerTransport('doc', async (base, text, opts) => got.push({ base, text, opts }));
  await printText('printer:EPSON L3250?modo=folha', 'Mesa 4');
  assert.equal(got.length, 1);
  assert.equal(got[0].base, 'printer:EPSON L3250');
  assert.equal(got[0].text, 'Mesa 4');
});

test('lista da busca: instaladas viram folha ou térmica, sem impressora virtual', () => {
  const sys = toFound.system(
    [
      { name: 'EPSON L3250 Series', displayName: 'EPSON L3250 Series' },
      { name: 'TM-T20', displayName: 'TM-T20' },
      { name: 'Microsoft Print to PDF' },
    ],
    new Map([['EPSON L3250 Series', { driver: 'EPSON L3250 Series' }]]),
  );
  assert.deepEqual(
    sys.map((f) => [f.name, f.spec, f.receipt]),
    [
      ['EPSON L3250 Series', 'printer:EPSON L3250 Series?modo=folha', false],
      ['TM-T20', 'printer:TM-T20', true],
    ],
  );
  const net = toFound.network([
    { host: '192.168.0.50', port: 9100, mac: 'aa:bb:cc:dd:ee:ff', name: 'Elgin i9' },
  ]);
  assert.equal(net[0].spec, 'tcp://192.168.0.50:9100?mac=aa:bb:cc:dd:ee:ff');
  assert.equal(net[0].detail, 'Rede · 192.168.0.50');
  const usb = toFound.usbNew([{ id: 'USB001', label: 'Impressora USB (USB001)' }]);
  assert.equal(usb[0].action, 'install');
  const bt = toFound.btNoPort([{ mac: '00:11:22:33:44:55', name: 'MPT-II' }], 'win32');
  assert.equal(bt[0].action, 'com');
  assert.equal(toFound.btNoPort([{ mac: 'x', name: 'y' }], 'darwin')[0].action, undefined);
  const merged = mergeFound({
    network: net,
    system: sys,
    'usb-new': usb,
    direct: [{ id: sys[1].id, name: 'dup' }],
  });
  assert.deepEqual(
    merged.map((f) => f.kind),
    ['system', 'system', 'usb-new', 'network'],
  );
});

test('folha da impressora comum: escapa o texto e troca o QR Code pelo endereço', () => {
  const html = documentHtml(`Mesa <4> & "bar"\n${QR_MARK}https://nfce.fazenda/q?p=1`, {
    paper: 58,
  });
  assert.match(html, /Mesa &lt;4&gt; &amp; &quot;bar&quot;/);
  assert.match(html, /Consulte pelo QR Code: https:\/\/nfce\.fazenda\/q\?p=1/);
  assert.match(html, /9\.5pt/);
  assert.doesNotMatch(html, /<script/i);
});

test('ícone .ico com o PNG dentro e cores da bolinha', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const ico = pngToIco(png);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 1);
  assert.equal(ico.readUInt32LE(6 + 8), png.length);
  assert.equal(ico.readUInt32LE(6 + 12), 22);
  assert.deepEqual(ico.subarray(22), png);
  assert.equal(DOT.online, '#22c55e');
});
