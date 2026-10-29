import { describe, expect, it } from 'vitest';
import { colName, sheetName, XDate } from '../xlsx';
import { districtOf, topWithOthers } from './kit';

describe('bairro do endereço de entrega', () => {
  it('lê o formato do cardápio online', () => {
    expect(districtOf('Rua A, 10 — apto 2 — Pinheiros — São Paulo/SP — CEP 05422-010')).toBe(
      'Pinheiros',
    );
    expect(districtOf('Rua A, 10 — Vila Madalena — São Paulo/SP')).toBe('Vila Madalena');
    expect(districtOf('Rua A, 10 — VILA DA SAÚDE')).toBe('Vila da Saúde');
  });
  it('lê o endereço livre do PDV quando o bairro vem depois do hífen', () => {
    expect(districtOf('Rua das Flores, 120 - Centro')).toBe('Centro');
    expect(districtOf('Rua das Flores, 120 - apto 3')).toBeNull();
    expect(districtOf('Rua das Flores, 120')).toBeNull();
    expect(districtOf(null)).toBeNull();
  });
});

describe('planilha', () => {
  it('nomes de coluna e de aba', () => {
    expect([colName(0), colName(25), colName(26), colName(701)]).toEqual(['A', 'Z', 'AA', 'ZZ']);
    const used = new Set<string>();
    expect(sheetName('Esperado × contado por forma de pagamento', used)).toHaveLength(31);
    expect(sheetName('Resumo', used)).toBe('Resumo');
    expect(sheetName('Resumo', used)).toBe('Resumo (2)');
    expect(sheetName('a/b:c', used)).toBe('a b c');
  });
  it('data local vira número de série do Excel', () => {
    expect(new XDate('1900-03-01').serial()).toBe(61);
    expect(new XDate('2026-10-29T12:00').serial()).toBeCloseTo(46324.5, 5);
  });
  it('junta o rabo em Outros', () => {
    const pts = [5, 4, 3, 2, 1, 1, 1, 1].map((v, i) => ({ label: `p${i}`, value: v }));
    const out = topWithOthers(pts, 3);
    expect(out.map((p) => p.label)).toEqual(['p0', 'p1', 'p2', 'Outros']);
    expect(out[3]!.value).toBe(6);
  });
});
