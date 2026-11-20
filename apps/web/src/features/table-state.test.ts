import { describe, expect, it } from 'vitest';
import type { DiningTable } from '../lib/types';
import { tableFromQr } from './table-state';

const ID = '3f2b8c1e-5d4a-4b6f-9a0e-1c2d3e4f5a6b';
const tables = [
  { id: ID, label: '4' },
  { id: '00000000-0000-4000-8000-000000000010', label: '10' },
] as DiningTable[];

describe('Escanear mesa', () => {
  it('acha a mesa pelo QR colado nela, pelo link do cardápio, pelo id e pelo número', () => {
    expect(tableFromQr(`https://fumaca.comandou.com/mesa/${ID}`, tables)?.label).toBe('4');
    expect(tableFromQr(`https://fumaca.comandou.com/pedir?mesa=${ID}`, tables)?.label).toBe('4');
    expect(tableFromQr(` ${ID} `, tables)?.label).toBe('4');
    expect(tableFromQr('Mesa 10', tables)?.label).toBe('10');
  });

  it('recusa QR de outro restaurante ou que não é de mesa', () => {
    expect(
      tableFromQr('https://outro.comandou.com/mesa/11111111-1111-4111-8111-111111111111', tables),
    ).toBeUndefined();
    expect(tableFromQr('https://exemplo.com', tables)).toBeUndefined();
  });
});
