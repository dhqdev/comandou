import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeCp860, toEscPos } from './escpos.mjs';

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
