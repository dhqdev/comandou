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
 * desce de volta. Fora desse defeito a folga é 0 e nada muda. No fim da página (e no elástico de
 * passar do fim) a folga não é medida de novo: lá as medidas mudam enquanto a página quica e o
 * menu sumia até o dedo soltar.
 *
 * Teclado previsto nas conversas: no iPhone o tamanho do teclado só chega depois que ele termina
 * de subir. Até lá a conversa (presa à tela) era empurrada para cima, com o topo cortado, e só
 * então voltava para o lugar ("quebra para cima e depois arruma"). Ao tocar no campo de mensagem
 * de uma conversa no celular, já encolhemos a conversa para o tamanho que o teclado vai deixar
 * (o último medido neste aparelho, ou 45% da tela na primeira vez: o teclado do iPhone com a
 * barra de sugestões e a de "Concluído" passa de 40%, e prever menos fazia o iPhone empurrar a
 * tela do mesmo jeito). Com o campo já acima do teclado, o iPhone não precisa empurrar nada;
 * quando o tamanho de verdade chega, ele vale. A previsão segura até o teclado chegar (a
 * primeira abertura do teclado no iPhone pode passar de um segundo): antes ela se desfazia em
 * 0,9 s, a conversa voltava a ocupar a tela toda e o teclado chegava empurrando tudo para cima.
 * Se o teclado não abrir (teclado físico), ela se desfaz depois de PREDICT_MS.
 *
 * Android: na conversa do cardápio o Chrome passa a encolher a página com o teclado
 * (interactive-widget=resizes-content, ChatScreen) em vez de deslizar a parte visível. Aí a
 * altura "de layout" também encolhe, e o teclado é medido contra a maior altura já vista nesta
 * largura de tela.
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
 *  conversas do Super Admin, conversa da IA dos Modelos de impressão). */
const CHAT = '.tc-panel, .sfchat, .adm-support, .scx, .tpl-ai-dock';
const KB_KEY = 'cm-kb-h';
/** Quanto tempo a previsão espera o teclado de verdade aparecer (teclado físico: não aparece). */
const PREDICT_MS = 2500;
/** Primeira vez neste aparelho: parte da tela que o teclado deve ocupar. */
const FIRST_GUESS = 0.45;
/** A altura de layout encolheu mais que isso: foi o teclado (Android), não a barra do navegador. */
const LAYOUT_KB = 150;

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

/**
 * A página está no fim ou passou de uma das pontas (o elástico do iPhone deixa o scrollY
 * negativo ou além do fim enquanto quica).
 */
export function overscrolled() {
  const y = window.scrollY;
  const end = document.documentElement.scrollHeight - window.innerHeight;
  return y < 0 || (end > 0 && y >= end - 1);
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

export function trackViewport(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement;
  const probe = fixedProbe();
  const stop = new AbortController();
  let raf = 0;
  // Teclado previsto (altura) e até quando ele vale sem o de verdade aparecer.
  let predicted = 0;
  let predictUntil = 0;
  let predictTimer = 0;
  let known = savedKeyboard();
  // Maior altura de layout vista nesta largura (tela sem teclado).
  let full = 0;
  let fullWidth = 0;
  /** Altura da tela sem teclado: a de layout, ou a maior vista se o teclado encolheu o layout. */
  const baseHeight = (layout: number) => {
    const w = root.clientWidth || window.innerWidth;
    if (w !== fullWidth) {
      fullWidth = w;
      full = layout;
    } else if (layout > full) full = layout;
    return full - layout > LAYOUT_KB && typing() ? full : layout;
  };
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
    const base = baseHeight(layout);
    const top = Math.max(0, vv.offsetTop);
    const covered = Math.max(0, layout - vv.height - top);
    const open = base - vv.height > 80 && typing();
    if (open) {
      predicted = 0;
      window.clearTimeout(predictTimer);
      const kb = Math.round(base - vv.height);
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
      apply(base - predicted, 0, predicted, true);
      root.style.setProperty('--cm-fixgap', '0px');
      return;
    } else {
      predicted = 0;
    }
    apply(vv.height, top, covered, open);
    // Elástico das pontas (rolar além do fim e soltar): o navegador mexe nas medidas enquanto a
    // página quica, e a folga medida ali empurrava o menu de baixo para fora da tela até o dedo
    // sair. Na ponta, a folga fica como estava.
    if (!open && overscrolled()) return;
    // Com o teclado aberto quem manda é o --cm-kb; a folga só vale com ele fechado.
    const gap = open ? 0 : Math.round(window.innerHeight - probe.getBoundingClientRect().bottom);
    const fix = gap > 2 && gap < window.innerHeight / 2 ? gap : 0;
    root.style.setProperty('--cm-fixgap', `${fix}px`);
  };
  const schedule = () => {
    // Timer atrasado depois que a página (ou o teste) já fechou: não há mais quadro para pedir.
    if (typeof requestAnimationFrame !== 'function') return;
    if (!raf) raf = requestAnimationFrame(update);
  };
  /** Toque no campo de uma conversa: encolhe já, antes de o iPhone empurrar a tela. */
  const predict = (e: Event) => {
    const el = e.target as Element | null;
    if (!el?.closest?.(CHAT) || !typing() || !phone()) return;
    if (root.classList.contains('cm-kb-open')) return;
    const layout = root.clientHeight || window.innerHeight;
    const base = baseHeight(layout);
    // Teclado já aberto (só mudou de campo): nada a prever.
    if (base - vv.height > 80) return;
    predicted = Math.min(known || Math.round(base * FIRST_GUESS), Math.round(base * 0.6));
    predictUntil = performance.now() + PREDICT_MS;
    apply(base - predicted, 0, predicted, true);
    window.clearTimeout(predictTimer);
    predictTimer = window.setTimeout(schedule, PREDICT_MS + 20);
  };
  // O tamanho e o deslize da área visível valem na hora, sem esperar o próximo quadro: cada
  // quadro de atraso mostrava a conversa fora do lugar enquanto o teclado subia.
  const on = { signal: stop.signal };
  vv.addEventListener('resize', update, on);
  vv.addEventListener('scroll', update, on);
  // O defeito do iOS 26 aparece ao rolar a página, sem mudar o tamanho da área visível.
  window.addEventListener('scroll', schedule, { passive: true, signal: stop.signal });
  window.addEventListener('resize', schedule, on);
  // O teclado pode abrir/fechar sem mudar o tamanho na hora (troca de campo, botão OK do iPhone).
  document.addEventListener(
    'focusin',
    (e) => {
      predict(e);
      schedule();
    },
    on,
  );
  document.addEventListener('focusout', () => setTimeout(schedule, 50), on);
  update();
  /** Para de acompanhar (testes). */
  return () => {
    stop.abort();
    window.clearTimeout(predictTimer);
    cancelAnimationFrame(raf);
    probe.remove();
  };
}
