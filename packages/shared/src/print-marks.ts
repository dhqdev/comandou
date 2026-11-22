/**
 * Marcas do texto de impressão (bobina de 42 colunas). Cada marca fica no começo da linha e vale
 * para a linha inteira: o aplicativo Comandou Impressão troca por comandos ESC/POS (negrito, letra
 * grande, a logo do restaurante, QR Code). A prévia da tela desenha igual. Para quem não entende
 * as marcas (aplicativo antigo, impressão pelo navegador sem estilo), `plainPrintText` tira tudo e
 * o papel continua legível.
 *
 * Mesmas constantes em tools/print-agent/escpos.mjs (o aplicativo não tem dependências).
 */
export const PRINT_WIDTH = 42;
/** Colunas da letra grande (largura dupla): metade da bobina. */
export const PRINT_BIG_WIDTH = 21;

export const PRINT_MARKS = {
  /** Linha inteira = QR Code (endereço depois da marca). */
  qr: '@@QR@@',
  /** Linha inteira = logo do restaurante (a da Loja online), centralizada. */
  logo: '@@LOGO@@',
  /** Linha em negrito. */
  bold: '@@N@@',
  /** Linha em letra grande (largura e altura duplas, negrito): até 21 colunas. */
  big: '@@G@@',
} as const;

/** Versão do aplicativo de impressão que entende negrito, letra grande e logo. */
export const PRINT_MARKS_AGENT_VERSION = '1.11.0';

export type PrintLine =
  { kind: 'text' | 'bold' | 'big'; text: string } | { kind: 'logo' } | { kind: 'qr'; data: string };

/** Lê o texto linha a linha com o estilo de cada uma. */
export function parsePrintLines(text: string): PrintLine[] {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l): PrintLine => {
      if (l.startsWith(PRINT_MARKS.qr)) return { kind: 'qr', data: l.slice(PRINT_MARKS.qr.length) };
      if (l.startsWith(PRINT_MARKS.logo)) return { kind: 'logo' };
      if (l.startsWith(PRINT_MARKS.bold))
        return { kind: 'bold', text: l.slice(PRINT_MARKS.bold.length) };
      if (l.startsWith(PRINT_MARKS.big))
        return { kind: 'big', text: l.slice(PRINT_MARKS.big.length) };
      return { kind: 'text', text: l };
    });
}

/**
 * Linha da letra grande (21 colunas) esticada para a bobina normal (42): centralizada continua
 * centralizada, "TOTAL:   R$ 10,00" continua com o valor na direita.
 */
export function widenBigLine(text: string, width = PRINT_WIDTH): string {
  const t = text.trim();
  if (!t) return '';
  const pair = /^(\S.*?)\s{2,}(\S.*)$/.exec(t);
  if (pair && !/^\s/.test(text)) {
    const v = pair[2].slice(0, width);
    return pair[1].slice(0, Math.max(0, width - v.length - 1)).padEnd(width - v.length) + v;
  }
  if (/^\s/.test(text)) return ' '.repeat(Math.max(0, Math.floor((width - t.length) / 2))) + t;
  return t;
}

/** Texto sem marcas (o QR Code continua como linha marcada: os aplicativos antigos já entendem). */
export function plainPrintText(text: string): string {
  const out: string[] = [];
  for (const l of parsePrintLines(text)) {
    if (l.kind === 'logo') continue;
    if (l.kind === 'qr') out.push(PRINT_MARKS.qr + l.data);
    else out.push(l.kind === 'big' ? widenBigLine(l.text) : l.text);
  }
  return out.join('\n');
}

/** Colunas que a linha ocupa no papel (a letra grande ocupa o dobro). */
export function printLineColumns(line: PrintLine): number {
  if (line.kind === 'logo' || line.kind === 'qr') return 0;
  return line.kind === 'big' ? line.text.length * 2 : line.text.length;
}

const parts = (v: string) => v.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);

/** O aplicativo desta versão entende as marcas? Sem versão (muito antigo) = não. */
export function agentSupportsMarks(version: string | null | undefined): boolean {
  if (!version) return false;
  const a = parts(version);
  const b = parts(PRINT_MARKS_AGENT_VERSION);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}
