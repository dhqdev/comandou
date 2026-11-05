import { describe, expect, it } from 'vitest';
import {
  accessUntil,
  contractPhase,
  contractValidUntil,
  daysLeft,
  forecastDueDates,
  invoiceDue,
  paymentBlocked,
  periodAfterPayment,
  upgradeCharge,
} from './billing';

const at = (s: string) => new Date(s);

describe('cobrança: 7 dias de teste, pagou +30 dias, não pagou bloqueia', () => {
  it('acesso vai até o fim do teste ou do período pago', () => {
    expect(
      accessUntil({
        status: 'trialing',
        trialEndsAt: '2026-11-05T12:00:00Z',
        currentPeriodEnd: null,
      }),
    ).toEqual(at('2026-11-05T12:00:00Z'));
    expect(
      accessUntil({
        status: 'active',
        trialEndsAt: '2026-11-05T12:00:00Z',
        currentPeriodEnd: '2026-12-05T12:00:00Z',
      }),
    ).toEqual(at('2026-12-05T12:00:00Z'));
  });

  it('pagamento em dia soma 30 dias ao fim atual; atrasado conta do dia do pagamento', () => {
    expect(periodAfterPayment('2026-11-05T12:00:00Z', '2026-11-03T10:00:00Z')).toEqual(
      at('2026-12-05T12:00:00Z'),
    );
    expect(periodAfterPayment('2026-11-05T12:00:00Z', '2026-11-10T12:00:00Z')).toEqual(
      at('2026-12-10T12:00:00Z'),
    );
    expect(periodAfterPayment(null, '2026-11-10T12:00:00Z')).toEqual(at('2026-12-10T12:00:00Z'));
  });

  it('fatura sai N dias antes; bloqueio só depois do fim + tolerância', () => {
    const until = '2026-11-05T12:00:00Z';
    expect(invoiceDue(until, 5, at('2026-10-30T11:00:00Z'))).toBe(false);
    expect(invoiceDue(until, 5, at('2026-10-31T12:00:00Z'))).toBe(true);
    expect(paymentBlocked(until, 0, at('2026-11-05T11:59:00Z'))).toBe(false);
    expect(paymentBlocked(until, 0, at('2026-11-05T12:01:00Z'))).toBe(true);
    expect(paymentBlocked(until, 2, at('2026-11-06T12:01:00Z'))).toBe(false);
    expect(paymentBlocked(null, 0)).toBe(false);
    expect(daysLeft(until, at('2026-11-03T12:00:00Z'))).toBe(2);
    expect(daysLeft(until, at('2026-11-06T12:00:00Z'))).toBe(0);
  });

  it('subir de plano cobra a diferença proporcional; abaixo de R$ 5 não cobra', () => {
    const now = at('2026-11-01T12:00:00Z');
    expect(upgradeCharge('89.90', '179.90', '2026-11-16T12:00:00Z', now)).toEqual({
      cents: 4500,
      amount: '45.00',
      days: 15,
    });
    expect(upgradeCharge('89.90', '179.90', '2026-11-02T12:00:00Z', now).cents).toBe(0);
    expect(upgradeCharge('179.90', '89.90', '2026-11-16T12:00:00Z', now).cents).toBe(0);
  });

  it('contrato: vigência de 12 meses, aviso de renovação e bloqueio depois da tolerância', () => {
    expect(contractValidUntil('2026-10-29', 12)).toBe('2027-10-28');
    expect(contractValidUntil('2026-01-31', 1)).toBe('2026-02-27');
    expect(contractPhase(null, 30, 15)).toBe('none');
    expect(contractPhase('2027-10-28', 30, 15, at('2027-06-01T12:00:00Z'))).toBe('valid');
    expect(contractPhase('2027-10-28', 30, 15, at('2027-10-10T12:00:00Z'))).toBe('renewal');
    expect(contractPhase('2027-10-28', 30, 15, at('2027-11-02T12:00:00Z'))).toBe('expired');
    expect(contractPhase('2027-10-28', 30, 15, at('2027-11-20T12:00:00Z'))).toBe('blocked');
  });
});

describe('calendário de recebimentos', () => {
  it('vence no último dia liberado e depois a cada 30 dias', () => {
    expect(
      forecastDueDates('2026-11-05T15:00:00Z', '2026-11-01', '2026-12-31', '2026-11-01'),
    ).toEqual(['2026-11-05', '2026-12-05']);
  });

  it('pula o que já passou e o período que já tem fatura', () => {
    expect(
      forecastDueDates(
        '2026-11-05T15:00:00Z',
        '2026-11-01',
        '2026-12-31',
        '2026-11-06',
        new Set(['2026-12-05']),
      ),
    ).toEqual([]);
    expect(forecastDueDates(null, '2026-11-01', '2026-11-30', '2026-11-01')).toEqual([]);
  });

  it('período antigo continua no mesmo passo de 30 dias', () => {
    const until = '2025-01-10T15:00:00Z';
    const got = forecastDueDates(until, '2026-11-01', '2026-11-30', '2026-11-01');
    expect(got).toHaveLength(1);
    const steps =
      (new Date(`${got[0]}T15:00:00Z`).getTime() - new Date(until).getTime()) / 86_400_000;
    expect(steps % 30).toBe(0);
  });
});
