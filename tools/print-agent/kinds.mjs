// Que tipo de impressora é, pelo nome, pelo driver ou pelo modelo que ela mesma informa.
// O tipo decide como o aplicativo fala com ela: térmica de cupom recebe ESC/POS direto (RAW);
// as outras (jato de tinta, laser, matricial, etiqueta) imprimem uma folha pelo driver.

/** @typedef {'termica'|'etiqueta'|'matricial'|'jato'|'laser'|'virtual'|'desconhecida'} PrinterType */

export const TYPE_LABEL = {
  termica: 'Térmica de cupom',
  etiqueta: 'Etiqueta',
  matricial: 'Matricial',
  jato: 'Jato de tinta',
  laser: 'Laser',
  virtual: 'Virtual (salva arquivo)',
  desconhecida: 'Tipo não identificado',
};

// A ordem importa: "Elgin L42" é etiqueta antes de ser Elgin; "Epson LX" é matricial antes de Epson.
const RULES = [
  [
    'virtual',
    /pdf|xps|onenote|\bfax\b|send to|enviar para|microsoft print to|document writer|print to file|imprimir em arquivo/i,
  ],
  [
    'etiqueta',
    /zebra|\bz[dtmq]\d{3}|\bg[ck]4\d0|\btlp\s?\d|\btsc\b|tspl|\bttp-?\d|argox|godex|\bl42\b|datamax|honeywell pc|intermec|dymo|labelwriter|\bql-?\d{3}|brother ql|\bslp-|\bxp-4\d{2}b|label|etiqueta/i,
  ],
  [
    'matricial',
    /\b(lx|fx|lq|dfx)-?\d{3}|matricial|dot ?matrix|\bimpact\b|microline|oki(data)? ml|\bml\d{3}\b|tally ?(dascom|genicom)?|printronix|kx-p\d/i,
  ],
  [
    'termica',
    /\btm[-_ ]?[a-z]?\d|receipt|recibo|cupom|\bpos\b|pos-?\d|thermal|t[ée]rmica|generic ?\/ ?text|text only|local raw|raw printer|elgin|bematech|daruma|tanca|knup|sweda|xprinter|zjiang|gprinter|rongta|sunmi|\b(58|80) ?mm\b|\bi[789]\b|mp-?\d{3,4}|\btsp\d|\bmpt|pt-?2\d0|leopardo|controlid|print ?id|\bsrp-?\d|bixolon|star micronics|\btsp\d{3}|\bct-?s\d/i,
  ],
  [
    'laser',
    /laser|\bhl-|\bmfc-l|\bdcp-l|imageclass|i-?sensys|xerox|ricoh|aficio|kyocera|ecosys|taskalfa|lexmark|pantum|sharp mx|samsung (ml|m\d|sl-|clx|scx)|phaser|versalink|workcentre|bizhub|konica|\blbp\d|\bmf\d{3}|okidata [bc]\d|\boki [bc]\d/i,
  ],
  [
    'jato',
    /ink|jato|deskjet|officejet|\benvy\b|ecotank|eco ?tank|workforce|expression|\bl\d{3,4}\b|smart ?tank|pixma|maxify|\bg\d{4}\b|canon g\d|\bet-\d|stylus|\bmfc-j|\bdcp-[jt]\d/i,
  ],
];

/** Tipo da impressora a partir de tudo que se sabe dela (nome, driver, modelo, descrição). */
export function printerType(...texts) {
  const all = texts.filter(Boolean).join(' ');
  for (const [type, re] of RULES) if (re.test(all)) return /** @type {PrinterType} */ (type);
  return 'desconhecida';
}

/** Recebe ESC/POS direto? Sem pista nenhuma (nome genérico sem driver), trata como térmica. */
export function speaksEscPos(type, hasDriver) {
  return type === 'termica' || (type === 'desconhecida' && !hasDriver);
}

/**
 * Pela linguagem que a impressora diz falar (campo CMD do IEEE 1284 Device ID, que vem pelo USB,
 * pelo IPP e pelo Bonjour). Null quando não dá para saber.
 */
export function typeFromCommandSet(cmd) {
  const c = String(cmd ?? '').toUpperCase();
  if (!c) return null;
  if (/ESC\/?POS|ESCPOS|STAR ?LINE/.test(c)) return 'termica';
  if (/ZPL|EPL|TSPL|DPL|CPCL|EZPL/.test(c)) return 'etiqueta';
  if (/ESCPL2|ESC\/P-?R|ESCPR|PCL3GUI|PCL3|BJ|IVEC/.test(c)) return 'jato';
  if (/ESC\/P\b|ESCP\b|ESCP2|IBMPPR|IBM ?PRO/.test(c)) return 'matricial';
  if (/PCL ?[56]|PCLXL|POSTSCRIPT|PS\b|URF|PDF|PWG/.test(c)) return 'laser';
  return null;
}
