import { describe, expect, it } from 'vitest';
import { liveAreaOf } from './live-changes.interceptor';

describe('liveAreaOf', () => {
  it('avisa a área certa só em gravações', () => {
    expect(liveAreaOf('POST', '/api/v1/finance/entries')).toEqual({ area: 'finance' });
    expect(liveAreaOf('patch', '/api/v1/finance/bank/lines/1')).toEqual({ area: 'finance' });
    expect(liveAreaOf('DELETE', '/api/v1/customers/abc')).toEqual({ area: 'customers' });
    expect(liveAreaOf('POST', '/api/v1/loyalty/adjust')).toEqual({ area: 'customers' });
    expect(liveAreaOf('PATCH', '/api/v1/users/1')).toEqual({ area: 'team' });
    expect(liveAreaOf('PUT', '/api/v1/agenda/events/1')).toEqual({
      area: 'agenda',
      personal: true,
    });
  });

  it('não avisa leitura nem rota sem área', () => {
    expect(liveAreaOf('GET', '/api/v1/finance/entries')).toBeNull();
    expect(liveAreaOf('POST', '/api/v1/orders')).toBeNull();
    expect(liveAreaOf('POST', '/api/v1/financeiro')).toBeNull();
    expect(liveAreaOf('POST', '/finance/entries')).toBeNull();
    expect(liveAreaOf('POST', '/api/v1/constructor')).toBeNull();
  });
});
