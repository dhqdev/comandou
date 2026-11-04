import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import {
  CepService,
  fromBrasilApi,
  fromViaCep,
  isUf,
  rankStreets,
  streetQueries,
} from './cep.service';

const env = {
  VIACEP_URL: 'https://viacep.test',
  BRASILAPI_URL: 'https://brasilapi.test',
  OPENCEP_URL: 'https://opencep.test',
} as Env;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const SE = {
  cep: '01001-000',
  logradouro: 'Praça da Sé',
  bairro: 'Sé',
  localidade: 'São Paulo',
  uf: 'SP',
};

describe('CEP', () => {
  it('lê a resposta da ViaCEP', () => {
    expect(
      fromViaCep({
        cep: '01001-000',
        logradouro: 'Praça da Sé',
        bairro: 'Sé',
        localidade: 'São Paulo',
        uf: 'sp',
      }),
    ).toEqual({
      cep: '01001000',
      street: 'Praça da Sé',
      district: 'Sé',
      city: 'São Paulo',
      state: 'SP',
    });
  });
  it('CEP inexistente (erro) e resposta inválida viram null', () => {
    expect(fromViaCep({ erro: 'true' })).toBeNull();
    expect(fromViaCep({ cep: '123' })).toBeNull();
  });
  it('lê a resposta da BrasilAPI', () => {
    expect(
      fromBrasilApi({
        cep: '01001000',
        street: 'Praça da Sé',
        neighborhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
      })?.district,
    ).toBe('Sé');
  });
  it('valida a UF', () => {
    expect(isUf('sp')).toBe(true);
    expect(isUf('XX')).toBe(false);
  });
});

describe('CepService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ViaCEP bloqueada (HTML/403) não vira "CEP não encontrado": cai na BrasilAPI', async () => {
    const fetch = vi.fn(async (u: URL) => {
      if (u.host === 'viacep.test') return new Response('<html>bloqueado</html>', { status: 200 });
      return json({
        cep: '01001000',
        street: 'Praça da Sé',
        neighborhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
      });
    });
    vi.stubGlobal('fetch', fetch);
    const a = await new CepService(env).lookup('01001-000');
    expect(a?.street).toBe('Praça da Sé');
    expect(String(fetch.mock.calls[1][0])).toContain('/api/cep/v2/01001000');
  });

  it('CEP que a ViaCEP não conhece ainda tenta os outros', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: URL) =>
        u.host === 'viacep.test'
          ? json({ erro: 'true' })
          : u.host === 'brasilapi.test'
            ? json({ message: 'não achei' }, 404)
            : json(SE),
      ),
    );
    expect((await new CepService(env).lookup('01001000'))?.district).toBe('Sé');
  });

  it('todos fora do ar: 503 e nada fica no cache', async () => {
    const fetch = vi.fn(async () => json({}, 503));
    vi.stubGlobal('fetch', fetch);
    const s = new CepService(env);
    await expect(s.lookup('01001000')).rejects.toThrow(/não respondeu/);
    fetch.mockImplementation(async () => json(SE));
    expect((await s.lookup('01001000'))?.city).toBe('São Paulo');
  });

  it('acha o CEP pela rua mesmo com "Av." e sem acento', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: URL) => {
        asked.push(decodeURIComponent(u.pathname));
        return u.pathname.endsWith('/Paulista/json/')
          ? json([
              { ...SE, cep: '01311-000', logradouro: 'Avenida Paulista', bairro: 'Bela Vista' },
              { ...SE, cep: '01310-100', logradouro: 'Avenida Paulista', bairro: 'Bela Vista' },
            ])
          : json([]);
      }),
    );
    const r = await new CepService(env).search('sp', 'São Paulo', 'Av. Paulista');
    expect(r.map((a) => a.cep)).toEqual(['01311000', '01310100']);
    expect(asked[0]).toBe('/ws/SP/São Paulo/Av. Paulista/json/');
  });

  it('busca pela rua com a ViaCEP fora do ar responde 503 (não "nenhuma rua")', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html/>', { status: 200 })),
    );
    await expect(new CepService(env).search('SP', 'São Paulo', 'Paulista')).rejects.toThrow(
      /não respondeu/,
    );
  });
});

describe('rua digitada', () => {
  it('gera as variações da busca', () => {
    expect(streetQueries('Av. São João')).toEqual(['Av. São João', 'São João', 'sao joao']);
    expect(streetQueries('Rua Augusta')).toEqual(['Rua Augusta', 'Augusta']);
    expect(streetQueries('ab')).toEqual([]);
  });
  it('põe primeiro as ruas que começam pelo que foi digitado', () => {
    const a = (street: string) => ({ cep: '1', street, district: '', city: '', state: '' });
    expect(
      rankStreets([a('Rua Nova Brasil'), a('Avenida Brasil')], 'av brasil').map((x) => x.street),
    ).toEqual(['Avenida Brasil', 'Rua Nova Brasil']);
  });
});
