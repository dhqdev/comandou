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

/** A API não alcançou os serviços de CEP (bloqueio do servidor, fora do ar…). */
const apiDown = (e: unknown) =>
  e instanceof ApiError && (e.status === 429 || e.status >= 500 || e.status === 0);

async function direct<T>(path: string): Promise<T> {
  const res = await fetch(`${VIACEP}${path}`, { signal: AbortSignal.timeout(6_000) });
  if (!res.ok) throw new ApiError(res.status, 'consulta de CEP indisponível');
  return (await res.json()) as T;
}

/**
 * Endereço do CEP (null = CEP não existe). Pergunta à API (cache + serviços de reserva); se ela
 * não conseguir falar com os serviços, o próprio navegador pergunta à ViaCEP.
 */
export async function lookupCep(digits: string): Promise<CepAddress | null> {
  try {
    return await api<CepAddress>(`/store/cep/${digits}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    if (!apiDown(e)) throw e;
    return fromViaCep(await direct<Record<string, unknown>>(`/ws/${digits}/json/`));
  }
}

/** CEPs de uma rua na cidade, com a mesma reserva pelo navegador. */
export async function searchStreet(
  street: string,
  city: string,
  state: string,
): Promise<CepAddress[]> {
  const qs = new URLSearchParams({ street, city, state });
  try {
    return await api<CepAddress[]>(`/store/cep?${qs}`);
  } catch (e) {
    if (!apiDown(e)) throw e;
    const clean = street.replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').trim();
    const r = await direct<Record<string, unknown>[]>(
      `/ws/${state}/${encodeURIComponent(city)}/${encodeURIComponent(clean)}/json/`,
    );
    const seen = new Set<string>();
    return (Array.isArray(r) ? r : [])
      .map(fromViaCep)
      .filter((a): a is CepAddress => !!a && !seen.has(a.cep) && !!seen.add(a.cep))
      .slice(0, 10);
  }
}

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
