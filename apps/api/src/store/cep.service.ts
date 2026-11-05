import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

export interface CepAddress {
  cep: string;
  street: string;
  district: string;
  city: string;
  state: string;
}

const CACHE_MAX = 2_000;
const CACHE_TTL_MS = 7 * 24 * 3_600_000;
/** "Não achei" fica pouco tempo no cache: a base dos serviços muda e a consulta pode ter falhado. */
const MISS_TTL_MS = 3_600_000;
const UFS = new Set(
  'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '),
);

export const cepDigits = (raw: string) => raw.replace(/\D/g, '');
export const isUf = (uf: string) => UFS.has(uf.toUpperCase());

/** Linha da ViaCEP → endereço. A ViaCEP responde { erro: true } (ou "true") para CEP inexistente. */
export function fromViaCep(r: Record<string, unknown>): CepAddress | null {
  if (!r || r.erro) return null;
  const cep = cepDigits(String(r.cep ?? ''));
  if (cep.length !== 8) return null;
  return {
    cep,
    street: String(r.logradouro ?? '').trim(),
    district: String(r.bairro ?? '').trim(),
    city: String(r.localidade ?? '').trim(),
    state: String(r.uf ?? '')
      .trim()
      .toUpperCase(),
  };
}

export function fromBrasilApi(r: Record<string, unknown>): CepAddress | null {
  const cep = cepDigits(String(r?.cep ?? ''));
  if (cep.length !== 8) return null;
  return {
    cep,
    street: String(r.street ?? '').trim(),
    district: String(r.neighborhood ?? '').trim(),
    city: String(r.city ?? '').trim(),
    state: String(r.state ?? '')
      .trim()
      .toUpperCase(),
  };
}

/** Sem acento e em minúsculas, para comparar nomes de rua. */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Tipo do logradouro no começo do que o cliente digitou ("Rua", "Av.", "Travessa"…). */
const STREET_TYPE =
  /^(rua|r|avenida|av|travessa|tv|trav|alameda|al|estrada|est|rodovia|rod|praca|pca|pc|largo|lgo|viela|vila|beco|via|servidao|passagem|ladeira|quadra|qd)\.?\s+/i;

/**
 * Jeitos de perguntar a rua para a ViaCEP, do mais fiel ao mais solto: como digitado, sem o tipo
 * ("Rua", "Av.") e sem acento. A ViaCEP casa por trecho do nome; "Av. Brasil" não acha
 * "Avenida Brasil", mas "Brasil" acha.
 */
export function streetQueries(street: string): string[] {
  const s = street
    .trim()
    .replace(/[^\p{L}\p{N}\s.'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim();
  const bare = s.replace(STREET_TYPE, '').trim();
  const plain = fold(bare).replace(/[.'-]/g, ' ').replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  for (const q of [s, bare, plain])
    if (q.replace(/\s/g, '').length >= 3 && !out.some((o) => o.toLowerCase() === q.toLowerCase()))
      out.push(q);
  return out;
}

/** Ruas que começam pelo que foi digitado vêm primeiro. */
export function rankStreets(list: CepAddress[], typed: string): CepAddress[] {
  const q = fold(typed.replace(STREET_TYPE, '').trim());
  const score = (a: CepAddress) => {
    const name = fold(a.street).replace(STREET_TYPE, '');
    return name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2;
  };
  return [...list].sort((a, b) => score(a) - score(b));
}

class Unavailable extends Error {}

/**
 * Consulta de CEP do cardápio online e do sistema: CEP → endereço e rua → CEP. Passa pela API
 * para guardar em cache as consultas repetidas. ViaCEP primeiro; BrasilAPI e OpenCEP de reserva.
 * Falha de rede, bloqueio (403/429) ou resposta que não é JSON nunca vira "CEP não encontrado".
 */
@Injectable()
export class CepService {
  private readonly log = new Logger('Cep');
  private readonly cache = new Map<string, { at: number; ttl: number; value: unknown }>();

  constructor(@Inject(ENV) private readonly env: Env) {}

  private hit<T>(key: string): { value: T } | null {
    const h = this.cache.get(key);
    if (!h) return null;
    if (Date.now() - h.at >= h.ttl) {
      this.cache.delete(key);
      return null;
    }
    return { value: h.value as T };
  }

  private keep(key: string, value: unknown, ttl: number) {
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: Date.now(), ttl, value });
  }

  /** GET com JSON. Lança `Unavailable` quando o serviço não respondeu direito. */
  private async get(url: URL): Promise<{ status: number; body: unknown }> {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Comandou/1.0 (+https://comandou.com)',
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (e) {
      throw new Unavailable((e as Error).message);
    }
    if (res.status >= 500 || res.status === 403 || res.status === 429)
      throw new Unavailable(`HTTP ${res.status}`);
    const text = await res.text().catch(() => '');
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Página de bloqueio/HTML no lugar do JSON.
      if (res.status === 200) throw new Unavailable('resposta não é JSON');
    }
    return { status: res.status, body };
  }

  private async viaCep(cep: string): Promise<CepAddress | null> {
    const r = await this.get(new URL(`/ws/${cep}/json/`, this.env.VIACEP_URL));
    if (r.status === 400 || r.status === 404) return null;
    if (r.status !== 200 || !r.body || typeof r.body !== 'object')
      throw new Unavailable(`HTTP ${r.status}`);
    return fromViaCep(r.body as Record<string, unknown>);
  }

  private async brasilApi(cep: string): Promise<CepAddress | null> {
    const r = await this.get(new URL(`/api/cep/v2/${cep}`, this.env.BRASILAPI_URL));
    if (r.status === 404 || r.status === 400) return null;
    if (r.status !== 200) throw new Unavailable(`HTTP ${r.status}`);
    return fromBrasilApi(r.body as Record<string, unknown>);
  }

  private async openCep(cep: string): Promise<CepAddress | null> {
    const r = await this.get(new URL(`/v1/${cep}`, this.env.OPENCEP_URL));
    if (r.status === 404 || r.status === 400) return null;
    if (r.status !== 200) throw new Unavailable(`HTTP ${r.status}`);
    return fromViaCep(r.body as Record<string, unknown>);
  }

  /** Endereço do CEP, ou null se nenhum serviço conhece o CEP. */
  async lookup(raw: string): Promise<CepAddress | null> {
    const cep = cepDigits(raw);
    if (cep.length !== 8) return null;
    const key = `cep:${cep}`;
    const c = this.hit<CepAddress | null>(key);
    if (c) return c.value;
    const providers: [string, (cep: string) => Promise<CepAddress | null>][] = [
      ['ViaCEP', (x) => this.viaCep(x)],
      ['BrasilAPI', (x) => this.brasilApi(x)],
      ['OpenCEP', (x) => this.openCep(x)],
    ];
    // Todos ao mesmo tempo: o primeiro que achar o CEP responde. Um serviço lento ou bloqueado
    // não segura a resposta (antes eram até 15 s, um atrás do outro).
    const a = await new Promise<CepAddress | null | undefined>((resolve) => {
      let pending = providers.length;
      let answered = false;
      for (const [name, fn] of providers)
        fn(cep)
          .then((r) => {
            answered = true;
            if (r) resolve(r);
          })
          .catch((e) => this.log.warn(`${name} falhou no CEP (${(e as Error).message})`))
          .finally(() => {
            if (--pending === 0) resolve(answered ? null : undefined);
          });
    });
    if (a === undefined)
      throw new ServiceUnavailableException(
        'A consulta de CEP não respondeu agora. Preencha o endereço à mão.',
      );
    this.keep(key, a, a ? CACHE_TTL_MS : MISS_TTL_MS);
    return a;
  }

  /** CEPs de uma rua na cidade (ViaCEP pede UF, cidade e pelo menos 3 letras da rua). */
  async search(uf: string, city: string, street: string): Promise<CepAddress[]> {
    const u = uf.trim().toUpperCase();
    const ct = city.trim().replace(/\s+/g, ' ').slice(0, 80);
    const queries = streetQueries(street);
    if (!isUf(u) || ct.length < 3 || !queries.length) return [];
    const key = `rua:${u}|${fold(ct)}|${fold(queries[0])}`;
    const c = this.hit<CepAddress[]>(key);
    if (c) return c.value;
    // Cidade digitada sem acento ("Sao Paulo") também vale.
    const cities = [ct, fold(ct)].filter((v, i, a) => a.indexOf(v) === i);
    try {
      for (const q of queries)
        for (const cityQ of cities) {
          const url = new URL(
            `/ws/${u}/${encodeURIComponent(cityQ)}/${encodeURIComponent(q)}/json/`,
            this.env.VIACEP_URL,
          );
          const r = await this.get(url);
          if (r.status === 400 || r.status === 404) continue;
          if (r.status !== 200 || !Array.isArray(r.body)) throw new Unavailable(`HTTP ${r.status}`);
          const seen = new Set<string>();
          const list = (r.body as Record<string, unknown>[])
            .map(fromViaCep)
            .filter((a): a is CepAddress => !!a && !seen.has(a.cep) && !!seen.add(a.cep));
          if (list.length) {
            const top = rankStreets(list, street).slice(0, 10);
            this.keep(key, top, CACHE_TTL_MS);
            return top;
          }
        }
    } catch (e) {
      this.log.warn(`busca de CEP pela rua falhou: ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        'A busca de CEP pela rua não respondeu agora. Digite o CEP ou preencha à mão.',
      );
    }
    this.keep(key, [], MISS_TTL_MS);
    return [];
  }
}
