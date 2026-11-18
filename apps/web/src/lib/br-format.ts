/** Formatos do Brasil usados nos cadastros (painel e restaurante). */

export const UFS = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
];

export const onlyDigits = (v: string) => v.replace(/\D/g, '');

/** CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00) enquanto digita. */
export function maskDocument(v: string) {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 11)
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

/** (11) 98765-4321 ou (11) 3456-7890 enquanto digita. */
export function maskPhone(v: string) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  const rest = d.slice(2);
  const split = d.length === 11 ? 5 : 4;
  return `(${d.slice(0, 2)}) ${rest.length > split ? `${rest.slice(0, split)}-${rest.slice(split)}` : rest}`;
}
