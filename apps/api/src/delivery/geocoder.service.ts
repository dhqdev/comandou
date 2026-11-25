import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { CepService, fold } from '../store/cep.service';
import { distanceM } from './zones';

export interface GeoResult {
  lat: number;
  lng: number;
  label: string;
}

/**
 * Quanto o ponto achado diz do endereço: a casa, só a rua, só o bairro, só a cidade, ou nada
 * (ponto da loja, para o cliente marcar no mapa).
 */
export type GeoPrecision = 'house' | 'street' | 'district' | 'city' | 'store';

export interface Located extends GeoResult {
  precision: GeoPrecision;
}

export interface AddressQuery {
  street: string;
  number?: string;
  district?: string;
  city?: string;
  state?: string;
  cep?: string;
}

const CACHE_MAX = 500;
const CACHE_TTL_MS = 24 * 3_600_000;
/** "Não achei" fica pouco tempo: a base do OpenStreetMap muda e a busca pode ter falhado. */
const MISS_TTL_MS = 3_600_000;
/** A política de uso do Nominatim público pede no máximo 1 consulta por segundo. */
const MIN_INTERVAL_MS = 1_100;
/** Tempo máximo procurando um endereço; depois disso o cliente marca no mapa. */
const LOCATE_BUDGET_MS = 9_000;
/** Ponto achado mais longe que isso da loja é outra rua com o mesmo nome em outra cidade. */
const MAX_FROM_STORE_M = 80_000;

const STREET_TYPE =
  /^(rua|r|avenida|av|travessa|tv|trav|alameda|al|estrada|est|rodovia|rod|praca|praça|pca|pc|largo|lgo|viela|beco|via|servidao|servidão|passagem|ladeira)\.?\s+/i;
/** Títulos que o cadastro da rua pode ter por extenso, abreviado ou sem ("Dr.", "Doutor"). */
const TITLES = new Set(
  'doutor dr dra doutora professor prof profa professora engenheiro eng coronel cel general gal presidente pres padre pe monsenhor mons dom senador sen deputado dep vereador ver capitao cap tenente ten sargento sgt major maj marechal mal comendador com desembargador des ministro min governador gov prefeito pref brigadeiro brig almirante alm frei'.split(
    ' ',
  ),
);
const STOP = new Set('de da do das dos e'.split(' '));
/** Prefixos que o loteamento usa no papel e o mapa quase nunca tem ("Loteamento Parque…"). */
const DISTRICT_PREFIX =
  /^(loteamento|lot|conjunto habitacional|conj habitacional|conjunto|conj|cj|residencial|res|condominio|condomínio|cond|nucleo|núcleo|nucleo habitacional|chacaras|chácaras|chacara|chácara)\.?\s+/i;

const clean = (s: string | undefined) =>
  (s ?? '')
    .replace(/[^\p{L}\p{N}\s.,'/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

/** "Rua Doutor Herculano Gouvea Neto" → "Herculano Gouvea Neto" (sem tipo e sem títulos). */
export function streetCore(street: string): string {
  const s = clean(street).replace(STREET_TYPE, '');
  const words = s.split(' ').filter(Boolean);
  const core = words.filter((w) => !TITLES.has(fold(w).replace(/\./g, '')));
  // "Rua São Paulo": sem o título sobra pouco; fica o nome inteiro.
  return core.filter((w) => !STOP.has(fold(w))).join('').length >= 4 ? core.join(' ') : s;
}

/** Palavras do nome que precisam aparecer na rua achada (sem acento, título ou preposição). */
export function streetTokens(street: string): string[] {
  return fold(streetCore(street))
    .split(/[\s.,'/-]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !TITLES.has(w));
}

/** A rua achada é a mesma que o cliente digitou? (a maior parte das palavras do nome bate) */
export function sameStreet(typed: string, found: string): boolean {
  const want = streetTokens(typed);
  if (!want.length) return false;
  const have = new Set(fold(found).split(/[\s.,'/-]+/));
  const hits = want.filter((w) => have.has(w)).length;
  return hits >= Math.max(1, Math.ceil(want.length * 0.66));
}

/** Bairro como o mapa costuma chamar: sem "Loteamento", "Residencial", "Conjunto"… */
export function districtVariants(district: string | undefined): string[] {
  const d = clean(district);
  if (d.length < 3) return [];
  const bare = d.replace(DISTRICT_PREFIX, '').trim();
  return bare && bare !== d && bare.length >= 3 ? [d, bare] : [d];
}

interface NominatimRow {
  lat: string;
  lon: string;
  display_name: string;
  category?: string;
  type?: string;
  addresstype?: string;
  name?: string;
  address?: Record<string, string>;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    locality?: string;
    city?: string;
    state?: string;
    countrycode?: string;
    type?: string;
  };
}

/**
 * Busca de endereço (endereço → coordenadas) no OpenStreetMap: Nominatim, com o Photon (busca
 * tolerante a erros de digitação, sobre a mesma base) de reserva. Passa pela API para não abrir o
 * navegador do cliente para outro domínio, para respeitar o limite de 1 consulta/s do Nominatim e
 * para guardar em cache as buscas repetidas. O servidor pode trocar por instâncias próprias com
 * GEOCODER_URL e PHOTON_URL (vazio desliga o Photon).
 */
/** Máximo de buscas esperando a vez no Nominatim (1 por segundo): ~15 s de espera no pior caso. */
const GEOCODE_QUEUE_MAX = 15;

@Injectable()
export class GeocoderService {
  private readonly log = new Logger('Geocoder');
  private readonly cache = new Map<string, { at: number; ttl: number; value: unknown }>();
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;
  /** Consultas esperando a vez (1/s). Fila cheia falha na hora, como o Nominatim fora do ar. */
  private waiting = 0;
  /** Intervalo entre consultas ao Nominatim (os testes zeram). */
  intervalMs = MIN_INTERVAL_MS;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Optional() private readonly cep?: CepService,
  ) {}

  /** Busca solta (a equipe marcando a loja no mapa). Lança 503 se o serviço não responder. */
  async search(query: string, near?: { lat: number; lng: number }): Promise<GeoResult[]> {
    const q = query.trim().replace(/\s+/g, ' ').slice(0, 200);
    if (q.length < 3) return [];
    const key = `${q.toLowerCase()}|${nearKey(near)}`;
    const hit = this.hit<GeoResult[]>(key);
    if (hit) return hit.value;
    const rows = await this.nominatim({ q }, near).catch((e: Error) => {
      this.log.warn(`busca de endereço falhou: ${e.message}`);
      throw new ServiceUnavailableException(
        'A busca de endereço no mapa não respondeu. Tente de novo ou use a sua localização.',
      );
    });
    const value = rows.map(({ lat, lng, label }) => ({ lat, lng, label }));
    this.keep(key, value, CACHE_TTL_MS);
    return value;
  }

  /**
   * Endereço do cliente → melhor ponto no mapa, em etapas: a casa (rua e número), a rua, o
   * bairro, a cidade. Nunca falha: sem nada, devolve o ponto da loja (`store`) para o cliente
   * marcar a casa no mapa. O CEP corrige a grafia da rua, do bairro e a cidade.
   */
  async locate(
    input: AddressQuery,
    ctx: {
      near?: { lat: number; lng: number };
      /** Outros pontos onde a loja atende (centro das áreas de entrega). */
      refs?: { lat: number; lng: number }[];
      city?: string | null;
      state?: string | null;
    },
  ): Promise<Located | null> {
    const deadline = Date.now() + LOCATE_BUDGET_MS;
    let a = {
      street: clean(input.street),
      number: clean(input.number).replace(/^(n[ºo°]?|num|número|numero)\.?\s*/i, ''),
      district: clean(input.district),
      city: clean(input.city) || clean(ctx.city ?? ''),
      state: clean(input.state).toUpperCase() || (ctx.state ?? '').toUpperCase(),
    };
    const cepDigits = (input.cep ?? '').replace(/\D/g, '');
    // Cidade que o cliente digitou ou que veio do CEP: o resultado tem de ser nela.
    let ownCity = !!clean(input.city);
    const key = `loc|${fold([a.street, a.number, a.district, a.city, a.state, cepDigits].join('|'))}|${nearKey(ctx.near)}|${(ctx.refs ?? []).map((r) => nearKey(r)).join(';')}`;
    const hit = this.hit<Located | null>(key);
    if (hit) return hit.value;

    // CEP de rua: a grafia oficial (ViaCEP) ajuda quando o cliente abreviou ou errou a rua.
    const streets = [a.street];
    if (cepDigits.length === 8 && this.cep) {
      const c = await this.cep.lookup(cepDigits).catch(() => null);
      if (c) {
        if (c.street && fold(c.street) !== fold(a.street)) streets.unshift(c.street);
        if (c.city) ownCity = true;
        a = {
          ...a,
          street: a.street || c.street,
          district: a.district || c.district,
          city: c.city || a.city,
          state: c.state || a.state,
        };
      }
    }

    const near = ctx.near;
    const refs = [...(near ? [near] : []), ...(ctx.refs ?? [])];
    // O resultado é na cidade do endereço? Com a cidade do cliente (ou do CEP) é o que decide:
    // uma loja de São Paulo pode entregar em Campinas, e a mesma rua existe em outras cidades.
    // Com a cidade só da loja, vale também estar perto da loja ou de uma área de entrega.
    const inCity = (label: string) => !!a.city && inPlace(label, a.city, a.state);
    const nearby = (p: { lat: number; lng: number }) =>
      !refs.length ||
      refs.some((r) => distanceM([r.lat, r.lng], [p.lat, p.lng]) <= MAX_FROM_STORE_M);
    const ok = (p: { lat: number; lng: number; label: string }) =>
      inCity(p.label) || (!(ownCity && a.city) && nearby(p));
    const where = [a.city, a.state].filter(Boolean).join(', ');
    const time = () => Date.now() < deadline;
    let found: Located | null = null;
    let failures = 0;
    const tryStep = async (fn: () => Promise<Located | null>) => {
      if (found || !time()) return;
      try {
        found = await fn();
      } catch (e) {
        failures++;
        this.log.warn(`busca de endereço falhou: ${(e as Error).message}`);
      }
    };

    // 1. A casa: Nominatim estruturado (rua + número + cidade) e Photon ao mesmo tempo.
    for (const street of streets.filter(Boolean)) {
      if (found || !time()) break;
      const houseStreet = a.number ? `${a.number} ${street}` : street;
      const [n, p] = await Promise.allSettled([
        a.city
          ? this.nominatim(
              { street: houseStreet, city: a.city, state: a.state, country: 'Brasil' },
              near,
            )
          : this.nominatim({ q: [houseStreet, a.district].filter(Boolean).join(', ') }, near),
        this.photon([street, a.number, a.district, a.city].filter(Boolean).join(' '), near),
      ]);
      const nRows = n.status === 'fulfilled' ? n.value.filter(ok) : [];
      const pRows =
        p.status === 'fulfilled'
          ? p.value.filter((r) => ok(r) && r.precision !== 'city' && sameStreet(street, r.label))
          : [];
      if (n.status === 'rejected' && p.status === 'rejected') failures++;
      const all = [...nRows, ...pRows];
      found =
        all.find((r) => r.precision === 'house') ??
        all.find((r) => r.precision === 'street') ??
        null;
    }

    // 2. A rua sem o número e sem títulos ("Herculano Gouvea Neto, Campinas, SP").
    for (const street of streets.filter(Boolean)) {
      const core = streetCore(street);
      for (const q of [
        [street, where].filter(Boolean).join(', '),
        core !== street ? [core, where].filter(Boolean).join(', ') : '',
      ].filter(Boolean))
        await tryStep(async () => {
          const rows = (await this.nominatim({ q }, near)).filter(
            (r) => ok(r) && sameStreet(street, r.label),
          );
          const r = rows[0];
          return r ? { ...r, precision: r.precision === 'house' ? 'street' : r.precision } : null;
        });
    }

    // 3. O bairro ("Parque São Martinho, Campinas, SP"): o cliente arrasta o pino até a casa.
    for (const d of districtVariants(a.district))
      await tryStep(async () => {
        const r = (await this.nominatim({ q: [d, where].filter(Boolean).join(', ') }, near)).find(
          ok,
        );
        return r ? { ...r, precision: 'district' } : null;
      });

    // 4. A cidade.
    if (a.city)
      await tryStep(async () => {
        const r = (
          await this.nominatim({ city: a.city, state: a.state, country: 'Brasil' }, near)
        ).find(ok);
        return r ? { ...r, precision: 'city' } : null;
      });

    // 5. Nada: o ponto da loja, para o cliente marcar no mapa.
    const value: Located | null =
      found ?? (near ? { ...near, label: 'Loja', precision: 'store' } : null);
    // Resposta incompleta (serviço fora ou tempo esgotado) não fica no cache.
    const complete = time() && failures === 0;
    if (found || complete)
      this.keep(
        key,
        value,
        (found as Located | null)?.precision === 'house' ? CACHE_TTL_MS : MISS_TTL_MS,
      );
    return value;
  }

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
    this.cache.delete(key);
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: Date.now(), ttl, value });
  }

  private throttled<T>(fn: () => Promise<T>): Promise<T> {
    // Muitas buscas de endereço únicas (de propósito ou não) faziam a fila crescer sem fim e a
    // finalização de todos os restaurantes esperava minutos. Passou do limite: o cliente marca o
    // ponto no mapa, como quando o serviço não responde.
    if (this.waiting >= GEOCODE_QUEUE_MAX)
      return Promise.reject(new Error('Busca de endereço ocupada agora'));
    this.waiting++;
    const run = this.queue.then(async () => {
      this.waiting--;
      const wait = this.last + this.intervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Uma consulta ao Nominatim (livre com `q` ou estruturada), com cache e 1 consulta/s. */
  private async nominatim(
    params: Record<string, string>,
    near?: { lat: number; lng: number },
  ): Promise<Located[]> {
    const p = Object.fromEntries(Object.entries(params).filter(([, v]) => v?.trim()));
    const key = `nom|${fold(JSON.stringify(p))}|${nearKey(near)}`;
    const hit = this.hit<Located[]>(key);
    if (hit) return hit.value;
    const url = new URL('/search', this.env.GEOCODER_URL);
    for (const [k, v] of Object.entries(p)) url.searchParams.set(k, v);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '5');
    url.searchParams.set('countrycodes', 'br');
    url.searchParams.set('accept-language', 'pt-BR');
    if (near) {
      // Prefere resultados perto da loja (~40 km), sem excluir os de fora.
      const d = 0.35;
      url.searchParams.set(
        'viewbox',
        [near.lng - d, near.lat + d, near.lng + d, near.lat - d].map((n) => n.toFixed(5)).join(','),
      );
    }
    const rows = await this.throttled(async () => {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Comandou/1.0 (+https://comandou.com)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
      return (await res.json()) as NominatimRow[];
    });
    const value = (Array.isArray(rows) ? rows : [])
      .map((r) => ({
        lat: Number(r.lat),
        lng: Number(r.lon),
        label: r.display_name ?? '',
        precision: nominatimPrecision(r),
      }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    this.keep(key, value, value.length ? CACHE_TTL_MS : MISS_TTL_MS);
    return value;
  }

  /** Photon (komoot): mesma base do OpenStreetMap, mas aceita palavra a mais ou com erro. */
  private async photon(q: string, near?: { lat: number; lng: number }): Promise<Located[]> {
    if (!this.env.PHOTON_URL || q.trim().length < 3) return [];
    const key = `pho|${fold(q)}|${nearKey(near)}`;
    const hit = this.hit<Located[]>(key);
    if (hit) return hit.value;
    const url = new URL('/api/', this.env.PHOTON_URL);
    url.searchParams.set('q', q.slice(0, 200));
    url.searchParams.set('limit', '5');
    if (near) {
      url.searchParams.set('lat', near.lat.toFixed(5));
      url.searchParams.set('lon', near.lng.toFixed(5));
    }
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Comandou/1.0 (+https://comandou.com)', Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
    const body = (await res.json()) as { features?: PhotonFeature[] };
    const value = (body.features ?? [])
      .filter((f) => (f.properties?.countrycode ?? 'BR').toUpperCase() === 'BR')
      .map((f) => {
        const pr = f.properties ?? {};
        const [lng, lat] = f.geometry?.coordinates ?? [NaN, NaN];
        const road = pr.type === 'street' ? pr.name : pr.street;
        const label = [
          road && pr.housenumber ? `${road}, ${pr.housenumber}` : (road ?? pr.name),
          pr.district ?? pr.locality,
          pr.city,
          pr.state,
        ]
          .filter(Boolean)
          .join(', ');
        const precision: GeoPrecision =
          pr.housenumber && pr.street
            ? 'house'
            : pr.type === 'street'
              ? 'street'
              : pr.type === 'city'
                ? 'city'
                : 'district';
        return { lat: Number(lat), lng: Number(lng), label, precision };
      })
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    this.keep(key, value, value.length ? CACHE_TTL_MS : MISS_TTL_MS);
    return value;
  }
}

function nominatimPrecision(r: NominatimRow): GeoPrecision {
  if (r.address?.house_number) return 'house';
  if (r.category === 'highway' || r.addresstype === 'road') return 'street';
  if (['city', 'town', 'municipality', 'village'].includes(r.addresstype ?? r.type ?? ''))
    return 'city';
  // Resposta sem detalhes (instância antiga ou de teste): trata como rua.
  if (!r.addresstype && !r.category && !r.address) return 'street';
  return 'district';
}

const UF_NAME: Record<string, string> = {
  AC: 'acre',
  AL: 'alagoas',
  AP: 'amapa',
  AM: 'amazonas',
  BA: 'bahia',
  CE: 'ceara',
  DF: 'distrito federal',
  ES: 'espirito santo',
  GO: 'goias',
  MA: 'maranhao',
  MT: 'mato grosso',
  MS: 'mato grosso do sul',
  MG: 'minas gerais',
  PA: 'para',
  PB: 'paraiba',
  PR: 'parana',
  PE: 'pernambuco',
  PI: 'piaui',
  RJ: 'rio de janeiro',
  RN: 'rio grande do norte',
  RS: 'rio grande do sul',
  RO: 'rondonia',
  RR: 'roraima',
  SC: 'santa catarina',
  SP: 'sao paulo',
  SE: 'sergipe',
  TO: 'tocantins',
};

/**
 * O endereço achado fica nesta cidade (e UF)? Compara as partes do rótulo ("Rua X, Bairro,
 * Campinas, São Paulo, Brasil"): uma parte tem de ser a cidade inteira, para "Campinas" não
 * aceitar "Campinas do Sul".
 */
export function inPlace(label: string, city: string, state?: string): boolean {
  const parts = label.split(',').map((p) => fold(p).replace(/\s+/g, ' ').trim());
  const c = fold(city).replace(/\s+/g, ' ').trim();
  if (!c || !parts.includes(c)) return false;
  const uf = (state ?? '').trim().toUpperCase();
  const name = UF_NAME[uf];
  if (!name) return true;
  // O rótulo traz o estado por extenso ("São Paulo") ou a sigla ("SP"); sem estado no rótulo, vale.
  const states = new Set(Object.values(UF_NAME));
  const ufs = new Set(Object.keys(UF_NAME).map((k) => k.toLowerCase()));
  const named = parts.filter((p) => states.has(p) || ufs.has(p));
  return !named.length || named.some((p) => p === name || p === uf.toLowerCase());
}

const nearKey = (near?: { lat: number; lng: number }) =>
  near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : '';
