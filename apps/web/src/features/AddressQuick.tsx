import { Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { TextField } from '../design-system';
import { maskCep, useCepAutofill, useStoreRegion } from '../lib/cep';
import { StreetHits } from './StreetHits';

export interface AddressParts {
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
}

const EMPTY: AddressParts = {
  cep: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
};

/** "Rua X, 123 - Apto 2 - Bairro, Cidade/UF - CEP 00000-000" (vazio sem rua). */
export function formatAddress(a: AddressParts) {
  const street = a.street.trim();
  if (!street) return '';
  const head = [street, a.number.trim() || 's/n'].join(', ');
  const place = [a.city.trim(), a.state.trim()].filter(Boolean).join('/');
  const cep = a.cep.replace(/\D/g, '');
  return [
    head,
    a.complement.trim(),
    [a.district.trim(), place].filter(Boolean).join(', '),
    cep.length === 8 ? `CEP ${maskCep(cep)}` : '',
  ]
    .filter(Boolean)
    .join(' - ');
}

/**
 * Endereço de entrega digitado pela equipe (PDV, garçom): CEP preenche a rua, o bairro e a
 * cidade; o nome da rua acha o CEP na cidade do restaurante. Devolve o endereço numa linha só.
 */
export function AddressQuick({
  value,
  onChange,
  label = 'Endereço de entrega',
}: {
  /** Linha montada; quando quem usa limpa (""), os campos também limpam. */
  value: string;
  onChange(line: string): void;
  label?: string;
}) {
  const [a, setA] = useState<AddressParts>(EMPTY);
  const region = useStoreRegion();
  const number = useRef<HTMLInputElement>(null);
  const street = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Cidade do restaurante como ponto de partida (para achar o CEP pela rua).
  useEffect(() => {
    if (region?.city && !a.city)
      setA((x) => ({ ...x, city: region.city ?? '', state: x.state || region.state || '' }));
  }, [region]);

  // Pedido enviado: o formulário zera a linha e os campos voltam ao começo.
  useEffect(() => {
    if (!value && formatAddress(a))
      setA({ ...EMPTY, city: region?.city ?? '', state: region?.state ?? '' });
  }, [value]);

  function patch(p: Partial<AddressParts>) {
    const next = { ...a, ...p };
    setA(next);
    onChange(formatAddress(next));
  }

  const cep = useCepAutofill(a, (hit, from) => {
    patch({
      ...(from === 'street' ? { cep: maskCep(hit.cep) } : {}),
      street: hit.street || a.street,
      district: hit.district || a.district,
      city: hit.city || a.city,
      state: hit.state || a.state,
    });
    (hit.street ? number : street).current?.focus();
  });

  return (
    <fieldset className="addr-quick">
      <legend className="cm-label">{label}</legend>
      <div className="cep-input addr-quick__cep">
        <TextField
          label="CEP"
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="00000-000"
          maxLength={9}
          value={a.cep}
          hint={cep.cepHint}
          onChange={(e) => {
            cep.cepTyped();
            patch({ cep: maskCep(e.target.value) });
          }}
        />
        {cep.cepState === 'busy' && <Loader2 size={16} className="addr-quick__spin" aria-hidden />}
      </div>
      <div className="street-field addr-quick__street">
        <TextField
          ref={street}
          label="Rua"
          autoComplete="address-line1"
          value={a.street}
          maxLength={120}
          hint={cep.streetHint}
          role="combobox"
          aria-expanded={cep.open}
          aria-controls={listId}
          aria-autocomplete="list"
          required
          onChange={(e) => {
            cep.streetTyped();
            patch({ street: e.target.value });
          }}
          onFocus={() => cep.hits.length && cep.setOpen(true)}
          onBlur={cep.streetLeft}
          onKeyDown={(e) => e.key === 'Escape' && cep.setOpen(false)}
        />
        {cep.searching && <Loader2 size={16} className="street-field__spin" aria-hidden />}
        {cep.open && <StreetHits id={listId} hits={cep.hits} onPick={cep.pick} />}
      </div>
      <TextField
        ref={number}
        label="Número"
        value={a.number}
        maxLength={20}
        onChange={(e) => patch({ number: e.target.value })}
      />
      <TextField
        label="Complemento"
        value={a.complement}
        maxLength={80}
        onChange={(e) => patch({ complement: e.target.value })}
      />
      <TextField
        label="Bairro"
        value={a.district}
        maxLength={80}
        onChange={(e) => patch({ district: e.target.value })}
      />
      <div className="addr-quick__city">
        <TextField
          label="Cidade"
          autoComplete="address-level2"
          value={a.city}
          maxLength={80}
          onChange={(e) => patch({ city: e.target.value })}
        />
        <TextField
          label="UF"
          autoComplete="address-level1"
          value={a.state}
          maxLength={2}
          onChange={(e) => patch({ state: e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase() })}
        />
      </div>
    </fieldset>
  );
}
