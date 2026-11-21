import { describe, expect, it } from 'vitest';
import { mapsPlaceUrl, mapsQuery } from './nav-apps';

const FULL =
  'Rua Doutor Herculano Gouvea Neto, 460 — B52 — Loteamento Parque São Martinho — Campinas/SP — CEP 13040-702 — Ref.: portão azul';

describe('Google Maps do endereço do pedido', () => {
  it('tira complemento e referência da busca', () => {
    expect(mapsQuery(FULL)).toBe(
      'Rua Doutor Herculano Gouvea Neto, 460, Loteamento Parque São Martinho, Campinas/SP, CEP 13040-702',
    );
  });
  it('sem complemento e em texto livre, mantém o endereço', () => {
    expect(mapsQuery('Rua A, 10 — Centro — Campinas/SP')).toBe('Rua A, 10, Centro, Campinas/SP');
    expect(mapsQuery('Rua A, 10, Centro')).toBe('Rua A, 10, Centro');
  });
  it('usa o pino quando o pedido tem', () => {
    expect(
      mapsPlaceUrl({ deliveryAddress: FULL, deliveryLat: '-22.950667', deliveryLng: '-47.054967' }),
    ).toBe('https://www.google.com/maps/search/?api=1&query=-22.950667%2C-47.054967');
  });
  it('sem pino, busca pelo endereço', () => {
    const url = new URL(mapsPlaceUrl({ deliveryAddress: 'Rua A, 10 — Centro — Campinas/SP' }));
    expect(url.searchParams.get('query')).toBe('Rua A, 10, Centro, Campinas/SP');
  });
});
