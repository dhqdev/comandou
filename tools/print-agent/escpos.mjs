// Conversão de texto para ESC/POS (impressoras térmicas), sem dependências.
// Usa a página de código CP860 (português), que cobre os acentos do PT-BR.

const CP860 = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ã: 0x84,
  à: 0x85,
  Á: 0x86,
  ç: 0x87,
  ê: 0x88,
  Ê: 0x89,
  è: 0x8a,
  Í: 0x8b,
  Ô: 0x8c,
  ì: 0x8d,
  Ã: 0x8e,
  Â: 0x8f,
  É: 0x90,
  À: 0x91,
  È: 0x92,
  ô: 0x93,
  õ: 0x94,
  ò: 0x95,
  Ú: 0x96,
  ù: 0x97,
  Ì: 0x98,
  Õ: 0x99,
  Ü: 0x9a,
  Ó: 0x9f,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ª: 0xa6,
  º: 0xa7,
};

/** Codifica texto em CP860; caracteres fora da tabela perdem o acento ou viram "?". */
export function encodeCp860(text) {
  const out = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === 0x0a || (code >= 0x20 && code < 0x7f)) out.push(code);
    else if (CP860[ch] !== undefined) out.push(CP860[ch]);
    else {
      const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const p = plain.codePointAt(0);
      out.push(plain.length === 1 && p >= 0x20 && p < 0x7f ? p : 0x3f);
    }
  }
  return Buffer.from(out);
}

const ESC = 0x1b;
const GS = 0x1d;

/** Documento completo: inicializa, seleciona CP860, imprime, avança e corta. */
export function toEscPos(text) {
  return Buffer.concat([
    Buffer.from([ESC, 0x40]), // ESC @  inicializa
    Buffer.from([ESC, 0x74, 3]), // ESC t 3  página de código CP860
    encodeCp860(text.replace(/\r\n?/g, '\n')),
    Buffer.from('\n\n\n\n'),
    Buffer.from([GS, 0x56, 66, 0]), // GS V 66 0  avança e corta (parcial)
  ]);
}
