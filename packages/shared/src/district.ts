/** Nomes de bairro: comparar o que o cliente digitou com as áreas e com o CEP. */
/** Palavras que não dizem qual é o bairro ("Loteamento", "Residencial"…). */
const FILLER = new Set([
  'bairro',
  'loteamento',
  'lot',
  'residencial',
  'res',
  'conjunto',
  'cj',
  'condominio',
  'cond',
  'setor',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
]);
/** Abreviações comuns no nome do bairro. */
const ABBR: Record<string, string> = {
  jd: 'jardim',
  jdm: 'jardim',
  pq: 'parque',
  pque: 'parque',
  vl: 'vila',
  res: 'residencial',
  cj: 'conjunto',
  st: 'santa',
  sta: 'santa',
  sto: 'santo',
  s: 'sao',
  n: 'nossa',
  sra: 'senhora',
  dr: 'doutor',
  prof: 'professor',
  ch: 'chacara',
  chac: 'chacara',
  rec: 'recanto',
};

/** Nome de bairro em palavras comparáveis: sem acento, sem pontuação, sem "Loteamento". */
export function districtWords(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => ABBR[w] ?? w)
    .filter((w) => !FILLER.has(w));
}

/**
 * O bairro digitado é o desta área? Na taxa por bairro, cada área leva o nome do bairro (ou de
 * vários, separados por vírgula, barra ou "e"). Vale quando todas as palavras de um dos nomes
 * aparecem em sequência no bairro do cliente: "Parque São Martinho" acha "Loteamento Parque
 * São Martinho" e "Pq. S. Martinho", mas "Centro" não acha "Jardim Centro Oeste" só por uma parte.
 */
export function zoneNamesDistrict(zoneName: string, district: string): boolean {
  const d = districtWords(district);
  return zoneName
    .split(/[,;/|]|\s+e\s+|\s+-\s+/i)
    .some((name) => containsWords(districtWords(name), d));
}

/**
 * Os dois nomes são o mesmo bairro? "Loteamento Parque São Martinho" = "Pq. S. Martinho".
 * Um nome com duas palavras ou mais dentro do outro também vale ("Jardim Paulista" acha
 * "Residencial Jardim Paulista II"); uma palavra só ("Centro") tem de ser igual.
 */
export function sameDistrict(a: string, b: string): boolean {
  return (
    containsWords(districtWords(a), districtWords(b)) ||
    containsWords(districtWords(b), districtWords(a))
  );
}

function containsWords(n: string[], d: string[]): boolean {
  if (!n.length || !d.length) return false;
  if (n.length === d.length) return n.every((w, i) => w === d[i]);
  if (n.length < 2 || n.length > d.length) return false;
  for (let i = 0; i + n.length <= d.length; i++) if (n.every((w, j) => w === d[i + j])) return true;
  return false;
}
