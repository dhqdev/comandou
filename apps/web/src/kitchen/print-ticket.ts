import { paperWidth, type PaperWidth } from '../lib/pos-device';

/**
 * Impressão da comanda pelo próprio aparelho (impressora ligada no tablet ou no computador da
 * cozinha, ou a bobina da maquininha). Monta uma página de 80 mm (58 mm na maquininha) num
 * quadro escondido e chama a impressão do navegador.
 */
export interface TicketData {
  kitchen: string;
  number: number;
  where: string;
  time: string;
  items: { quantity: string; name: string; options: string[]; notes: string | null }[];
  notes: string | null;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? '&#39;',
  );

export function ticketHtml(t: TicketData, paper: PaperWidth = '80') {
  const narrow = paper === '58';
  const items = t.items
    .map(
      (i) =>
        `<li><b>${esc(i.quantity)}x</b> ${esc(i.name)}${i.options
          .map((o) => `<div class="op">+ ${esc(o)}</div>`)
          .join('')}${i.notes ? `<div class="ob">OBS: ${esc(i.notes)}</div>` : ''}</li>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Pedido #${t.number}</title><style>
@page{size:${paper}mm auto;margin:${narrow ? 2 : 4}mm}
body{font:${narrow ? 11 : 13}px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#000;margin:0;width:${narrow ? 48 : 72}mm}
h1{font-size:15px;text-align:center;margin:0 0 4px;text-transform:uppercase}
.n{font-size:22px;font-weight:700}
.row{display:flex;justify-content:space-between;align-items:baseline}
hr{border:0;border-top:1px dashed #000;margin:6px 0}
ul{list-style:none;margin:0;padding:0}li{margin:0 0 6px;font-size:${narrow ? 13 : 15}px}
.op{padding-left:14px;font-size:13px}.ob{padding-left:14px;font-weight:700}
</style></head><body>
<h1>${esc(t.kitchen)}</h1><hr>
<div class="row"><span class="n">#${t.number}</span><span>${esc(t.time)}</span></div>
<div>${esc(t.where)}</div><hr>
<ul>${items}</ul>
${t.notes ? `<hr><div class="ob">OBS DO PEDIDO: ${esc(t.notes)}</div>` : ''}
<hr></body></html>`;
}

export function printTicket(t: TicketData) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return frame.remove();
  doc.open();
  doc.write(ticketHtml(t, paperWidth()));
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 1000);
  frame.contentWindow?.addEventListener('afterprint', done);
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    done();
  }, 50);
}
