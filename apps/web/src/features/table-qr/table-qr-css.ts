/**
 * Estilo dos cartões de QR das mesas. Fica em texto porque vale em dois lugares: na prévia da
 * janela e na folha que vai para a impressora (iframe próprio, sem o CSS do app).
 *
 * Tudo em `em`: a prévia usa letra pequena e a folha usa milímetros (`sheetCss`), o desenho é o
 * mesmo. As cores chegam por variáveis no próprio cartão (cor da marca do restaurante).
 */
export const TABLE_QR_CSS = `
.tqr{position:relative;box-sizing:border-box;width:30em;height:46em;padding:2.2em 2.2em 1.8em;
  border-radius:2.2em;overflow:hidden;display:flex;flex-direction:column;align-items:center;
  font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;text-align:center;
  background:#fff;color:#1a1613;break-inside:avoid;page-break-inside:avoid;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
.tqr *{box-sizing:border-box}
.tqr__deco{position:absolute;inset:0;pointer-events:none;color:var(--q-brand)}
.tqr__deco svg{position:absolute;width:3.4em;height:3.4em;stroke-width:1.6}
.tqr__head{position:relative;display:flex;align-items:center;justify-content:center;gap:.8em;
  min-height:3.2em;max-width:100%}
.tqr__logo{width:3.2em;height:3.2em;border-radius:.9em;object-fit:cover;flex:none;background:#fff}
.tqr__store{font-size:1.6em;font-weight:700;line-height:1.15;letter-spacing:-.01em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tqr__table{position:relative;margin-top:1.1em;display:flex;flex-direction:column;align-items:center;line-height:1}
.tqr__table span{font-size:1.5em;font-weight:600;opacity:.72}
.tqr__table strong{font-size:6.4em;font-weight:800;letter-spacing:-.04em;color:var(--q-num);
  font-variant-numeric:tabular-nums;max-width:4.4em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tqr__table[data-long] strong{font-size:3.6em;letter-spacing:-.02em;max-width:7.6em;margin-top:.15em}
.tqr__code{position:relative;width:21em;height:21em;margin-top:.9em;flex:none;line-height:0}
.tqr__code svg{width:100%;height:100%;display:block}
.tqr__cta{position:relative;margin:1.1em 0 0;display:flex;flex-direction:column;gap:.3em}
.tqr__cta b{font-size:1.65em;font-weight:750;letter-spacing:-.01em}
.tqr__cta span{font-size:1.3em;opacity:.75}
.tqr__steps{position:relative;list-style:none;margin:auto 0 0;padding:0;display:flex;gap:1.6em;justify-content:center}
.tqr__steps li{display:flex;align-items:center;gap:.4em;font-size:1.15em;font-weight:600;opacity:.8}
.tqr__steps svg{width:1.3em;height:1.3em;color:var(--q-brand)}

/* Moderno: branco, código na cor da casa e os desenhos de comida bem clarinhos nos cantos. */
.tqr--moderno{border:.18em solid var(--q-soft)}
.tqr--moderno .tqr__deco{opacity:.16}

/* Colorido: o cartão todo na cor da casa, o código num quadro branco. */
.tqr--colorido{background:var(--q-bg);color:var(--q-on)}
.tqr--colorido .tqr__deco{color:var(--q-on);opacity:.14}
.tqr--colorido .tqr__code{width:22em;height:22em;padding:.8em;background:#fff;border-radius:2em}
.tqr--colorido .tqr__steps svg{color:var(--q-on)}
.tqr--colorido .tqr__logo{box-shadow:0 0 0 .18em #fff}

/* Clássico: preto no branco, sem desenho (gasta pouca tinta). */
.tqr--classico{border:.12em dashed #9a9a9a;color:#111}
.tqr--classico .tqr__deco{display:none}
.tqr--classico .tqr__steps svg{color:#111}
`;

export type QrCardSize = 'grande' | 'pequeno';

/** Folha A4: 4 cartões grandes (2 × 2) ou 9 pequenos (3 × 3). */
export function sheetCss(size: QrCardSize) {
  const em = size === 'grande' ? '2.75mm' : '1.75mm';
  const cols = size === 'grande' ? 2 : 3;
  return `@page{size:A4;margin:12mm}
.tqr-sheet{display:grid;grid-template-columns:repeat(${cols},auto);justify-content:center;
  gap:6mm;font-size:${em}}
${TABLE_QR_CSS}`;
}
