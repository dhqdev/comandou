import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BIG_MARK, BOLD_MARK, encodeCp860, LOGO_MARK, QR_MARK, toEscPos } from './escpos.mjs';

test('acentos do português viram CP860', () => {
  assert.deepEqual([...encodeCp860('ção')], [0x87, 0x84, 0x6f]);
  assert.deepEqual([...encodeCp860('É')], [0x90]);
});

test('caractere fora da tabela perde o acento ou vira "?"', () => {
  assert.equal(encodeCp860('ŷ').toString('latin1'), 'y');
  assert.equal(encodeCp860('€').toString('latin1'), '?');
});

test('documento inicializa, seleciona CP860 e corta no fim', () => {
  const b = toEscPos('Pedido #1');
  assert.deepEqual([...b.subarray(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 3]);
  assert.deepEqual([...b.subarray(-4)], [0x1d, 0x56, 66, 0]);
  assert.ok(b.includes(Buffer.from('Pedido #1')));
});

test('linha com a marca de QR vira QR Code nativo (GS ( k), não texto', () => {
  const url = 'https://www.sefaz.example/nfce?p=1234|2|1|1|abc';
  const b = toEscPos(`NFC-e 1\n${QR_MARK}${url}\nfim`);
  const store = Buffer.from([0x1d, 0x28, 0x6b, (url.length + 3) & 0xff, 0, 0x31, 0x50, 0x30]);
  assert.ok(b.includes(store));
  assert.ok(b.includes(Buffer.from(url)));
  assert.ok(!b.includes(Buffer.from(QR_MARK)));
  assert.ok(b.includes(Buffer.from([0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30])));
  assert.ok(b.includes(Buffer.from('fim')));
});

test('negrito e letra grande viram ESC E e GS !, sem a marca no papel', () => {
  const b = toEscPos(`${BOLD_MARK}PEDIDO: #12\n${BIG_MARK}TOTAL:   R$ 9,00\nfim`);
  assert.ok(b.includes(Buffer.from([0x1b, 0x45, 1])));
  assert.ok(b.includes(Buffer.from([0x1d, 0x21, 0x11])));
  assert.ok(b.includes(Buffer.from([0x1d, 0x21, 0])));
  assert.ok(!b.includes(Buffer.from('@@')));
  assert.ok(b.includes(Buffer.from('TOTAL:   R$ 9,00')));
});

test('logo vira imagem GS v 0 centralizada; sem logo a linha some', () => {
  const logo = { width: 16, height: 2, data: Buffer.from([0xff, 0x00, 0x0f, 0xf0]) };
  const b = toEscPos(`${LOGO_MARK}\nLoja`, { logo });
  assert.ok(b.includes(Buffer.from([0x1d, 0x76, 0x30, 0, 2, 0, 2, 0, 0xff, 0x00, 0x0f, 0xf0])));
  const sem = toEscPos(`${LOGO_MARK}\nLoja`);
  assert.ok(!sem.includes(Buffer.from([0x1d, 0x76, 0x30])));
  assert.ok(!sem.includes(Buffer.from('@@')));
  // Imagem maior que o papel de 58 mm é ignorada (não imprime lixo).
  const larga = { width: 576, height: 1, data: Buffer.alloc(72, 0xff) };
  assert.ok(
    !toEscPos(`${LOGO_MARK}`, { paper: 58, logo: larga }).includes(Buffer.from([0x1d, 0x76])),
  );
});
