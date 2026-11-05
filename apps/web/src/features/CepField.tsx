import { useState } from 'react';
import { TextField } from '../design-system';
import { maskCep, useCepLookup, type CepAddress } from '../lib/cep';

/** Monta "Rua, Bairro, Cidade/UF, CEP 00000-000" (o número fica para quem digita). */
export function addressLine(a: CepAddress) {
  return [
    a.street,
    a.district,
    [a.city, a.state].filter(Boolean).join('/'),
    `CEP ${maskCep(a.cep)}`,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Só o CEP: ao completar os 8 dígitos consulta e entrega o endereço achado (para formulários
 * que guardam o endereço numa linha ou só a cidade).
 */
export function CepField({
  onFound,
  label = 'CEP',
  wrapClass,
  disabled,
}: {
  onFound(a: CepAddress): void;
  label?: string;
  wrapClass?: string;
  disabled?: boolean;
}) {
  const [cep, setCep] = useState('');
  const { state } = useCepLookup(cep, onFound);

  return (
    <TextField
      label={label}
      inputMode="numeric"
      autoComplete="postal-code"
      placeholder="00000-000"
      maxLength={9}
      value={cep}
      wrapClass={wrapClass}
      disabled={disabled}
      hint={
        state === 'busy'
          ? 'Buscando o endereço…'
          : state === 'missing'
            ? 'CEP não encontrado. Confira ou preencha à mão.'
            : state === 'error'
              ? 'Não deu para consultar agora. Preencha à mão.'
              : state === 'ok'
                ? 'Endereço preenchido pelo CEP.'
                : 'Digite o CEP e a gente completa.'
      }
      onChange={(e) => setCep(maskCep(e.target.value))}
    />
  );
}
