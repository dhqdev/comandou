import { describe, expect, it } from 'vitest';
import { activeInterruption, ifoodShifts, ifoodStoreStatus } from './ifood-merchant';

const NOW = Date.parse('2026-11-19T12:00:00.000Z');

describe('iFood: situação da loja', () => {
  it('a operação de entrega manda; frase do iFood ou da validação com problema', () => {
    expect(
      ifoodStoreStatus(
        [
          { operation: 'INDOOR', state: 'OK', available: true },
          {
            operation: 'DELIVERY',
            state: 'CLOSED',
            available: false,
            validations: [
              { id: 'is-connected', state: 'OK' },
              {
                id: 'opening-hours',
                state: 'CLOSED',
                message: { title: 'Fora do horário', subtitle: 'Abre às 18:00' },
              },
            ],
          },
        ],
        [],
        NOW,
      ),
    ).toEqual({
      state: 'closed',
      title: 'Fora do horário',
      detail: 'Abre às 18:00',
      pause: null,
    });
  });

  it('fechada com interrupção valendo vira pausada; vencida ou futura não conta', () => {
    const list = [
      { id: 'velha', start: '2026-11-19T10:00:00Z', end: '2026-11-19T11:00:00Z' },
      { id: 'futura', start: '2026-11-19T13:00:00Z', end: '2026-11-19T14:00:00Z' },
      {
        id: 'agora',
        description: 'Falta de gás',
        start: '2026-11-19T11:30:00Z',
        end: '2026-11-19T12:30:00Z',
      },
    ];
    expect(activeInterruption(list, NOW)).toEqual({
      id: 'agora',
      until: '2026-11-19T12:30:00.000Z',
      reason: 'Falta de gás',
    });
    expect(ifoodStoreStatus({ operation: 'DELIVERY', state: 'CLOSED' }, list, NOW).state).toBe(
      'paused',
    );
    expect(ifoodStoreStatus([{ state: 'OK', available: true }], null, NOW)).toEqual({
      state: 'open',
      pause: null,
    });
    expect(ifoodStoreStatus(null, null, NOW).state).toBe('unknown');
  });

  it('horários: dia da semana, início e duração; lixo fica de fora', () => {
    expect(
      ifoodShifts({
        shifts: [
          { dayOfWeek: 'SUNDAY', start: '18:00:00', duration: 300 },
          { dayOfWeek: 'FUNDAY', start: '10:00:00', duration: 60 },
          { dayOfWeek: 'MONDAY', start: 'x', duration: 60 },
          { dayOfWeek: 'TUESDAY', start: '10:00:00', duration: 5000 },
        ],
      }),
    ).toEqual([{ day: 0, start: '18:00', minutes: 300 }]);
  });
});
