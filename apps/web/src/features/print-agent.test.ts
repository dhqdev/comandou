import { describe, expect, it } from 'vitest';
import type { PrintAgent } from '../lib/types';
import { printHealth } from './print-agent';

const agent = (o: Partial<PrintAgent>): PrintAgent => ({
  id: 'a',
  name: 'PC do caixa',
  active: true,
  online: true,
  lastSeenAt: '2026-11-20T00:00:00Z',
  version: '1.4.0',
  printers: [{ target: null, label: 'EPSON TM-T20', kind: 'usb' }],
  ...o,
});

describe('printHealth', () => {
  it('sem computador ativo', () => {
    expect(printHealth([]).state).toBe('none');
    expect(printHealth([agent({ active: false })]).state).toBe('none');
  });
  it('online com impressora principal', () => {
    expect(printHealth([agent({})]).state).toBe('ok');
  });
  it('versão antiga (sem lista de impressoras) conta como pronta', () => {
    expect(printHealth([agent({ printers: null })]).state).toBe('ok');
  });
  it('online sem impressora principal escolhida', () => {
    expect(printHealth([agent({ printers: [] })]).state).toBe('no-printer');
    expect(
      printHealth([agent({ printers: [{ target: 'Bar', label: 'X', kind: 'network' }] })]).state,
    ).toBe('no-printer');
  });
  it('nenhum online', () => {
    expect(printHealth([agent({ online: false })]).state).toBe('offline');
  });
});
