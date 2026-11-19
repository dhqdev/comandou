import { describe, expect, it } from 'vitest';
import { composeNote, ComposeInput, ComposeItem } from './fiscal-compose';
import type { FiscalRule } from './fiscal-rules.service';

const rule = (o: Partial<FiscalRule> = {}): FiscalRule => ({
  id: 'r1',
  code: 'P1',
  name: 'Comida',
  scope: 'all',
  active: true,
  isDefault: true,
  cfop: '5102',
  cfopInterstate: null,
  icmsCst: '102',
  icmsOrigin: 0,
  icmsRate: null,
  icmsBaseReduction: null,
  pisCst: '49',
  pisRate: null,
  cofinsCst: '49',
  cofinsRate: null,
  ipiCst: null,
  ipiRate: null,
  ibsCbsCst: null,
  ibsCbsClass: null,
  cbsRate: null,
  ibsUfRate: null,
  ibsMunRate: null,
  benefitCode: null,
  approxTaxRate: null,
  notes: null,
  ...o,
});

const item = (r: FiscalRule, o: Partial<ComposeItem> = {}): ComposeItem => ({
  id: 'i1',
  productId: 'p1',
  name: 'X-Burguer',
  quantity: '1',
  totalCents: 10000,
  ncm: '21069090',
  cest: null,
  unit: null,
  legacyCfop: null,
  legacyCode: null,
  origin: 0,
  rule: r,
  source: 'default',
  ...o,
});

const input = (o: Partial<ComposeInput> & { r?: FiscalRule } = {}): ComposeInput => {
  const { r = rule(), ...rest } = o;
  return {
    kind: 'nfce',
    cnpj: '11222333000181',
    issuerUf: 'SP',
    regime: 1,
    order: {
      channel: 'counter',
      source: 'pos',
      subtotalCents: 10000,
      discountCents: 0,
      surchargeCents: 0,
      deliveryFeeCents: 0,
      totalCents: 10000,
    },
    items: [item(r)],
    payments: [{ method: 'cash', net: '100.00' }],
    settings: {
      defaultCfop: '5102',
      defaultCode: '102',
      defaultNcm: null,
      nature: 'VENDA',
      additionalInfo: null,
      strictRules: true,
    },
    recipient: null,
    operation: {},
    ...rest,
  };
};

const titles = (i: ComposeInput) => composeNote(i).issues.map((x) => x.title);

describe('composeNote', () => {
  it('nota simples do Simples Nacional passa sem problemas', () => {
    expect(composeNote(input()).issues).toEqual([]);
  });

  it('NFC-e recusa CFOP e CSOSN que a SEFAZ não aceita no consumidor final', () => {
    const out = composeNote(input({ r: rule({ cfop: '5929', icmsCst: '101' }) }));
    const issue = out.issues.find((x) => x.title === 'Padrão fiscal incompleto');
    expect(issue?.detail).toContain('CFOP 5929');
    expect(issue?.detail).toContain('CSOSN 101');
    // 5949 vale para a gorjeta em SP, não no PR.
    expect(titles(input({ r: rule({ cfop: '5949', icmsCst: '900' }) }))).toEqual([]);
    expect(titles(input({ issuerUf: 'PR', r: rule({ cfop: '5949', icmsCst: '900' }) }))).toContain(
      'Padrão fiscal incompleto',
    );
  });

  it('regime normal sem alíquota do ICMS ou do PIS é barrado antes da SEFAZ', () => {
    const out = composeNote(
      input({ regime: 3, r: rule({ icmsCst: '00', pisCst: '01', cofinsCst: '01' }) }),
    );
    const d = out.issues.find((x) => x.title === 'Padrão fiscal incompleto')!.detail;
    expect(d).toContain('CST 00 do ICMS precisa da alíquota');
    expect(d).toContain('CST 01 do PIS');
    expect(d).toContain('CST 01 da COFINS');
  });

  it('ICMS-ST sem CEST vira aviso no item', () => {
    expect(titles(input({ r: rule({ cfop: '5405', icmsCst: '500' }) }))).toContain(
      'Item com ICMS-ST sem CEST',
    );
    const ok = input({ r: rule({ cfop: '5405', icmsCst: '500' }) });
    ok.items[0].cest = '0300700';
    expect(titles(ok)).toEqual([]);
  });

  it('NFC-e manda o destinatário sempre como não contribuinte', () => {
    const { payload } = composeNote(
      input({
        recipient: { name: 'Empresa', cnpj: '11222333000181', ie: '123456789', ieIndicator: 1 },
      }),
    );
    expect(payload.indicador_inscricao_estadual_destinatario).toBe('9');
    expect(payload.inscricao_estadual_destinatario).toBeUndefined();
  });

  it('IBS/CBS de bar e restaurante (200047) leva a redução de 40% e a alíquota efetiva', () => {
    const { payload, issues } = composeNote(
      input({
        r: rule({ ibsCbsCst: '200', ibsCbsClass: '200047', cbsRate: '0.9', ibsUfRate: '0.1' }),
      }),
    );
    expect(issues).toEqual([]);
    const it0 = (payload.items as Record<string, unknown>[])[0];
    expect(it0).toMatchObject({
      cbs_aliquota: '0.9',
      cbs_percentual_reducao_aliquota: '40',
      cbs_aliquota_efetiva: '0.54',
      cbs_valor: '0.54',
      ibs_uf_aliquota_efetiva: '0.06',
      ibs_uf_valor: '0.06',
    });
    expect(
      titles(input({ r: rule({ ibsCbsCst: '200', ibsCbsClass: '200030', cbsRate: '0.9' }) })),
    ).toContain('Padrão fiscal incompleto');
  });

  it('NF-e de delivery não usa a presença "entrega a domicílio" (só da NFC-e)', () => {
    const base = input({
      kind: 'nfe',
      recipient: {
        name: 'Cliente',
        cpf: '52998224725',
        street: 'Rua A',
        number: '1',
        district: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        cep: '01001000',
      },
    });
    base.order.channel = 'delivery';
    expect(composeNote({ ...base, operation: { presence: '4' } }).payload.presenca_comprador).toBe(
      '9',
    );
    expect(composeNote(base).payload.presenca_comprador).toBe('9');
  });

  it('NF-e para não contribuinte de outro estado usa 6108; o 5405 vira 6404', () => {
    const rec = {
      name: 'Cliente',
      cpf: '52998224725',
      street: 'Rua A',
      number: '1',
      district: 'Centro',
      city: 'Rio de Janeiro',
      state: 'RJ',
      cep: '20000000',
    };
    const cfop = (r: FiscalRule) =>
      (
        composeNote(input({ kind: 'nfe', recipient: rec, r })).payload.items as { cfop: string }[]
      )[0].cfop;
    expect(cfop(rule())).toBe('6108');
    expect(cfop(rule({ cfop: '5405', icmsCst: '500' }))).toBe('6404');
  });
});
