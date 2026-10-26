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

/**
 * Consulta de CEP do cardápio online: CEP → endereço e rua → CEP. Passa pela API para o navegador
 * do cliente não falar com outro domínio (a política de segurança só deixa falar com a própria
 * loja) e para guardar em cache as consultas repetidas. ViaCEP primeiro; BrasilAPI de reserva.
 */
@Injectable()
export class CepService {
  private readonly log = new Logger('Cep');
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(@Inject(ENV) private readonly env: Env) {}

  private async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
    const value = await fn();
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async get(url: URL): Promise<{ status: number; body: unknown }> {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Comandou/1.0 (+https://comandou.com)' },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  /** Endereço do CEP, ou null se o CEP não existe. */
  lookup(raw: string): Promise<CepAddress | null> {
    const cep = cepDigits(raw);
    if (cep.length !== 8) return Promise.resolve(null);
    return this.cached(`cep:${cep}`, async () => {
      try {
        const r = await this.get(new URL(`/ws/${cep}/json/`, this.env.VIACEP_URL));
        if (r.status === 200) return fromViaCep(r.body as Record<string, unknown>);
        if (r.status !== 400) throw new Error(`HTTP ${r.status}`);
        return null;
      } catch (e) {
        this.log.warn(`ViaCEP falhou (${(e as Error).message}); tentando a BrasilAPI`);
      }
      try {
        const r = await this.get(new URL(`/api/cep/v1/${cep}`, this.env.BRASILAPI_URL));
        if (r.status === 404 || r.status === 400) return null;
        if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
        return fromBrasilApi(r.body as Record<string, unknown>);
      } catch (e) {
        this.log.warn(`BrasilAPI falhou: ${(e as Error).message}`);
        throw new ServiceUnavailableException(
          'A consulta de CEP não respondeu agora. Preencha o endereço à mão.',
        );
      }
    });
  }

  /** CEPs de uma rua na cidade (ViaCEP pede UF, cidade e pelo menos 3 letras da rua). */
  search(uf: string, city: string, street: string): Promise<CepAddress[]> {
    const u = uf.trim().toUpperCase();
    const c = city.trim().replace(/\s+/g, ' ').slice(0, 80);
    // A ViaCEP não aceita barra nem caracteres de URL no nome; tira o que não é letra/número.
    const s = street
      .trim()
      .replace(/[^\p{L}\p{N}\s.'-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 80);
    if (!isUf(u) || c.length < 3 || s.replace(/\s/g, '').length < 3) return Promise.resolve([]);
    const key = `rua:${u}|${c.toLowerCase()}|${s.toLowerCase()}`;
    return this.cached(key, async () => {
      try {
        const url = new URL(
          `/ws/${u}/${encodeURIComponent(c)}/${encodeURIComponent(s)}/json/`,
          this.env.VIACEP_URL,
        );
        const r = await this.get(url);
        if (r.status !== 200 || !Array.isArray(r.body)) return [];
        const seen = new Set<string>();
        return (r.body as Record<string, unknown>[])
          .map(fromViaCep)
          .filter((a): a is CepAddress => !!a && !seen.has(a.cep) && !!seen.add(a.cep))
          .slice(0, 8);
      } catch (e) {
        this.log.warn(`busca de CEP pela rua falhou: ${(e as Error).message}`);
        throw new ServiceUnavailableException(
          'A busca de CEP pela rua não respondeu agora. Digite o CEP ou preencha à mão.',
        );
      }
    });
  }
}
