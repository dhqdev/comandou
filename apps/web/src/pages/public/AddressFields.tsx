import { Loader2 } from 'lucide-react';
import { ReactNode, useEffect, useRef } from 'react';
import { StreetHits } from '../../features/StreetHits';
import { maskCep, useCepAutofill } from '../../lib/cep';
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

/**
 * Endereço de entrega com CEP: o CEP preenche rua, bairro e cidade; o nome da rua acha o CEP.
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
  const number = useRef<HTMLInputElement>(null);
  const street = useRef<HTMLInputElement>(null);

  // Cidade da loja como ponto de partida.
  useEffect(() => {
    if (!value.city && city) onChange({ city, state: value.state || state || '' });
    // Só na montagem.
  }, []);

  const cep = useCepAutofill(value, (a, from) => {
    if (from === 'street') {
      onChange({
        cep: maskCep(a.cep),
        street: a.street || value.street,
        district: a.district || value.district,
        city: a.city || value.city,
        state: a.state || value.state,
      });
      number.current?.focus();
      return;
    }
    onChange({
      street: a.street || value.street,
      district: a.district || value.district,
      city: a.city || value.city,
      state: a.state || value.state,
    });
    // CEP de rua: falta só o número. CEP geral da cidade: falta a rua.
    (a.street ? number : street).current?.focus();
  });

  return (
    <div className={className}>
      <Field label="CEP" className="af-cep" hint={cep.cepHint}>
        <span className="cep-input">
          <input
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="00000-000"
            value={value.cep}
            maxLength={9}
            onChange={(e) => {
              cep.cepTyped();
              onChange({ cep: maskCep(e.target.value) });
            }}
          />
          {cep.cepState === 'busy' && <Loader2 size={16} className="cep-input__spin" aria-hidden />}
        </span>
      </Field>
      <div className="street-field f--wide">
        <Field label="Rua" hint={cep.streetHint}>
          <input
            ref={street}
            autoComplete="address-line1"
            value={value.street}
            maxLength={120}
            role="combobox"
            aria-expanded={cep.open}
            aria-controls="street-hits"
            aria-autocomplete="list"
            onChange={(e) => {
              cep.streetTyped();
              onChange({ street: e.target.value });
            }}
            onFocus={() => cep.hits.length && cep.setOpen(true)}
            onBlur={cep.streetLeft}
            onKeyDown={(e) => e.key === 'Escape' && cep.setOpen(false)}
          />
        </Field>
        {cep.searching && <Loader2 size={16} className="street-field__spin" aria-hidden />}
        {cep.open && <StreetHits id="street-hits" hits={cep.hits} onPick={cep.pick} />}
      </div>
      <Field label="Número" className="af-num">
        <input
          ref={number}
          value={value.number}
          maxLength={20}
          onChange={(e) => onChange({ number: e.target.value })}
        />
      </Field>
      <Field label="Bairro" className="af-district">
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
      <Field label="Complemento (opcional)" className="af-half">
        <input
          value={value.complement}
          maxLength={80}
          onChange={(e) => onChange({ complement: e.target.value })}
        />
      </Field>
      <Field label="Ponto de referência (opcional)" className="af-half">
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
