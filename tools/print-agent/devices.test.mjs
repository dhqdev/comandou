import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { test } from 'node:test';
import { localSubnets, macPortsFrom, scanNetwork } from './devices.mjs';
import { toEscPos } from './escpos.mjs';
import {
  describePrinter,
  parseSpec,
  parseTcp,
  serialError,
  serialShell,
  testPageText,
  validDirectDevice,
  validSerialPort,
  withOptions,
} from './printers.mjs';

test('ajustes da impressora: ida e volta, padrão fica de fora', () => {
  assert.deepEqual(parseSpec('tcp://10.0.0.5:9100'), {
    base: 'tcp://10.0.0.5:9100',
    opts: { paper: 80, codepage: '860', baud: 9600 },
  });
  const s = withOptions('serial:COM5', { paper: 58, codepage: '850', baud: 115200 });
  assert.equal(s, 'serial:COM5?papel=58&acentos=850&baud=115200');
  assert.deepEqual(parseSpec(s).opts, { paper: 58, codepage: '850', baud: 115200 });
  assert.equal(
    withOptions('tcp://1.2.3.4:9100', { paper: 80, codepage: '860' }),
    'tcp://1.2.3.4:9100',
  );
  // baud só vale para serial; valor estranho volta ao padrão
  assert.equal(withOptions('tcp://1.2.3.4:9100', { baud: 19200 }), 'tcp://1.2.3.4:9100');
  assert.equal(parseSpec('serial:COM1?baud=1234').opts.baud, 9600);
  // "?" que não é ajuste faz parte do nome
  assert.equal(parseSpec('printer:Caixa? novo').base, 'printer:Caixa? novo');
  assert.deepEqual(parseTcp('tcp://1.2.3.4:9101?papel=58'), { host: '1.2.3.4', port: 9101 });
});

test('portas aceitas e rótulos', () => {
  assert.ok(validSerialPort('COM5'));
  assert.ok(validSerialPort('/dev/cu.MPT-II'));
  assert.ok(validSerialPort('/dev/rfcomm0'));
  assert.ok(!validSerialPort('/dev/../etc/passwd'));
  assert.ok(!validSerialPort('COM5; rm -rf'));
  assert.ok(validDirectDevice('/dev/usb/lp0'));
  assert.ok(!validDirectDevice('/home/x/arquivo'));
  assert.equal(describePrinter('serial:COM5?baud=19200'), 'Porta COM5');
  assert.equal(describePrinter('file:/dev/usb/lp0'), 'USB direto /dev/usb/lp0');
});

test('papel de 58 mm usa a fonte B; sem acentos não manda ESC t', () => {
  const b58 = toEscPos('Pedido', { paper: 58 });
  assert.ok(b58.includes(Buffer.from([0x1b, 0x4d, 1])));
  assert.ok(!toEscPos('Pedido').includes(Buffer.from([0x1b, 0x4d, 1])));
  const ascii = toEscPos('Ação', { codepage: 'ascii' });
  assert.ok(!ascii.includes(Buffer.from([0x1b, 0x74])));
  assert.ok(ascii.includes(Buffer.from('Acao')));
  const cp850 = toEscPos('ã', { codepage: '850' });
  assert.ok(cp850.includes(Buffer.from([0x1b, 0x74, 2])));
  assert.ok(cp850.includes(Buffer.from([0xc6])));
});

test('página de teste traz a régua de 42 colunas e os ajustes', () => {
  const t = testPageText('Rede 1.2.3.4:9100', 'tcp://1.2.3.4:9100?papel=58');
  assert.ok(t.includes('123456789012345678901234567890123456789012'));
  assert.ok(t.includes('Papel: 58 mm'));
  for (const line of t.split('\n')) assert.ok(line.length <= 42, line);
});

test('porta serial: comando por sistema e mensagens claras', () => {
  assert.match(serialShell('linux'), /stty -F "\$DEV"/);
  assert.match(serialShell('darwin'), /exec 3<>"\$DEV"/);
  assert.match(serialError('COM5', new Error('PORT_BUSY'), 'win32'), /ocupada/);
  assert.match(serialError('/dev/ttyUSB0', new Error('Permission denied'), 'linux'), /dialout/);
  assert.match(
    serialError('COM9', { code: 'TIMEOUT', message: 'TIMEOUT' }, 'win32'),
    /não respondeu/,
  );
});

test('macOS: Bluetooth pareado e USB-serial; portas do sistema ficam de fora', () => {
  const list = macPortsFrom([
    'cu.Bluetooth-Incoming-Port',
    'cu.MPT-II',
    'cu.usbserial-1410',
    'tty.MPT-II',
    'cu.debug-console',
  ]);
  assert.deepEqual(list, [
    { path: '/dev/cu.MPT-II', label: 'MPT-II', kind: 'bluetooth' },
    { path: '/dev/cu.usbserial-1410', label: 'usbserial-1410', kind: 'usb' },
  ]);
});

test('redes locais: /24 de cada placa, sem loopback nem 169.254', () => {
  const nets = localSubnets({
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    eth0: [{ family: 'IPv4', address: '192.168.0.10', internal: false }],
    wlan0: [
      { family: 'IPv4', address: '169.254.3.3', internal: false },
      { family: 'IPv6', address: 'fe80::1', internal: false },
    ],
  });
  assert.deepEqual(nets, [{ prefix: '192.168.0', own: ['192.168.0.10'] }]);
});

test('procura na rede acha quem escuta na porta, sem mandar nada', async () => {
  let got = 0;
  const srv = net.createServer((s) => s.on('data', (d) => (got += d.length)));
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const { port } = srv.address();
  const found = await scanNetwork({ hosts: ['127.0.0.1', '127.0.0.2'], port, timeoutMs: 300 });
  srv.close();
  assert.deepEqual(
    found.map((f) => f.host),
    ['127.0.0.1'],
  );
  assert.equal(got, 0);
});
