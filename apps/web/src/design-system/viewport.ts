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
 *
 * --cm-fixgap: quanto o que é preso embaixo (position: fixed; bottom: 0) ficou acima do fim da
 * tela. No Safari do iOS 26, depois de abrir e fechar o teclado, a área "de layout" das peças
 * fixas pode ficar mais curta que a janela (WebKit 297779): o menu de baixo sobe ao rolar e fica
 * uma faixa vazia embaixo. Um marcador invisível preso em bottom: 0 mede essa folga e o menu
 * desce de volta. Fora desse defeito a folga é 0 e nada muda.
 *
 * Teclado previsto nas conversas: no iPhone o tamanho do teclado só chega depois que ele termina
 * de subir. Até lá a conversa (presa à tela) era empurrada para cima, com o topo cortado, e só
 * então voltava para o lugar ("quebra para cima e depois arruma"). Ao tocar no campo de mensagem
 * de uma conversa no celular, já encolhemos a conversa para o tamanho que o teclado vai deixar
 * (o último medido neste aparelho, ou 40% da tela na primeira vez). Com o campo já acima do
 * teclado, o iPhone não precisa empurrar nada; quando o tamanho de verdade chega, ele vale.
 * Se o teclado não abrir (teclado físico), a previsão se desfaz sozinha.
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

/** Campos de conversa que ganham o teclado previsto (painel do chat, conversa do cardápio,
 *  conversas do Super Admin). */
const CHAT = '.tc-panel, .sfchat, .adm-support, .scx';
const KB_KEY = 'cm-kb-h';
/** Quanto tempo a previsão espera o teclado de verdade aparecer. */
const PREDICT_MS = 900;

function savedKeyboard() {
  try {
    const n = Number(localStorage.getItem(KB_KEY));
    return n > 80 ? n : 0;
  } catch {
    return 0;
  }
}

/** Celular com tela de toque (teclado na tela). */
function phone() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse) and (max-width: 860px)').matches
  );
}

/** Marcador invisível preso no fim da área das peças fixas. */
function fixedProbe() {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText =
    'position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none';
  document.body.append(el);
  return el;
}

export function trackViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const probe = fixedProbe();
  let raf = 0;
  // Teclado previsto (altura) e até quando ele vale sem o de verdade aparecer.
  let predicted = 0;
  let predictUntil = 0;
  let predictTimer = 0;
  let known = savedKeyboard();
  const apply = (vvh: number, top: number, kb: number, open: boolean) => {
    root.style.setProperty('--cm-vvh', `${Math.round(vvh)}px`);
    root.style.setProperty('--cm-vvtop', `${Math.round(open ? top : 0)}px`);
    root.style.setProperty('--cm-kb', `${Math.round(open ? kb : 0)}px`);
    root.classList.toggle('cm-kb-open', open);
  };
  const update = () => {
    raf = 0;
    // Altura da tela "de layout" (não muda com o teclado no iPhone; no Android ela já encolhe).
    const layout = root.clientHeight || window.innerHeight;
    const top = Math.max(0, vv.offsetTop);
    const covered = Math.max(0, layout - vv.height - top);
    const open = layout - vv.height > 80 && typing();
    if (open) {
      predicted = 0;
      const kb = Math.round(layout - vv.height);
      if (Math.abs(kb - known) > 4) {
        known = kb;
        try {
          localStorage.setItem(KB_KEY, String(kb));
        } catch {
          /* sem armazenamento: prevê com a proporção da tela */
        }
      }
    } else if (predicted && typing() && performance.now() < predictUntil) {
      // O teclado ainda está subindo: segura a previsão até o tamanho de verdade chegar.
      apply(layout - predicted, 0, predicted, true);
      root.style.setProperty('--cm-fixgap', '0px');
      return;
    } else {
      predicted = 0;
    }
    apply(vv.height, top, covered, open);
    // Com o teclado aberto quem manda é o --cm-kb; a folga só vale com ele fechado.
    const gap = open ? 0 : Math.round(window.innerHeight - probe.getBoundingClientRect().bottom);
    const fix = gap > 2 && gap < window.innerHeight / 2 ? gap : 0;
    root.style.setProperty('--cm-fixgap', `${fix}px`);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  /** Toque no campo de uma conversa: encolhe já, antes de o iPhone empurrar a tela. */
  const predict = (e: Event) => {
    const el = e.target as Element | null;
    if (!el?.closest?.(CHAT) || !typing() || !phone()) return;
    if (root.classList.contains('cm-kb-open')) return;
    const layout = root.clientHeight || window.innerHeight;
    // Com a tela já encolhida (Android), o teclado não cobre nada: nada a prever.
    if (layout - vv.height > 80) return;
    predicted = Math.min(known || Math.round(layout * 0.4), Math.round(layout * 0.6));
    predictUntil = performance.now() + PREDICT_MS;
    apply(layout - predicted, 0, predicted, true);
    window.clearTimeout(predictTimer);
    predictTimer = window.setTimeout(schedule, PREDICT_MS + 20);
  };
  // O tamanho e o deslize da área visível valem na hora, sem esperar o próximo quadro: cada
  // quadro de atraso mostrava a conversa fora do lugar enquanto o teclado subia.
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  // O defeito do iOS 26 aparece ao rolar a página, sem mudar o tamanho da área visível.
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  // O teclado pode abrir/fechar sem mudar o tamanho na hora (troca de campo, botão OK do iPhone).
  document.addEventListener('focusin', (e) => {
    predict(e);
    schedule();
  });
  document.addEventListener('focusout', () => setTimeout(schedule, 50));
  update();
}
