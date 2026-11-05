/**
 * Maquininha (Smart POS): aparelho Android com tela pequena, impressora de bobina 58 mm embutida
 * e navegador Chrome/WebView (Sunmi, PAX, Gertec, Positivo, Ingenico, Cielo LIO...).
 *
 * O sistema já cabe na tela delas (360 x 640). O "modo maquininha" deste aparelho:
 * - deixa os botões e campos maiores para o dedo (classe html.cm-pos, base.css);
 * - imprime comprovante e comanda na bobina de 58 mm pelo navegador (a impressora embutida
 *   aparece como impressora do Android).
 *
 * A escolha fica só neste aparelho (localStorage). "Automático" liga quando o navegador se
 * identifica como uma maquininha conhecida.
 */
export type PosMode = 'auto' | 'on' | 'off';
export type PaperWidth = '58' | '80';

const MODE_KEY = 'cm-pos-mode';
const PAPER_KEY = 'cm-paper-width';

/** Fabricantes e modelos de Smart POS que aparecem no "user agent" do Android. */
const POS_UA =
  /\b(SUNMI|PAX|A9[1-3]0|A8[0-9]0|Gertec|GPOS\d*|Positivo L\d+|L[34]00|Ingenico|APOS|MOVE\/?\d+|Cielo|LIO|DX8000|SmartPOS|N910|P2[_ ]?(Pro|Lite|mini)?|V2[_ ]?Pro|T2mini|Stone)\b/i;

export function looksLikePos(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  return /Android/i.test(ua) && POS_UA.test(ua);
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sem armazenamento: vale só até recarregar */
  }
}

export function posMode(): PosMode {
  const v = read(MODE_KEY);
  return v === 'on' || v === 'off' ? v : 'auto';
}

/** Modo maquininha ligado neste aparelho (escolha manual ou detecção automática). */
export function posActive(mode = posMode()) {
  return mode === 'on' || (mode === 'auto' && looksLikePos());
}

export function setPosMode(mode: PosMode) {
  write(MODE_KEY, mode);
  applyPosMode();
}

/** Largura da bobina para a impressão pelo navegador. Maquininha: 58 mm; o resto: 80 mm. */
export function paperWidth(): PaperWidth {
  const v = read(PAPER_KEY);
  if (v === '58' || v === '80') return v;
  return posActive() ? '58' : '80';
}

export function setPaperWidth(w: PaperWidth) {
  write(PAPER_KEY, w);
}

/** Liga/desliga o visual de maquininha (chamado antes do primeiro desenho). */
export function applyPosMode() {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('cm-pos', posActive());
}

/**
 * CSS da página de impressão na largura da bobina. Os modelos têm 42 colunas: na de 58 mm a
 * letra diminui para as 42 colunas caberem nos ~48 mm úteis (sem cortar a linha).
 */
export function paperCss(width: PaperWidth = paperWidth()) {
  const printable = width === '58' ? 48 : 72;
  // Letra monoespaçada tem ~0,6 em de largura: 42 colunas x 0,6 em = largura útil.
  const font = width === '58' ? `calc(${printable}mm / 42 / 0.6)` : '12px';
  return {
    page: `@page{size:${width}mm auto;margin:${width === '58' ? 2 : 4}mm}`,
    width: `${printable}mm`,
    font,
  };
}
