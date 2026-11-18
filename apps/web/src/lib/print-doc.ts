/**
 * Imprime um pedaço de HTML numa folha limpa (A4), sem o restante do sistema.
 *
 * Usa um iframe escondido: não depende de esconder a tela com CSS de impressão (o modal
 * mora dentro do app, então esconder o app deixava a folha em branco) e não é barrado
 * como janela pop-up.
 */
const FRAME_ID = 'cm-print-frame';

export function printDocument({
  title,
  html,
  css = '',
}: {
  title: string;
  html: string;
  css?: string;
}) {
  document.getElementById(FRAME_ID)?.remove();
  const frame = document.createElement('iframe');
  frame.id = FRAME_ID;
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>@page{size:A4;margin:18mm}*{box-sizing:border-box}
body{margin:0;font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#111;background:#fff}
${css}</style></head><body>${html}</body></html>`);
  doc.close();
  const win = frame.contentWindow!;
  // Tira o iframe só depois que a janela de impressão fechar.
  win.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 0));
  win.focus();
  win.print();
}

export function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
