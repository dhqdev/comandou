import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import type { CepService } from '../store/cep.service';
import {
  districtVariants,
  GeocoderService,
  sameStreet,
  streetCore,
  streetTokens,
} from './geocoder.service';

const env = { GEOCODER_URL: 'https://nominatim.test', PHOTON_URL: 'https://photon.test' } as Env;
const STORE = { lat: -22.9, lng: -47.06 }; // Campinas
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ROAD = {
  lat: '-22.95',
  lon: '-47.10',
  display_name: 'Rua Doutor Herculano Gouvêa Neto, Parque São Martinho, Campinas, SP, Brasil',
  category: 'highway',
  addresstype: 'road',
  address: { road: 'Rua Doutor Herculano Gouvêa Neto' },
};

function geocoder(cep?: Partial<CepService>) {
  const g = new GeocoderService(env, cep as CepService | undefined);
  g.intervalMs = 0;
  return g;
}

/** Nominatim e Photon falsos: `nom` e `pho` decidem a resposta a cada consulta. */
function fakeNet(nom: (p: URLSearchParams) => unknown[], pho: (q: string) => unknown[] = () => []) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: URL) => {
      calls.push(u.toString());
      if (u.hostname === 'photon.test')
        return json({ features: pho(u.searchParams.get('q') ?? '') });
      return json(nom(u.searchParams));
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('nomes de rua e bairro', () => {
  it('tira tipo e títulos da rua', () => {
    expect(streetCore('Rua Doutor Herculano Gouvea Neto')).toBe('Herculano Gouvea Neto');
    expect(streetCore('Av. Dr. Moraes Sales')).toBe('Moraes Sales');
    // Sem o título sobraria pouco: fica o nome.
    expect(streetCore('Rua São Paulo')).toBe('São Paulo');
    expect(streetTokens('R. Dr. Herculano Gouvêa Neto')).toEqual(['herculano', 'gouvea', 'neto']);
  });
  it('reconhece a mesma rua escrita de outro jeito', () => {
    expect(
      sameStreet('Rua Doutor Herculano Gouvea Neto', 'Rua Dr. Herculano Gouvêa Neto, Campinas'),
    ).toBe(true);
    expect(sameStreet('Rua Doutor Herculano Gouvea Neto', 'Rua Herculano, Campinas')).toBe(false);
  });
  it('tira "Loteamento" e afins do bairro', () => {
    expect(districtVariants('Loteamento Parque São Martinho')).toEqual([
      'Loteamento Parque São Martinho',
      'Parque São Martinho',
    ]);
    expect(districtVariants('Centro')).toEqual(['Centro']);
    expect(districtVariants('')).toEqual([]);
  });
});

describe('locate', () => {
  const addr = {
    street: 'Rua Doutor Herculano Gouvea Neto',
    number: '460',
    district: 'Loteamento Parque São Martinho',
  };
  const ctx = { near: STORE, city: 'Campinas', state: 'SP' };

  it('acha a casa pela busca estruturada com a cidade da loja', async () => {
    const calls = fakeNet((p) =>
      p.get('street') === '460 Rua Doutor Herculano Gouvea Neto' && p.get('city') === 'Campinas'
        ? [{ ...ROAD, address: { ...ROAD.address, house_number: '460' } }]
        : [],
    );
    const r = await geocoder().locate(addr, ctx);
    expect(r).toMatchObject({ lat: -22.95, lng: -47.1, precision: 'house' });
    expect(calls.some((c) => c.includes('addressdetails=1'))).toBe(true);
  });

  it('sem o número no mapa, fica a rua (o caso do "Loteamento")', async () => {
    // O mapa conhece a rua (com outra grafia), não o número nem o "Loteamento".
    fakeNet((p) => {
      const q = p.get('q') ?? '';
      return q.startsWith('Herculano Gouvea Neto, Campinas') ? [ROAD] : [];
    });
    const r = await geocoder().locate(addr, ctx);
    expect(r).toMatchObject({ precision: 'street', lat: -22.95 });
  });

  it('aceita a rua do Photon quando o Nominatim não acha', async () => {
    fakeNet(
      () => [],
      (q) =>
        q.includes('Herculano')
          ? [
              {
                geometry: { coordinates: [-47.1, -22.95] },
                properties: {
                  name: 'Rua Doutor Herculano Gouvêa Neto',
                  type: 'street',
                  city: 'Campinas',
                  countrycode: 'BR',
                },
              },
              // Outra rua parecida não vale.
              {
                geometry: { coordinates: [-47.0, -22.9] },
                properties: { name: 'Rua Herculano', type: 'street', countrycode: 'BR' },
              },
            ]
          : [],
    );
    expect(await geocoder().locate(addr, ctx)).toMatchObject({ precision: 'street', lng: -47.1 });
  });

  it('sem a rua, vai para o bairro sem "Loteamento", depois a cidade', async () => {
    fakeNet((p) =>
      p.get('q') === 'Parque São Martinho, Campinas, SP'
        ? [
            {
              lat: '-22.94',
              lon: '-47.09',
              display_name: 'Parque São Martinho',
              addresstype: 'suburb',
            },
          ]
        : [],
    );
    expect(await geocoder().locate(addr, ctx)).toMatchObject({ precision: 'district' });

    fakeNet((p) =>
      p.get('city') === 'Campinas' && !p.get('street')
        ? [{ lat: '-22.9', lon: '-47.06', display_name: 'Campinas', addresstype: 'city' }]
        : [],
    );
    expect(await geocoder().locate({ ...addr, street: 'Rua Nova' }, ctx)).toMatchObject({
      precision: 'city',
    });
  });

  it('nada achado ou mapa fora do ar: devolve a loja para o cliente marcar', async () => {
    fakeNet(() => []);
    expect(await geocoder().locate(addr, ctx)).toEqual({
      ...STORE,
      label: 'Loja',
      precision: 'store',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({}, 503)),
    );
    expect(await geocoder().locate(addr, ctx)).toMatchObject({ precision: 'store' });
  });

  it('descarta a mesma rua em outra cidade, longe da loja', async () => {
    fakeNet((p) =>
      p.get('street')
        ? [{ ...ROAD, lat: '-23.55', lon: '-46.63', address: { house_number: '460' } }]
        : [],
    );
    expect((await geocoder().locate(addr, ctx))?.precision).toBe('store');
  });

  it('o CEP corrige a grafia da rua e a cidade', async () => {
    const lookup = vi.fn(async () => ({
      cep: '13000000',
      street: 'Rua Doutor Herculano Gouvêa Neto',
      district: 'Parque São Martinho',
      city: 'Campinas',
      state: 'SP',
    }));
    fakeNet((p) =>
      p.get('street') === '460 Rua Doutor Herculano Gouvêa Neto'
        ? [{ ...ROAD, address: { house_number: '460' } }]
        : [],
    );
    const r = await geocoder({ lookup }).locate(
      { street: 'R Dr Herculano', number: '460', cep: '13000-000' },
      { near: STORE },
    );
    expect(lookup).toHaveBeenCalledWith('13000000');
    expect(r?.precision).toBe('house');
  });

  it('guarda a resposta em cache', async () => {
    const calls = fakeNet((p) =>
      p.get('street') ? [{ ...ROAD, address: { house_number: '460' } }] : [],
    );
    const g = geocoder();
    await g.locate(addr, ctx);
    const n = calls.length;
    await g.locate(addr, ctx);
    expect(calls.length).toBe(n);
  });
});
