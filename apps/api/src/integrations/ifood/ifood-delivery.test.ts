import { describe, expect, it } from 'vitest';
import { ifoodDriverUpdate, ifoodQuote, ifoodTracking } from './ifood-delivery';

describe('entregador do iFood', () => {
  it('evento de entrega vira a situação do entregador, só com o primeiro nome e o veículo', () => {
    expect(
      ifoodDriverUpdate('ADR', 'ASSIGN_DRIVER', {
        workerName: '  João da Silva ',
        workerPhone: '11999990000',
        workerVehicleType: 'motorcycle',
      }),
    ).toEqual({ status: 'assigned', name: 'João', vehicle: 'Moto' });
    expect(ifoodDriverUpdate('AAO', undefined, null)).toEqual({ status: 'at_store' });
    expect(ifoodDriverUpdate(undefined, 'COLLECTED', {})).toEqual({ status: 'collected' });
    expect(ifoodDriverUpdate('RDF', 'REQUEST_DRIVER_FAILED', {})).toEqual({
      status: 'request_failed',
    });
    expect(ifoodDriverUpdate('XYZ', 'QUALQUER', {})).toBeNull();
    // Nome com número ou símbolo: só as letras.
    expect(ifoodDriverUpdate('ADR', 'ASSIGN_DRIVER', { workerName: 'Ana123 Souza' })).toEqual({
      status: 'assigned',
      name: 'Ana',
    });
  });

  it('rastreio: previsões em data ou em segundos; sem previsão, nada', () => {
    const now = Date.parse('2026-11-19T12:00:00Z');
    expect(
      ifoodTracking(
        { expectedDelivery: '2026-11-19T12:30:00Z', pickupEtaStart: 600, latitude: -23 },
        now,
      ),
    ).toEqual({ eta: '2026-11-19T12:30:00.000Z', pickupEta: '2026-11-19T12:10:00.000Z' });
    expect(ifoodTracking({ deliveryEtaEnd: 1795608000 }, now)).toEqual({
      eta: new Date(1795608000 * 1000).toISOString(),
    });
    expect(ifoodTracking({ latitude: -23, longitude: -46 }, now)).toBeNull();
    expect(ifoodTracking(null, now)).toBeNull();
  });

  it('cotação: valor líquido em decimal, tempo em minutos, sem id ou valor é inválida', () => {
    expect(
      ifoodQuote({
        id: 'q1',
        quote: { grossValue: 9.99, netValue: 8.49 },
        deliveryTime: { min: 1200, max: 1800 },
        distance: 2300.4,
        expirationAt: '2026-11-19T12:05:00Z',
      }),
    ).toEqual({
      id: 'q1',
      fee: '8.49',
      minMinutes: 20,
      maxMinutes: 30,
      distanceM: 2300,
      expiresAt: '2026-11-19T12:05:00.000Z',
    });
    expect(ifoodQuote({ id: 'q2', quote: { grossValue: 0.1 + 0.2 } })?.fee).toBe('0.30');
    expect(ifoodQuote({ quote: { netValue: 5 } })).toBeNull();
    expect(ifoodQuote({ id: 'q3', quote: {} })).toBeNull();
  });
});
