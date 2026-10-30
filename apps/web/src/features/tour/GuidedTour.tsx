import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { Button, FrameItem, Mascot } from '../../design-system';
import '../welcome-tour.css';

/**
 * Motor do tour guiado: abre a tela de verdade, (se preciso) toca na aba certa, enquadra o
 * botão ou o bloco da vez e um cartão explica o que é e o que fazer. Serve para a apresentação
 * do primeiro acesso e para os tutoriais de cada tela (Cardápio, Nota fiscal).
 *
 * Cada parada só entra se a pessoa pode abrir a tela (mesmos itens do menu que ela vê).
 */

export type TourTarget = { button: string } | { css: string; text?: string };

export interface TourStop {
  /** Tela da parada (caminho de um item ou subitem do menu, ou coberto por `also`). */
  path: string;
  title: string;
  text: ReactNode;
  /** O que enquadrar, na ordem de preferência (texto de botão ou seletor CSS). */
  targets: TourTarget[];
  /** Tocado antes de enquadrar (abrir uma aba da tela). */
  click?: TourTarget;
  /** Rótulo do capítulo no topo do cartão (padrão: onde a tela fica no menu). */
  chapter?: string;
}

export interface TourEnds {
  /** Primeiro cartão (com o panda). */
  intro: { title: string; text: ReactNode; label?: string; start?: string };
  /** Último cartão. `menuKey` enquadra um item do menu; `targets`, algo na tela. */
  outro: { title: string; text: ReactNode; menuKey?: string; targets?: TourTarget[] };
}

type Rect = { x: number; y: number; w: number; h: number };

type Step =
  | { kind: 'intro' }
  | { kind: 'stop'; stop: TourStop; route: string; navKey: string; where: string }
  | { kind: 'outro' };

const PHONE = '(max-width: 860px)';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function visible(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none';
}

function findOne(t: TourTarget): HTMLElement | null {
  const root = document.querySelector('.cm-frame__content') ?? document.body;
  if ('css' in t) {
    // Seletor inválido não pode derrubar o tour.
    let list: HTMLElement[] = [];
    try {
      list = [...root.querySelectorAll<HTMLElement>(t.css)];
    } catch {
      return null;
    }
    return (
      list.find((e) => visible(e) && (!t.text || (e.textContent ?? '').includes(t.text))) ?? null
    );
  }
  const el = [...root.querySelectorAll('button, a, [role="tab"]')].find(
    (b) => visible(b) && (b.textContent ?? '').trim().startsWith(t.button),
  );
  return (el as HTMLElement) ?? null;
}

function findTarget(targets: TourTarget[]): HTMLElement | null {
  for (const t of targets) {
    const el = findOne(t);
    if (el) return el;
  }
  return null;
}

/** Botão do menu onde a tela fica: ícone da barra (computador) ou aba / "Mais" (celular). */
function findMenu(navKey: string): HTMLElement | null {
  const esc = (k: string) => k.replace(/"/g, '\\"');
  const el = [...document.querySelectorAll(`[data-tour-key="${esc(navKey)}"]`)].find(visible);
  if (el) return el;
  const more = document.querySelector('[data-tour-key="more"]');
  return visible(more) ? more : null;
}

/** Quando o alvo não existe (sem permissão, tela vazia): o título da tela. */
function findPageHead(): HTMLElement | null {
  const root = document.querySelector('.cm-frame__content');
  const el = root?.querySelector('.page-head, .mn-head, .mn-crumbs, h1.page-title, h1');
  return visible(el ?? null) ? (el as HTMLElement) : null;
}

/** Recorte do alvo, preso à parte visível da tela (bloco maior que a tela não some). */
const toRect = (el: HTMLElement | null, pad: number): Rect | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = Math.max(4, r.left - pad);
  const y = Math.max(4, r.top - pad);
  const right = Math.min(vw - 4, r.right + pad);
  const bottom = Math.min(vh - 4, r.bottom + pad);
  if (right - x < 4 || bottom - y < 4) return null;
  return { x, y, w: right - x, h: bottom - y };
};

/** Acha onde a tela fica no menu (primeiro nível, subitem ou tela interna de um subitem). */
export function locate(
  items: FrameItem[],
  path: string,
): { route: string; navKey: string; where: string } | null {
  const top = items.find((i) => i.key === path);
  if (top && !top.children?.some((c) => c.to === path))
    return { route: top.to ?? path, navKey: top.key, where: top.label };
  for (const g of items) {
    for (const c of g.children ?? []) {
      const a = c.also;
      const hit =
        c.to === path || (!!a && (a.endsWith('/*') ? path.startsWith(a.slice(0, -1)) : a === path));
      if (hit) return { route: path, navKey: g.key, where: `${g.label} › ${c.label}` };
    }
  }
  return null;
}

export function GuidedTour({
  open,
  onClose,
  stops,
  ends,
  items,
  tabs,
  label,
  maxStops,
}: {
  open: boolean;
  /** Fechou (pulou ou concluiu). `done` = chegou ao fim. */
  onClose: (done: boolean) => void;
  stops: TourStop[];
  ends: TourEnds;
  /** Itens do menu já filtrados pelas permissões (os mesmos da barra). */
  items: FrameItem[];
  /** Chaves que viram aba no celular (as outras ficam em "Mais"). */
  tabs: string[];
  /** Nome do tour para leitor de tela. */
  label: string;
  maxStops?: number;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const phone = useMedia(PHONE);

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [];
    for (const stop of stops) {
      if (maxStops && list.length >= maxStops) break;
      const at = locate(items, stop.path);
      if (at) list.push({ kind: 'stop', stop, ...at });
    }
    return [{ kind: 'intro' }, ...list, { kind: 'outro' }];
  }, [stops, items, maxStops]);

  const [index, setIndex] = useState(0);
  const last = steps.length - 1;
  const step = steps[Math.min(index, last)]!;

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const finish = useCallback((done: boolean) => onClose(done), [onClose]);

  const go = useCallback(
    (to: number) => {
      if (to < 0) return;
      if (to > last) return finish(true);
      setIndex(to);
    },
    [last, finish],
  );

  // Cada parada abre a tela de verdade.
  useEffect(() => {
    if (!open || step.kind !== 'stop') return;
    if (location.pathname !== step.route) navigate(step.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select');
      if (typing) return;
      if (e.key === 'ArrowRight') go(index + 1);
      if (e.key === 'ArrowLeft') go(index - 1);
      if (e.key === 'Escape') finish(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, go, finish]);

  const { hole, ring, menu } = useSpotlight(open, step, ends.outro);

  const cardRef = useRef<HTMLDivElement>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const target = ring;
  useEffect(() => {
    if (!open) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = cardRef.current?.offsetHeight ?? 260;
    const w = cardRef.current?.offsetWidth ?? 360;
    if (!target) {
      // Sem nada para apontar: cartão no meio da tela.
      setCardPos({
        top: Math.round(Math.max(12, (vh - h) / 2)),
        left: Math.round(Math.max(12, (vw - w) / 2)),
      });
      return;
    }
    const bar = document.querySelector('.cm-tabbar');
    const floor = visible(bar) ? bar.getBoundingClientRect().top - 12 : vh - 16;
    if (phone) {
      // Celular: o cartão fica no lado oposto ao alvo (embaixo, acima das abas).
      const below = target.y + target.h / 2 < vh / 2;
      setCardPos({ top: Math.round(below ? Math.max(12, floor - h) : 16), left: 12 });
      return;
    }
    if (target.h > vh * 0.5 || target.w > vw * 0.6) {
      // Bloco grande (uma aba inteira): cartão no canto de baixo, sem cobrir o começo do bloco.
      setCardPos({
        top: Math.round(Math.max(12, Math.min(floor, vh - 16) - h)),
        left: Math.round(vw - w - 20),
      });
      return;
    }
    const gap = 16;
    let top = target.y + target.h + gap;
    if (top + h > vh - 12) top = target.y - h - gap;
    let left = target.x + target.w / 2 - w / 2;
    if (top < 12) {
      // Não cabe em cima nem embaixo: ao lado.
      top = Math.min(Math.max(12, target.y + target.h / 2 - h / 2), vh - h - 12);
      left = target.x + target.w + gap;
      if (left + w > vw - 12) left = target.x - w - gap;
    }
    setCardPos({
      top: Math.round(Math.min(Math.max(12, top), vh - h - 12)),
      left: Math.round(Math.min(Math.max(12, left), vw - w - 12)),
    });
    // Arredonda o alvo para não reposicionar a cada pixel da animação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    phone,
    index,
    target && Math.round(target.x / 4),
    target && Math.round(target.y / 4),
    target && Math.round(target.w / 4),
    target && Math.round(target.h / 4),
  ]);

  // Foco no botão principal a cada passo (teclado e leitor de tela).
  useEffect(() => {
    if (!open) return;
    cardRef.current
      ?.querySelector<HTMLButtonElement>('[data-tour-next]')
      ?.focus({ preventScroll: true });
  }, [open, index]);

  if (!open) return null;

  const total = steps.length - 2;
  const title =
    step.kind === 'intro'
      ? ends.intro.title
      : step.kind === 'outro'
        ? ends.outro.title
        : step.stop.title;
  const chapter =
    step.kind === 'stop'
      ? (step.stop.chapter ??
        (phone && !tabs.includes(step.navKey) ? `Mais › ${step.where}` : step.where))
      : '';

  return createPortal(
    <div className="tourx" data-phone={phone || undefined}>
      <svg className="tourx__scrim" aria-hidden>
        <defs>
          <mask id="tourx-mask">
            <rect width="100%" height="100%" fill="white" />
            {[hole, menu].map(
              (r, i) =>
                r && <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={12} fill="black" />,
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" mask="url(#tourx-mask)" />
      </svg>
      {ring && (
        <div
          className="tourx__ring"
          style={{ left: ring.x, top: ring.y, width: ring.w, height: ring.h }}
          aria-hidden
        />
      )}
      {menu && menu !== ring && (
        <div
          className="tourx__ring tourx__ring--menu"
          style={{ left: menu.x, top: menu.y, width: menu.w, height: menu.h }}
          aria-hidden
        />
      )}

      <div
        ref={cardRef}
        className="tourx__card"
        data-placed={cardPos ? true : undefined}
        style={cardPos ? { top: cardPos.top, left: cardPos.left } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={step.kind === 'intro' ? (ends.intro.label ?? label) : label}
      >
        <button
          type="button"
          className="tourx__close"
          aria-label="Fechar"
          onClick={() => finish(false)}
        >
          <X size={16} />
        </button>
        <div key={index} className="tourx__body">
          {step.kind !== 'stop' && (
            <div className="tourx__hero">
              <Mascot
                size={step.kind === 'intro' ? 76 : 64}
                mood={step.kind === 'intro' ? 'joy' : 'wink'}
                animated
              />
            </div>
          )}
          {step.kind === 'stop' && (
            <span className="tourx__step">
              Passo {index} de {total} · {chapter}
            </span>
          )}
          <h3 className="tourx__title">{title}</h3>
          <div className="tourx__text">
            {step.kind === 'intro'
              ? ends.intro.text
              : step.kind === 'outro'
                ? ends.outro.text
                : step.stop.text}
          </div>
        </div>

        <div className="tourx__dots" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={i === index ? 'is-on' : i < index ? 'is-past' : ''} />
          ))}
        </div>

        <div className="tourx__foot">
          {index < last ? (
            <Button variant="ghost" onClick={() => finish(false)}>
              Pular
            </Button>
          ) : (
            <span />
          )}
          <div className="tourx__nav">
            {index > 0 && (
              <Button
                variant="secondary"
                aria-label="Voltar"
                icon={<ArrowLeft size={16} />}
                onClick={() => go(index - 1)}
              />
            )}
            <Button data-tour-next onClick={() => go(index + 1)}>
              {index === 0
                ? (ends.intro.start ?? 'Começar')
                : index === last
                  ? 'Concluir'
                  : 'Próximo'}
              {index < last && <ArrowRight size={16} />}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function useMedia(q: string) {
  const [on, setOn] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return on;
}

/**
 * Posição do recorte que segue o alvo. Toca na aba (se a parada pede), procura o alvo por alguns
 * segundos (tela carregando sob demanda), rola até ele e acompanha a cada quadro; o recorte
 * desliza de um alvo ao outro.
 */
function useSpotlight(open: boolean, step: Step, outro: TourEnds['outro']) {
  const [state, setState] = useState<{ hole: Rect | null; ring: Rect | null; menu: Rect | null }>({
    hole: null,
    ring: null,
    menu: null,
  });
  const shown = useRef<{ hole: Rect | null; menu: Rect | null }>({ hole: null, menu: null });

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let el: HTMLElement | null = null;
    let menuEl: HTMLElement | null = null;
    let scrolled = false;
    let clicked = false;
    let started = performance.now();
    const snap = reduced();

    const center = (): Rect => ({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      w: 0,
      h: 0,
    });
    const ease = (from: Rect | null, to: Rect | null): Rect | null => {
      if (!to) return null;
      if (!from || snap) return to;
      const k = 0.22;
      const n = {
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y - from.y) * k,
        w: from.w + (to.w - from.w) * k,
        h: from.h + (to.h - from.h) * k,
      };
      const close =
        Math.abs(n.x - to.x) + Math.abs(n.y - to.y) + Math.abs(n.w - to.w) + Math.abs(n.h - to.h) <
        1;
      return close ? to : n;
    };
    const same = (a: Rect | null, b: Rect | null) =>
      a === b ||
      (!!a &&
        !!b &&
        Math.abs(a.x - b.x) < 0.5 &&
        Math.abs(a.y - b.y) < 0.5 &&
        Math.abs(a.w - b.w) < 0.5 &&
        Math.abs(a.h - b.h) < 0.5);
    const scrollTo = (node: HTMLElement) => {
      const tall = node.getBoundingClientRect().height > window.innerHeight * 0.7;
      node.scrollIntoView({
        block: tall ? 'start' : 'center',
        inline: 'nearest',
        behavior: snap ? 'auto' : 'smooth',
      });
    };

    const tick = () => {
      let want: Rect | null = null;
      let wantMenu: Rect | null = null;
      if (step.kind === 'stop') {
        const { stop } = step;
        // Abre a aba pedida uma vez; o alvo é procurado depois do toque.
        if (stop.click && !clicked) {
          const tab = findOne(stop.click);
          if (tab) {
            clicked = true;
            if (tab.getAttribute('aria-selected') !== 'true') tab.click();
            started = performance.now();
          }
        }
        const waiting = performance.now() - started < (stop.click && !clicked ? 4000 : 2500);
        if (!el?.isConnected || !visible(el)) el = findTarget(stop.targets);
        // Sem o alvo (sem permissão ou ainda carregando): enquadra o título da tela.
        if (!el && (!waiting || !stop.targets.length)) el = findPageHead();
        if (!menuEl?.isConnected) menuEl = findMenu(step.navKey);
        if (el && !scrolled) {
          scrolled = true;
          scrollTo(el);
        }
        want = toRect(el, 6);
        wantMenu = toRect(menuEl, 4);
      } else if (step.kind === 'outro') {
        if (outro.targets?.length && !el?.isConnected) el = findTarget(outro.targets);
        if (outro.menuKey && !menuEl?.isConnected) menuEl = findMenu(outro.menuKey);
        const focus = el ?? menuEl;
        if (focus && !scrolled) {
          scrolled = true;
          focus.scrollIntoView({ block: 'nearest' });
        }
        want = toRect(el, 6);
        wantMenu = toRect(menuEl, 4);
      }
      const prev = shown.current;
      const hole = ease(prev.hole ?? (want ? center() : null), want);
      const menu = ease(prev.menu ?? (wantMenu ? center() : null), wantMenu);
      if (!same(hole, prev.hole) || !same(menu, prev.menu)) {
        shown.current = { hole, menu };
        // No fim, o cartão se apoia no menu se não houver alvo na tela.
        setState({ hole, ring: hole ?? (step.kind === 'outro' ? menu : null), menu });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, step, outro]);

  useEffect(() => {
    if (!open) {
      shown.current = { hole: null, menu: null };
      setState({ hole: null, ring: null, menu: null });
    }
  }, [open]);

  return state;
}
