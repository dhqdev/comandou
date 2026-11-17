import { describe, expect, it } from 'vitest';
import {
  proposeMatches,
  type MatchEntry,
  type MatchLine,
  type MatchSettlement,
} from './bank-match';

const L = (id: string, date: string, cents: number, description = 'CREDITO'): MatchLine => ({
  id,
  date,
  cents,
  description,
});
const S = (
  id: string,
  method: string,
  day: string,
  expectedDate: string,
  cents: number,
): MatchSettlement => ({ id, method, day, expectedDate, cents });

describe('conciliação automática', () => {
  it('casa uma linha com um recebível de mesmo valor e data perto', () => {
    const p = proposeMatches(
      [L('l1', '2026-11-17', 9850)],
      [
        S('s1', 'debit', '2026-11-16', '2026-11-17', 9850),
        S('s2', 'debit', '2026-11-10', '2026-11-11', 9850),
      ],
      [],
    );
    expect(p).toEqual([{ kind: 'settlement', lineIds: ['l1'], settlementIds: ['s1'], auto: true }]);
  });

  it('casa um depósito da maquininha com os recebíveis do mesmo dia somados', () => {
    const p = proposeMatches(
      [L('l1', '2026-11-17', 15000)],
      [
        S('s1', 'debit', '2026-11-16', '2026-11-17', 10000),
        S('s2', 'debit', '2026-11-16', '2026-11-17', 5000),
        S('s3', 'credit', '2026-10-18', '2026-11-17', 7000),
      ],
      [],
    );
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: 'settlement', auto: true });
    expect((p[0] as { settlementIds: string[] }).settlementIds.sort()).toEqual(['s1', 's2']);
  });

  it('junta as linhas de PIX do dia com o PIX do caixa', () => {
    const p = proposeMatches(
      [
        L('a', '2026-11-16', 3000, 'PIX RECEBIDO JOAO'),
        L('b', '2026-11-16', 4500, 'Pix recebido Maria'),
        L('c', '2026-11-16', 99999, 'TED'),
      ],
      [S('s1', 'pix', '2026-11-16', '2026-11-16', 7500)],
      [],
    );
    expect(p).toEqual([
      { kind: 'settlement', lineIds: ['a', 'b'], settlementIds: ['s1'], auto: true },
    ]);
  });

  it('liga a conta já paga sozinho e só sugere baixar a conta em aberto', () => {
    const entries: MatchEntry[] = [
      { id: 'paid', kind: 'payable', cents: 35000, date: '2026-11-10', open: false },
      { id: 'open', kind: 'payable', cents: 120000, date: '2026-11-15', open: true },
    ];
    const p = proposeMatches(
      [L('l1', '2026-11-11', -35000, 'LUZ'), L('l2', '2026-11-14', -120000, 'ALUGUEL')],
      [],
      entries,
    );
    expect(p).toEqual([
      { kind: 'entry', lineIds: ['l1'], entryId: 'paid', settle: false, auto: true },
      { kind: 'entry', lineIds: ['l2'], entryId: 'open', settle: true, auto: false },
    ]);
  });

  it('sugere (sem aplicar) quando a taxa real deixa o valor um pouco diferente', () => {
    const p = proposeMatches(
      [L('l1', '2026-11-17', 9790)],
      [S('s1', 'credit', '2026-10-18', '2026-11-17', 9800)],
      [],
    );
    expect(p).toEqual([
      { kind: 'settlement', lineIds: ['l1'], settlementIds: ['s1'], auto: false },
    ]);
  });

  it('não usa o mesmo recebível duas vezes nem casa fora da janela', () => {
    const p = proposeMatches(
      [L('l1', '2026-11-17', 5000), L('l2', '2026-11-17', 5000), L('l3', '2026-12-30', 5000)],
      [S('s1', 'debit', '2026-11-16', '2026-11-17', 5000)],
      [],
    );
    expect(p).toHaveLength(1);
    expect(p[0]!.lineIds).toEqual(['l1']);
  });
});
