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
 * Marcas de estilo da linha inteira (iguais a PRINT_MARKS de packages/shared/src/print-marks.ts):
 * a logo do restaurante, negrito e letra grande (largura e altura duplas: 21 colunas).
 */
export const LOGO_MARK = '@@LOGO@@';
export const BOLD_MARK = '@@N@@';
export const BIG_MARK = '@@G@@';

/**
 * Imagem em pontos pretos e brancos (GS v 0), centralizada. `img.data` tem `width / 8` bytes por
 * linha, 1 = ponto preto. Vai em faixas de até 128 linhas: algumas térmicas (Elgin, Bematech)
 * perdem a imagem inteira quando ela é alta demais num comando só.
 *
 * @param {{ width: number, height: number, data: Buffer }} img
 */
export function rasterImage(img) {
  const bytesPerRow = Math.ceil(img.width / 8);
  const out = [Buffer.from([ESC, 0x61, 1])]; // ESC a 1  centraliza
  for (let y = 0; y < img.height; y += 128) {
    const rows = Math.min(128, img.height - y);
    out.push(
      Buffer.from([
        GS,
        0x76,
        0x30,
        0, // GS v 0, modo normal
        bytesPerRow & 0xff,
        (bytesPerRow >> 8) & 0xff,
        rows & 0xff,
        (rows >> 8) & 0xff,
      ]),
      img.data.subarray(y * bytesPerRow, (y + rows) * bytesPerRow),
    );
  }
  out.push(Buffer.from([ESC, 0x61, 0])); // ESC a 0  volta a alinhar à esquerda
  return Buffer.concat(out);
}

/** A imagem está inteira e no tamanho que cabe no papel? (o resto é ignorado em silêncio) */
const validImage = (img, paper) =>
  !!img &&
  Number.isInteger(img.width) &&
  Number.isInteger(img.height) &&
  img.width > 0 &&
  img.height > 0 &&
  img.width <= (paper === 58 ? 384 : 576) &&
  img.height <= 600 &&
  Buffer.isBuffer(img.data) &&
  img.data.length >= Math.ceil(img.width / 8) * img.height;

/** Tira as marcas de estilo (impressão sem ESC/POS: folha, tela). */
export function stripStyle(line) {
  for (const m of [BOLD_MARK, BIG_MARK]) if (line.startsWith(m)) return line.slice(m.length);
  return line;
}

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
 * Linhas marcadas: LOGO_MARK vira a logo (`o.logo`, já em pontos; sem ela a linha some),
 * BOLD_MARK sai em negrito e BIG_MARK em letra grande.
 *
 * @param {string} text
 * @param {{ paper?: 80 | 58, codepage?: '860' | '850' | 'ascii',
 *   logo?: { width: number, height: number, data: Buffer } | null }} [o]
 */
export function toEscPos(text, o = {}) {
  const paper = o.paper === 58 ? 58 : 80;
  const codepage = o.codepage === '850' || o.codepage === 'ascii' ? o.codepage : '860';
  const body = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith(QR_MARK))
      body.push(qrCode(line.slice(QR_MARK.length), paper === 58 ? 4 : 5));
    else if (line.startsWith(LOGO_MARK)) {
      if (validImage(o.logo, paper)) body.push(rasterImage(o.logo));
    } else if (line.startsWith(BOLD_MARK))
      body.push(
        Buffer.from([ESC, 0x45, 1]), // ESC E 1  negrito
        encodeText(`${line.slice(BOLD_MARK.length)}\n`, codepage),
        Buffer.from([ESC, 0x45, 0]),
      );
    else if (line.startsWith(BIG_MARK))
      body.push(
        Buffer.from([ESC, 0x45, 1, GS, 0x21, 0x11]), // negrito + GS ! 0x11 (largura e altura duplas)
        encodeText(`${line.slice(BIG_MARK.length)}\n`, codepage),
        Buffer.from([GS, 0x21, 0, ESC, 0x45, 0]),
      );
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
