/**
 * Área visível de verdade (teclado do celular).
 *
 * O iPhone não encolhe a página quando o teclado abre: ele só desliza a parte visível para cima
 * (visualViewport.offsetTop) e deixa o resto atrás do teclado. Janelas presas à tela (position:
 * fixed, top 0) ficam então com o topo cortado e o rodapé escondido, e aparece o fundo por baixo.
 *
 * Aqui guardamos o retângulo visível em variáveis do CSS:
 * - --cm-vvh: altura visível;
 * - --cm-vvtop: quanto o iPhone deslizou a parte visível para baixo;
 * - --cm-kb: pedaço de baixo coberto pelo teclado.
 * Com o teclado aberto, html.cm-kb-open prende as janelas (dialog, chat) exatamente nesse
 * retângulo (base.css), e o rodapé perde a folga do risco do iPhone.
 */
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Foco num campo que abre teclado (pinça de zoom sem campo focado não conta como teclado). */
function typing() {
  const el = document.activeElement;
  if (!el || !el.matches(EDITABLE)) return false;
  const type = (el as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset'].includes(
    type,
  );
}

export function trackViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let raf = 0;
  const update = () => {
    raf = 0;
    // Altura da tela "de layout" (não muda com o teclado no iPhone; no Android ela já encolhe).
    const layout = root.clientHeight || window.innerHeight;
    const top = Math.max(0, vv.offsetTop);
    const covered = Math.max(0, layout - vv.height - top);
    const open = layout - vv.height > 80 && typing();
    root.style.setProperty('--cm-vvh', `${Math.round(vv.height)}px`);
    root.style.setProperty('--cm-vvtop', `${Math.round(open ? top : 0)}px`);
    root.style.setProperty('--cm-kb', `${Math.round(open ? covered : 0)}px`);
    root.classList.toggle('cm-kb-open', open);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  // O teclado pode abrir/fechar sem mudar o tamanho na hora (troca de campo, botão OK do iPhone).
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', () => setTimeout(schedule, 50));
  update();
}
