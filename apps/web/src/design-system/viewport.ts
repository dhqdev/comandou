/**
 * Área visível de verdade (teclado do celular). O iPhone não encolhe a página quando o teclado
 * abre: as folhas que sobem de baixo ficariam com o rodapé escondido atrás dele. Aqui a altura
 * visível vira --cm-vvh, o pedaço coberto pelo teclado vira --cm-kb e html.cm-kb-open marca o
 * teclado aberto (as folhas sobem junto e o rodapé perde a folga do risco do iPhone).
 */
export function trackViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let raf = 0;
  const update = () => {
    raf = 0;
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--cm-vvh', `${Math.round(vv.height)}px`);
    root.style.setProperty('--cm-kb', `${Math.round(covered)}px`);
    root.classList.toggle('cm-kb-open', covered > 80);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  update();
}
