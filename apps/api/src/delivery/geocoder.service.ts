import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

export interface GeoResult {
  lat: number;
  lng: number;
  label: string;
}

const CACHE_MAX = 500;
const CACHE_TTL_MS = 24 * 3_600_000;
/** A política de uso do Nominatim público pede no máximo 1 consulta por segundo. */
const MIN_INTERVAL_MS = 1_100;

/**
 * Busca de endereço (endereço → coordenadas) no OpenStreetMap (Nominatim). Passa pela API para
 * não abrir o navegador do cliente para outro domínio, para respeitar o limite de 1 consulta/s
 * e para guardar em cache as buscas repetidas. O servidor pode trocar por um Nominatim próprio
 * com GEOCODER_URL.
 */
@Injectable()
export class GeocoderService {
  private readonly log = new Logger('Geocoder');
  private readonly cache = new Map<string, { at: number; value: GeoResult[] }>();
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async search(query: string, near?: { lat: number; lng: number }): Promise<GeoResult[]> {
    const q = query.trim().replace(/\s+/g, ' ').slice(0, 200);
    if (q.length < 3) return [];
    const key = `${q.toLowerCase()}|${near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : ''}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = await this.throttled(() => this.fetch(q, near));
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.last + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async fetch(q: string, near?: { lat: number; lng: number }): Promise<GeoResult[]> {
    const url = new URL('/search', this.env.GEOCODER_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
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
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Comandou/1.0 (+https://comandou.com)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
      return rows
        .map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: r.display_name }))
        .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    } catch (e) {
      this.log.warn(`busca de endereço falhou: ${(e as Error).message}`);
      throw new ServiceUnavailableException(
        'A busca de endereço no mapa não respondeu. Tente de novo ou use a sua localização.',
      );
    }
  }
}
