import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeCp860, QR_MARK, toEscPos } from './escpos.mjs';

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
