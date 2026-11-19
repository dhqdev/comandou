import { describe, expect, it } from 'vitest';
import { IFOOD_HOMOLOGATION_STEPS, usageReport } from './channel-usage';

const row = (metric: string, label: string, count: number) => ({ metric, label, count });

describe('usageReport (regras de uso indevido do iFood)', () => {
  it('sem uso: nada fora das regras, nada a mostrar', () => {
    const r = usageReport([]);
    expect(r).toMatchObject({ ackPct: null, ackTone: 'none', pollErrorPct: null, tone: 'none' });
    expect(r.endpoints).toEqual([]);
  });

  it('dentro das regras: ack de tudo, polling sem erro, poucas consultas por pedido', () => {
    const r = usageReport([
      row('request', 'events:polling|2xx', 1000),
      row('request', 'events:ack|2xx', 200),
      row('request', 'orders:details|2xx', 50),
      row('poll', 'empty', 800),
      row('poll', 'with_events', 200),
      row('poll_acked', 'all', 200),
      row('event', 'saved', 400),
      row('ack', 'ok', 400),
      row('order_lookup', '1', 50),
    ]);
    expect(r).toMatchObject({
      polls: 1000,
      pollsWithEvents: 200,
      ackPct: 100,
      ackTone: 'good',
      pollErrorPct: 0,
      pollTone: 'good',
      ordersLooked: 50,
      ordersOver5: 0,
      ordersBlocked: 0,
      lookupTone: 'good',
      clientErrors: 0,
      tone: 'good',
    });
    expect(r.endpoints.map((e) => e.endpoint)).toEqual([
      'events:polling',
      'events:ack',
      'orders:details',
    ]);
    expect(r.endpoints[0]).toMatchObject({ limitPct: 1, errorPct: 0, ok: 1000 });
  });

  it('ack abaixo de 95% e polling com 2% de erro ficam vermelhos', () => {
    const r = usageReport([
      row('request', 'events:polling|2xx', 98),
      row('request', 'events:polling|5xx', 2),
      row('poll', 'with_events', 98),
      row('poll', 'error', 2),
      row('poll_acked', 'all', 90),
      row('poll_acked', 'partial', 6),
      row('poll_acked', 'none', 2),
    ]);
    expect(r.polls).toBe(98);
    expect(r.ackPct).toBeCloseTo(91.84, 2);
    expect(r.ackTone).toBe('bad');
    expect(r.pollErrorPct).toBe(2);
    expect(r.pollTone).toBe('bad');
    expect(r.tone).toBe('bad');
  });

  it('ack entre 95% e 99% e 401 isolado: atenção', () => {
    const r = usageReport([
      row('request', 'events:polling|2xx', 1000),
      row('request', 'merchant:status|2xx', 99),
      row('request', 'merchant:status|401', 1),
      row('poll_acked', 'all', 97),
      row('poll_acked', 'partial', 3),
    ]);
    expect(r.ackTone).toBe('warn');
    expect(r.clientErrors).toBe(1);
    const status = r.endpoints.find((e) => e.endpoint === 'merchant:status')!;
    expect(status).toMatchObject({ errorPct: 1, limitPct: 1, tone: 'warn' });
    expect(r.tone).toBe('warn');
  });

  it('pedido com 6 consultas é atenção; no limite de 10, vermelho', () => {
    const base = [
      row('order_lookup', '1', 10),
      row('order_lookup', '2', 3),
      row('order_lookup', '6', 1),
    ];
    expect(usageReport(base)).toMatchObject({ ordersOver5: 1, lookupTone: 'warn' });
    expect(usageReport([...base, row('order_lookup', 'blocked', 2)])).toMatchObject({
      ordersBlocked: 2,
      lookupTone: 'bad',
      tone: 'bad',
    });
  });

  it('roteiro do iFood: ids únicos, cada passo com o como fazer, o de métricas conferido sozinho', () => {
    const ids = IFOOD_HOMOLOGATION_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of IFOOD_HOMOLOGATION_STEPS) {
      expect(s.id).toMatch(/^[a-z0-9_]{1,40}$/);
      expect(s.how.length).toBeGreaterThan(0);
    }
    expect(IFOOD_HOMOLOGATION_STEPS.filter((s) => s.auto).map((s) => s.id)).toEqual(['metrics']);
  });
});
