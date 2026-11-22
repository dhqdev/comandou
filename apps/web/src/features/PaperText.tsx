import { parsePrintLines } from '@comandou/shared';
import { Fragment } from 'react';

/**
 * Papel da bobina na tela, igual ao que sai na térmica: linhas com negrito, letra grande (largura
 * e altura duplas) e a logo do restaurante, lidas das marcas do texto (`@@N@@`, `@@G@@`,
 * `@@LOGO@@`). Sem `logoUrl`, a logo aparece como um quadro "LOGO" no lugar.
 */
export function PaperText({
  text,
  logoUrl,
  className = 'receipt-paper',
  label = 'Prévia do papel',
}: {
  text: string;
  logoUrl?: string | null;
  className?: string;
  label?: string;
}) {
  return (
    <pre className={`${className} paper-text`} aria-label={label}>
      {parsePrintLines(text).map((l, i) => (
        <Fragment key={i}>
          {l.kind === 'logo' ? (
            <span className="paper-text__logo">
              {logoUrl ? <img src={logoUrl} alt="Logo do restaurante" /> : <span>LOGO</span>}
            </span>
          ) : l.kind === 'qr' ? (
            <span className="paper-text__qr">[QR Code] {l.data}</span>
          ) : l.kind === 'bold' ? (
            <b>{l.text}</b>
          ) : l.kind === 'big' ? (
            <b className="paper-text__big">{l.text}</b>
          ) : (
            l.text
          )}
          {l.kind !== 'logo' && '\n'}
        </Fragment>
      ))}
    </pre>
  );
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** O mesmo papel em HTML, para imprimir pelo navegador (iframe sem React). */
export function paperHtml(text: string, logoUrl?: string | null) {
  return parsePrintLines(text)
    .map((l) => {
      if (l.kind === 'logo')
        return logoUrl
          ? `<span class="logo"><img src="${esc(new URL(logoUrl, location.origin).href)}" alt=""></span>`
          : '';
      if (l.kind === 'qr') return `${esc(l.data)}\n`;
      if (l.kind === 'bold') return `<b>${esc(l.text)}</b>\n`;
      if (l.kind === 'big') return `<b class="big">${esc(l.text)}</b>\n`;
      return `${esc(l.text)}\n`;
    })
    .join('');
}
