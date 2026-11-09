// Conversão de texto para ESC/POS (impressoras térmicas), sem dependências.
//
// Acentos: por padrão usa a página de código CP860 (português), que cobre os acentos do PT-BR.
// Algumas impressoras só têm a CP850 (ou numeram a CP860 diferente): para elas há a opção
// "850", e "ascii" tira os acentos (funciona em qualquer uma).

/** Metade de cima (0x80–0xFF) de cada página de código, na ordem dos bytes. */
const HIGH = {
  860: 'ÇüéâãàÁçêÊèÍÔìÃÂÉÀÈôõòÚùÌÕÜ¢£Ù₧ÓáíóúñÑªº¿Ò¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ',
  850: 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ',
};
const TABLES = Object.fromEntries(
  Object.entries(HIGH).map(([cp, s]) => [cp, new Map([...s].map((ch, i) => [ch, 0x80 + i]))]),
);
/** Número da tabela no comando ESC t (padrão Epson, seguido por Elgin, Bematech, Tanca...). */
const ESC_T = { 860: 3, 850: 2 };

/** Codifica texto na página pedida; caractere fora da tabela perde o acento ou vira "?". */
export function encodeText(text, codepage = '860') {
  const table = TABLES[codepage];
  const out = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === 0x0a || (code >= 0x20 && code < 0x7f)) out.push(code);
    else if (table?.has(ch)) out.push(table.get(ch));
    else {
      const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const p = plain.codePointAt(0);
      out.push(plain.length === 1 && p >= 0x20 && p < 0x7f ? p : 0x3f);
    }
  }
  return Buffer.from(out);
}

/** Codifica texto em CP860 (mantido para quem já usava). */
export const encodeCp860 = (text) => encodeText(text, '860');

const ESC = 0x1b;
const GS = 0x1d;

/** Linha do texto que vira QR Code (ex.: o QR da NFC-e). Igual a QR_MARK da API. */
export const QR_MARK = '@@QR@@';

/**
 * QR Code nativo (GS ( k, modelo 2), centralizado. Funciona nas térmicas ESC/POS atuais
 * (Epson, Elgin, Bematech, Daruma, Tanca). Tamanho do módulo 5 e correção de erro M.
 */
export function qrCode(data, size = 5) {
  const bytes = Buffer.from(String(data), 'utf8');
  const len = bytes.length + 3;
  return Buffer.concat([
    Buffer.from([ESC, 0x61, 1]), // ESC a 1  centraliza
    Buffer.from([GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0]), // modelo 2
    Buffer.from([GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, size]), // tamanho do módulo
    Buffer.from([GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31]), // correção de erro M
    Buffer.from([GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30]), // guarda
    bytes,
    Buffer.from([GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30]), // imprime
    Buffer.from('\n'),
    Buffer.from([ESC, 0x61, 0]), // ESC a 0  volta a alinhar à esquerda
  ]);
}

/**
 * Documento completo: inicializa, escolhe a página de código, imprime, avança e corta.
 *
 * As comandas têm 42 colunas. No papel de 80 mm cabem com a fonte normal; no de 58 mm
 * (384 pontos) usa a fonte B (9 × 17), em que 42 colunas cabem numa linha.
 *
 * @param {string} text
 * @param {{ paper?: 80 | 58, codepage?: '860' | '850' | 'ascii' }} [o]
 */
export function toEscPos(text, o = {}) {
  const paper = o.paper === 58 ? 58 : 80;
  const codepage = o.codepage === '850' || o.codepage === 'ascii' ? o.codepage : '860';
  const body = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith(QR_MARK))
      body.push(qrCode(line.slice(QR_MARK.length), paper === 58 ? 4 : 5));
    else body.push(encodeText(`${line}\n`, codepage));
  }
  return Buffer.concat([
    Buffer.from([ESC, 0x40]), // ESC @  inicializa
    ...(codepage === 'ascii' ? [] : [Buffer.from([ESC, 0x74, ESC_T[codepage]])]), // ESC t n
    ...(paper === 58 ? [Buffer.from([ESC, 0x4d, 1])] : []), // ESC M 1  fonte B
    ...body,
    Buffer.from('\n\n\n'),
    Buffer.from([GS, 0x56, 66, 0]), // GS V 66 0  avança e corta (parcial)
  ]);
}
