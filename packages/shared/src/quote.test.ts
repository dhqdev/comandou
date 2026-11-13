import { describe, expect, it } from 'vitest';
import {
  FOCUS_RETAIL_DEFAULTS as F,
  fiscalCostClause,
  fiscalEstimate,
  formatUnitBRL,
} from './quote';

describe('orçamento: custo da nota fiscal', () => {
  it('formata preço por nota com 3 casas só quando precisa', () => {
    expect(formatUnitBRL('0.055')).toBe('R$ 0,055');
    expect(formatUnitBRL('0.16')).toBe('R$ 0,16');
    expect(formatUnitBRL('62.90')).toBe('R$ 62,90');
  });

  it('dentro do pacote paga só a mensalidade da nota', () => {
    expect(fiscalEstimate(F, 400, 10)).toMatchObject({ totalCents: 6290, extraCents: 0 });
  });

  it('acima do pacote soma as notas a mais, arredondando uma vez só', () => {
    // 1.500 NFC-e acima × 0,055 = 82,50; 20 NF-e acima × 0,16 = 3,20
    const e = fiscalEstimate(F, 2000, 120);
    expect(e).toMatchObject({ nfceExtraCount: 1500, nfeExtraCount: 20, extraCents: 8570 });
    expect(e.totalCents).toBe(6290 + 8570);
    // 1 nota a mais = 5,5 centavos → 6 centavos
    expect(fiscalEstimate(F, 501, 0).extraCents).toBe(6);
  });

  it('no modo incluído o pacote não é cobrado à parte', () => {
    const inc = { ...F, mode: 'included' as const };
    expect(fiscalEstimate(inc, 500, 0).totalCents).toBe(0);
    expect(fiscalEstimate(inc, 600, 0).totalCents).toBe(550);
    expect(fiscalCostClause(inc)).toContain('incluído na mensalidade');
  });

  it('cláusula do repasse cita a Focus, o pacote e o excedente', () => {
    const t = fiscalCostClause(F);
    expect(t).toContain('Focus NFe');
    expect(t).toContain('R$ 62,90');
    expect(t).toContain('até 500 NFC-e e 100 NF-e por mês');
    expect(t).toContain('R$ 0,055 por NFC-e');
  });
});
