import { Loader2, MapPin } from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { maskCep } from './store';
import { Field } from './ui';

export interface AddressDraft {
  cep: string;
  street: string;
  number: string;
  district: string;
  city: string;
  state: string;
  complement: string;
  reference: string;
}
interface CepAddress {
  cep: string;
  street: string;
  district: string;
  city: string;
  state: string;
}

const fmtCep = (d: string) => maskCep(d);

/**
 * Endereço de entrega com CEP: o CEP preenche rua, bairro e cidade; o nome da rua sugere o CEP.
 * Tudo continua editável à mão (CEP genérico de cidade pequena, consulta fora do ar…).
 */
export function AddressFields({
  value,
  onChange,
  city,
  state,
  className = 'grid2 ck-fields',
  children,
}: {
  value: AddressDraft;
  onChange(patch: Partial<AddressDraft>): void;
  /** Cidade e UF da loja: valem enquanto o cliente não informa outra. */
  city?: string | null;
  state?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  const [cepState, setCepState] = useState<'idle' | 'busy' | 'ok' | 'missing' | 'error'>('idle');
  const [hits, setHits] = useState<CepAddress[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const number = useRef<HTMLInputElement>(null);
  const street = useRef<HTMLInputElement>(null);
  const looked = useRef('');
  // Só busca CEP pela rua quando o cliente digitou a rua (não quando o CEP a preencheu).
  const typedStreet = useRef(false);
  const seq = useRef(0);

  // Cidade da loja como ponto de partida.
  useEffect(() => {
    if (!value.city && city) onChange({ city, state: value.state || state || '' });
    // Só na montagem.
  }, []);

  const digits = value.cep.replace(/\D/g, '');
  useEffect(() => {
    if (digits.length !== 8 || digits === looked.current) return;
    looked.current = digits;
    setCepState('busy');
    const my = ++seq.current;
    api<CepAddress>(`/store/cep/${digits}`)
      .then((a) => {
        if (my !== seq.current) return;
        typedStreet.current = false;
        setOpen(false);
        onChange({
          street: a.street || value.street,
          district: a.district || value.district,
          city: a.city || value.city,
          state: a.state || value.state,
        });
        setCepState('ok');
        // CEP de rua: falta só o número. CEP geral da cidade: falta a rua.
        (a.street ? number : street).current?.focus();
      })
      .catch((e: ApiError) => {
        if (my === seq.current) setCepState(e.status === 404 ? 'missing' : 'error');
      });
  }, [digits]);

  // Rua digitada (cidade conhecida): sugere CEPs. Espera o cliente parar de digitar.
  const canSearch = value.city.trim().length >= 3 && /^[A-Za-z]{2}$/.test(value.state.trim());
  useEffect(() => {
    const q = value.street.trim();
    if (!typedStreet.current || q.length < 3 || !canSearch) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      const my = ++seq.current;
      setSearching(true);
      const qs = new URLSearchParams({
        street: q,
        city: value.city.trim(),
        state: value.state.trim().toUpperCase(),
      });
      api<CepAddress[]>(`/store/cep?${qs}`)
        .then((r) => {
          if (my !== seq.current) return;
          setHits(r);
          setOpen(r.length > 0);
        })
        .catch(() => my === seq.current && setHits([]))
        .finally(() => my === seq.current && setSearching(false));
    }, 450);
    return () => clearTimeout(t);
  }, [value.street, value.city, value.state, canSearch]);

  function pick(a: CepAddress) {
    typedStreet.current = false;
    looked.current = a.cep;
    setOpen(false);
    setHits([]);
    setCepState('ok');
    onChange({
      cep: fmtCep(a.cep),
      street: a.street,
      district: a.district || value.district,
      city: a.city,
      state: a.state,
    });
    number.current?.focus();
  }

  const cepHint =
    cepState === 'busy'
      ? 'Buscando o endereço…'
      : cepState === 'missing'
        ? 'CEP não encontrado. Confira ou preencha à mão.'
        : cepState === 'error'
          ? 'Não deu para consultar agora. Preencha à mão.'
          : cepState === 'ok'
            ? 'Endereço preenchido pelo CEP.'
            : 'Digite o CEP e a gente completa o endereço.';

  return (
    <div className={className}>
      <Field label="CEP" hint={cepHint}>
        <span className="cep-input">
          <input
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="00000-000"
            value={value.cep}
            maxLength={9}
            onChange={(e) => {
              const cep = maskCep(e.target.value);
              if (cep.replace(/\D/g, '').length < 8) {
                looked.current = '';
                setCepState('idle');
              }
              onChange({ cep });
            }}
          />
          {cepState === 'busy' && <Loader2 size={16} className="cep-input__spin" aria-hidden />}
        </span>
      </Field>
      <div className="street-field f--wide">
        <Field
          label="Rua"
          hint={
            !digits && canSearch
              ? `Sem o CEP? Digite a rua: buscamos em ${value.city.trim()}.`
              : undefined
          }
        >
          <input
            ref={street}
            autoComplete="address-line1"
            value={value.street}
            maxLength={120}
            role="combobox"
            aria-expanded={open}
            aria-controls="street-hits"
            aria-autocomplete="list"
            onChange={(e) => {
              typedStreet.current = true;
              onChange({ street: e.target.value });
            }}
            onFocus={() => hits.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          />
        </Field>
        {searching && <Loader2 size={16} className="street-field__spin" aria-hidden />}
        {open && (
          <ul className="street-hits" id="street-hits" role="listbox" aria-label="Ruas encontradas">
            {hits.map((a) => (
              <li key={a.cep} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(a)}
                >
                  <MapPin size={15} />
                  <span>
                    <strong>{a.street}</strong>
                    <small>
                      {[a.district, `${a.city}/${a.state}`].filter(Boolean).join(' · ')} · CEP{' '}
                      {fmtCep(a.cep)}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Field label="Número">
        <input
          ref={number}
          value={value.number}
          maxLength={20}
          onChange={(e) => onChange({ number: e.target.value })}
        />
      </Field>
      <Field label="Bairro">
        <input
          value={value.district}
          maxLength={80}
          onChange={(e) => onChange({ district: e.target.value })}
        />
      </Field>
      <div className="city-uf">
        <Field label="Cidade">
          <input
            autoComplete="address-level2"
            value={value.city}
            maxLength={80}
            onChange={(e) => onChange({ city: e.target.value })}
          />
        </Field>
        <Field label="UF">
          <input
            autoComplete="address-level1"
            value={value.state}
            maxLength={2}
            onChange={(e) =>
              onChange({ state: e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase() })
            }
          />
        </Field>
      </div>
      <Field label="Complemento (opcional)">
        <input
          value={value.complement}
          maxLength={80}
          onChange={(e) => onChange({ complement: e.target.value })}
        />
      </Field>
      <Field label="Ponto de referência (opcional)">
        <input
          value={value.reference}
          maxLength={120}
          onChange={(e) => onChange({ reference: e.target.value })}
        />
      </Field>
      {children}
    </div>
  );
}

/** Campos de endereço prontos para a API (vazios viram ausentes). */
export function addressPayload(a: AddressDraft) {
  const cep = a.cep.replace(/\D/g, '');
  return {
    street: a.street.trim(),
    number: a.number.trim(),
    district: a.district.trim(),
    complement: a.complement.trim() || undefined,
    reference: a.reference.trim() || undefined,
    cep: cep.length === 8 ? cep : undefined,
    city: a.city.trim() || undefined,
    state: /^[A-Z]{2}$/.test(a.state.trim()) ? a.state.trim() : undefined,
  };
}
