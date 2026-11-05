import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

/** Endereço que a consulta de CEP devolve. */
export interface CepAddress {
  cep: string;
  street: string;
  district: string;
  city: string;
  state: string;
}

/** CEP enquanto digita: 00000-000. */
export function maskCep(raw: string) {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

const VIACEP = 'https://viacep.com.br';
const BRASILAPI = 'https://brasilapi.com.br';

function fromViaCep(r: Record<string, unknown> | null): CepAddress | null {
  if (!r || r.erro) return null;
  const cep = String(r.cep ?? '').replace(/\D/g, '');
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

function fromBrasilApi(r: Record<string, unknown> | null): CepAddress | null {
  const cep = String(r?.cep ?? '').replace(/\D/g, '');
  if (!r || cep.length !== 8) return null;
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

/** Painel Super Admin tem a própria rota de CEP (lá não existe loja). */
const base = () =>
  typeof window !== 'undefined' && window.location.hostname.startsWith('admin.')
    ? '/platform/cep'
    : '/store/cep';

/** GET direto do navegador. `undefined` = o serviço não respondeu direito. */
async function direct(url: string): Promise<{ status: number; body: unknown } | undefined> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (res.status >= 500 || res.status === 403 || res.status === 429) return undefined;
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return undefined;
  }
}

/** O próprio navegador pergunta à ViaCEP e à BrasilAPI (null = nenhuma conhece o CEP). */
async function lookupDirect(digits: string): Promise<CepAddress | null | undefined> {
  const [via, br] = await Promise.all([
    direct(`${VIACEP}/ws/${digits}/json/`).then((r) =>
      r && (r.status === 200 || r.status === 400 || r.status === 404)
        ? fromViaCep(r.body as Record<string, unknown>)
        : undefined,
    ),
    direct(`${BRASILAPI}/api/cep/v1/${digits}`).then((r) =>
      r && (r.status === 200 || r.status === 400 || r.status === 404)
        ? fromBrasilApi(r.body as Record<string, unknown>)
        : undefined,
    ),
  ]);
  if (via || br) return via || br;
  return via === undefined && br === undefined ? undefined : null;
}

/**
 * Endereço do CEP (null = CEP não existe). Pergunta à API (cache + três serviços); se a API
 * falhar ou disser que não achou, o próprio navegador ainda pergunta à ViaCEP e à BrasilAPI
 * (o servidor pode estar bloqueado por esses serviços).
 */
export async function lookupCep(digits: string): Promise<CepAddress | null> {
  let apiError: unknown = null;
  try {
    return await api<CepAddress>(`${base()}/${digits}`);
  } catch (e) {
    apiError = e;
  }
  const d = await lookupDirect(digits);
  if (d !== undefined) return d;
  if (apiError instanceof ApiError && apiError.status === 404) return null;
  throw apiError;
}

/** CEPs de uma rua na cidade, com a mesma reserva pelo navegador. */
export async function searchStreet(
  street: string,
  city: string,
  state: string,
): Promise<CepAddress[]> {
  const qs = new URLSearchParams({ street, city, state });
  let apiError: unknown = null;
  try {
    const r = await api<CepAddress[]>(`${base()}?${qs}`);
    if (r.length) return r;
  } catch (e) {
    apiError = e;
  }
  // A API não achou ou não respondeu: tenta direto na ViaCEP com o que foi digitado e sem o
  // tipo da rua ("Rua", "Av."), que a ViaCEP não casa quando vem abreviado.
  const clean = street
    .replace(/[^\p{L}\p{N}\s.'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const bare = clean.replace(STREET_TYPE, '').trim();
  let answered = false;
  for (const q of [...new Set([clean, bare])].filter((x) => x.replace(/\s/g, '').length >= 3)) {
    const r = await direct(
      `${VIACEP}/ws/${state}/${encodeURIComponent(city)}/${encodeURIComponent(q)}/json/`,
    );
    if (!r) continue;
    answered = true;
    const seen = new Set<string>();
    const list = (Array.isArray(r.body) ? (r.body as Record<string, unknown>[]) : [])
      .map(fromViaCep)
      .filter((a): a is CepAddress => !!a && !seen.has(a.cep) && !!seen.add(a.cep))
      .slice(0, 10);
    if (list.length) return list;
  }
  if (apiError && !answered) throw apiError;
  return [];
}

/** Tipo do logradouro no começo do que foi digitado ("Rua", "Av.", "Travessa"…). */
const STREET_TYPE =
  /^(rua|r|avenida|av|travessa|tv|trav|alameda|al|estrada|est|rodovia|rod|praca|praça|pca|pc|largo|lgo|viela|vila|beco|via|servidao|servidão|passagem|ladeira|quadra|qd)\.?\s+/i;

export interface CepFields {
  cep: string;
  street: string;
  city: string;
  state: string;
}

export type CepState = 'idle' | 'busy' | 'ok' | 'missing' | 'error';

/**
 * Preenchimento do endereço nos dois sentidos: CEP completo → rua, bairro, cidade e UF; rua
 * digitada (com cidade e UF) → lista de CEPs para escolher (um só resultado já preenche ao sair
 * do campo). Tudo continua editável à mão.
 *
 * `onFill` recebe o endereço achado; quem usa decide em que campos ele cai.
 */
export function useCepAutofill(
  v: CepFields,
  onFill: (a: CepAddress, from: 'cep' | 'street') => void,
) {
  const [cepState, setCepState] = useState<CepState>('idle');
  const [hits, setHits] = useState<CepAddress[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  // Rua da última busca que terminou (para dizer "nenhuma rua" só depois de buscar).
  const [searched, setSearched] = useState('');
  const looked = useRef('');
  // Só busca CEP pela rua quando a pessoa digitou a rua (não quando o CEP a preencheu), e só
  // consulta o CEP que ela digitou (endereço salvo que acabou de carregar não é reescrito).
  const typedStreet = useRef(false);
  const typedCep = useRef(false);
  const cepSeq = useRef(0);
  const streetSeq = useRef(0);
  const fill = useRef(onFill);
  fill.current = onFill;

  const digits = v.cep.replace(/\D/g, '');
  useEffect(() => {
    if (digits.length < 8) {
      looked.current = '';
      setCepState('idle');
      return;
    }
    if (digits === looked.current || !typedCep.current) return;
    looked.current = digits;
    setCepState('busy');
    const my = ++cepSeq.current;
    lookupCep(digits)
      .then((a) => {
        if (my !== cepSeq.current) return;
        if (!a) return setCepState('missing');
        typedStreet.current = false;
        setOpen(false);
        setHits([]);
        setCepState('ok');
        fill.current(a, 'cep');
      })
      .catch(() => my === cepSeq.current && setCepState('error'));
  }, [digits]);

  const city = v.city.trim();
  const state = v.state.trim().toUpperCase();
  const canSearch = city.length >= 3 && /^[A-Z]{2}$/.test(state);
  useEffect(() => {
    const q = v.street.trim();
    if (!typedStreet.current || q.replace(/\s/g, '').length < 3 || !canSearch) {
      setHits([]);
      setOpen(false);
      setSearchError(false);
      return;
    }
    const t = setTimeout(() => {
      const my = ++streetSeq.current;
      setSearching(true);
      searchStreet(q, city, state)
        .then((r) => {
          if (my !== streetSeq.current || !typedStreet.current) return;
          setSearchError(false);
          setSearched(q);
          setHits(r);
          setOpen(r.length > 0);
        })
        .catch(() => {
          if (my !== streetSeq.current) return;
          setHits([]);
          setSearchError(true);
        })
        .finally(() => my === streetSeq.current && setSearching(false));
    }, 400);
    return () => clearTimeout(t);
  }, [v.street, city, state, canSearch]);

  function pick(a: CepAddress) {
    typedStreet.current = false;
    typedCep.current = false;
    looked.current = a.cep;
    streetSeq.current++;
    setOpen(false);
    setHits([]);
    setSearching(false);
    setCepState('ok');
    fill.current(a, 'street');
  }

  const q = v.street.trim();
  const streetHint = searching
    ? 'Procurando o CEP desta rua…'
    : searchError
      ? 'A busca pela rua não respondeu. Digite o CEP ou preencha à mão.'
      : typedStreet.current && !canSearch && q.length >= 3
        ? 'Para achar o CEP pela rua, preencha a cidade e a UF.'
        : typedStreet.current && canSearch && searched === q && !hits.length && !digits
          ? `Nenhuma rua com esse nome em ${city}. Confira ou digite o CEP.`
          : !digits && canSearch
            ? `Sem o CEP? Digite a rua: buscamos em ${city}.`
            : undefined;

  const cepHint =
    cepState === 'busy'
      ? 'Buscando o endereço…'
      : cepState === 'missing'
        ? 'CEP não encontrado. Confira ou preencha à mão.'
        : cepState === 'error'
          ? 'Não deu para consultar agora. Preencha à mão.'
          : cepState === 'ok'
            ? 'Endereço preenchido pelo CEP.'
            : 'Digite o CEP ou o nome da rua e a gente completa o endereço.';

  return {
    cepState,
    cepHint,
    streetHint,
    hits,
    open,
    setOpen,
    searching,
    pick,
    /** Chame no onChange do campo do CEP. */
    cepTyped() {
      typedCep.current = true;
    },
    /** Chame no onChange do campo da rua. */
    streetTyped() {
      typedStreet.current = true;
    },
    /** Chame no onBlur da rua: com um único CEP achado, ele já vale. */
    streetLeft() {
      setTimeout(() => {
        setOpen(false);
        if (typedStreet.current && hits.length === 1) pick(hits[0]);
      }, 150);
    },
  };
}

export interface StoreRegion {
  city: string | null;
  state: string | null;
}

let regionCache: Promise<StoreRegion | null> | null = null;

/**
 * Cidade e UF do restaurante (Loja online ou, sem ela, a empresa da nota fiscal): ponto de
 * partida para achar o CEP pela rua nos endereços digitados pela equipe.
 */
export function useStoreRegion(): StoreRegion | null {
  const [r, setR] = useState<StoreRegion | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hostname.startsWith('admin.')) return;
    regionCache ??= api<StoreRegion>('/store/region').catch(() => {
      regionCache = null;
      return null;
    });
    let alive = true;
    regionCache.then((x) => alive && setR(x));
    return () => {
      alive = false;
    };
  }, []);
  return r;
}

/** Consulta o CEP quando tem 8 dígitos (para formulários que só têm o campo do CEP). */
export function useCepLookup(raw: string, onFound?: (a: CepAddress) => void) {
  const [state, setState] = useState<CepState>('idle');
  const [address, setAddress] = useState<CepAddress | null>(null);
  const found = useRef(onFound);
  found.current = onFound;
  const digits = raw.replace(/\D/g, '');
  useEffect(() => {
    setAddress(null);
    if (digits.length !== 8) {
      setState('idle');
      return;
    }
    let alive = true;
    setState('busy');
    lookupCep(digits)
      .then((a) => {
        if (!alive) return;
        if (!a) return setState('missing');
        setState('ok');
        setAddress(a);
        found.current?.(a);
      })
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
    };
  }, [digits]);
  return { state, address };
}
