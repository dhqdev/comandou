import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { Button, FrameItem, Mascot } from '../design-system';
import './welcome-tour.css';

/**
 * Apresentação do primeiro acesso, em forma de tour guiado: passa pelas telas de verdade e
 * enquadra o botão que a pessoa deve tocar primeiro (e o lugar do menu onde a tela fica).
 * Poucos passos, na ordem de quem está começando: loja, cardápio, equipe, caixa e venda.
 * Respeita as permissões (só entra no passo cuja tela a pessoa pode abrir). Fica marcada como
 * vista neste aparelho, por usuário; dá para rever em Conta › Rever apresentação.
 */

interface TourStop {
  /** Tela (chave do item do menu ou caminho de um subitem). */
  path: string;
  title: string;
  text: string;
  /** O que enquadrar na tela, na ordem de preferência (texto de botão ou seletor CSS). */
  targets: ({ button: string } | { css: string; text?: string })[];
}

const STOPS: TourStop[] = [
  {
    path: '/loja-online',
    title: 'Deixe a loja com a sua cara',
    text: 'Coloque logo, capa e cores. Em Funcionamento você define os horários. É isso que o cliente vê no cardápio online.',
    targets: [{ css: '[aria-label="Seções da loja online"]' }],
  },
  {
    path: '/cardapio',
    title: 'Cadastre o cardápio',
    text: 'Toque em Adicionar item para criar cada prato com foto, preço e adicionais. Ele aparece na hora no PDV, no salão e na loja online.',
    targets: [{ button: 'Adicionar item' }],
  },
  {
    path: '/equipe',
    title: 'Chame a sua equipe',
    text: 'Em Adicionar pessoa você cria o acesso do garçom, da cozinha e do caixa. Cada um vê só o que precisa.',
    targets: [{ button: 'Adicionar pessoa' }],
  },
  {
    path: '/caixa',
    title: 'Abra o caixa no começo do turno',
    text: 'Informe o troco inicial em Abrir caixa. No fim do dia você fecha e confere o total de cada forma de pagamento. Ainda não tem terminal? Ele é criado em Sistema › Ajustes.',
    targets: [
      { button: 'Abrir caixa' },
      { button: 'Ver movimento' },
      { css: '.cm-empty', text: 'terminal' },
    ],
  },
  {
    path: '/',
    title: 'Pronto para vender',
    text: 'Nova venda (atalho F2) lança pedidos de balcão, retirada e telefone. Os pedidos da loja online e do salão também chegam aqui, com aviso sonoro.',
    targets: [{ css: '.pdv__new' }],
  },
  {
    path: '/mesas',
    title: 'Salão e mesas',
    text: 'O mapa mostra as mesas livres, ocupadas e pedindo a conta. Toque numa mesa para abrir a comanda e lançar itens.',
    targets: [],
  },
  {
    path: '/pedidos',
    title: 'Pedidos em tempo real',
    text: 'Todo pedido cai aqui na hora, com aviso sonoro. Toque no pedido para aceitar, acompanhar e imprimir.',
    targets: [],
  },
  {
    path: '/cozinha',
    title: 'Cozinha',
    text: 'Cada item chega por ordem de chegada. Marque em preparo e pronto, e o salão fica sabendo.',
    targets: [],
  },
];

/** Tour curto: no máximo estas paradas (as primeiras que a pessoa pode ver). */
const MAX_STOPS = 5;

const storageKey = (tenantId: string, userId: string) => `cm-tour:${tenantId}:${userId}`;

export function tourSeen(tenantId: string, userId: string) {
  try {
    return localStorage.getItem(storageKey(tenantId, userId)) === 'done';
  } catch {
    // Sem armazenamento não dá para lembrar: melhor não mostrar a cada recarga.
    return true;
  }
}

function markSeen(tenantId: string, userId: string) {
  try {
    localStorage.setItem(storageKey(tenantId, userId), 'done');
  } catch {
    /* sem armazenamento */
  }
}

type Rect = { x: number; y: number; w: number; h: number };

type Step =
  | { kind: 'welcome' }
  | { kind: 'stop'; stop: TourStop; route: string; navKey: string; where: string }
  | { kind: 'done' };

const PHONE = '(max-width: 860px)';
const isPhone = () => window.matchMedia(PHONE).matches;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function visible(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none';
}

function findTarget(stop: TourStop): HTMLElement | null {
  const root = document.querySelector('.cm-frame__content') ?? document.body;
  for (const t of stop.targets) {
    if ('css' in t) {
      const el = [...root.querySelectorAll<HTMLElement>(t.css)].find(
        (e) => visible(e) && (!t.text || (e.textContent ?? '').includes(t.text)),
      );
      if (el) return el;
    } else {
      const el = [...root.querySelectorAll('button, a')].find(
        (b) => visible(b) && (b.textContent ?? '').trim().startsWith(t.button),
      );
      if (el) return el as HTMLElement;
    }
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

/** Fallback quando o botão não existe (sem permissão, tela vazia): o título da tela. */
function findPageHead(): HTMLElement | null {
  const root = document.querySelector('.cm-frame__content');
  const el = root?.querySelector('.page-head, h1.page-title, h1');
  return visible(el ?? null) ? (el as HTMLElement) : null;
}

const toRect = (el: HTMLElement | null, pad: number): Rect | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
};

export function WelcomeTour({
  open,
  onClose,
  tenantId,
  userId,
  userName,
  tenantName,
  items,
  tabs,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  userId: string;
  userName: string;
  tenantName: string;
  /** Itens do menu já filtrados pelas permissões (os mesmos da barra). */
  items: FrameItem[];
  /** Chaves que viram aba no celular (as outras ficam em "Mais"). */
  tabs: string[];
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const phone = useMedia(PHONE);

  const steps = useMemo<Step[]>(() => {
    const stops: Step[] = [];
    for (const stop of STOPS) {
      if (stops.length >= MAX_STOPS) break;
      // Tela no primeiro nível (PDV, Caixa, Cardápio…) ou dentro de um grupo (Gestão › Equipe).
      const top = items.find((i) => i.key === stop.path);
      if (top) {
        stops.push({
          kind: 'stop',
          stop,
          route: top.to ?? top.key,
          navKey: top.key,
          where: top.label,
        });
        continue;
      }
      const group = items.find((i) => i.children?.some((c) => c.to === stop.path));
      const child = group?.children?.find((c) => c.to === stop.path);
      if (group && child)
        stops.push({
          kind: 'stop',
          stop,
          route: child.to,
          navKey: group.key,
          where: `${group.label} › ${child.label}`,
        });
    }
    // Garçom/cozinha sem nenhuma das telas acima: não tem o que mostrar além do recado.
    return [{ kind: 'welcome' }, ...stops, { kind: 'done' }];
  }, [items]);

  const [index, setIndex] = useState(0);
  const last = steps.length - 1;
  const step = steps[Math.min(index, last)]!;

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const finish = useCallback(() => {
    markSeen(tenantId, userId);
    onClose();
  }, [tenantId, userId, onClose]);

  const go = useCallback(
    (to: number) => {
      if (to < 0) return;
      if (to > last) return finish();
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
      if (e.key === 'ArrowRight') go(index + 1);
      if (e.key === 'ArrowLeft') go(index - 1);
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, go, finish]);

  // Acha o botão (a tela pode ainda estar carregando), rola até ele e segue a posição.
  const { hole, ring, menu } = useSpotlight(open, step);

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
      // Sem botão para apontar: cartão no meio da tela.
      setCardPos({
        top: Math.round(Math.max(12, (vh - h) / 2)),
        left: Math.round(Math.max(12, (vw - w) / 2)),
      });
      return;
    }
    if (phone) {
      // Celular: o cartão fica no lado oposto ao botão enquadrado.
      // Embaixo, para em cima das abas, para a aba enquadrada continuar à vista.
      const below = target.y + target.h / 2 < vh / 2;
      const bar = document.querySelector('.cm-tabbar');
      const floor = visible(bar) ? bar.getBoundingClientRect().top - 12 : vh - 16;
      setCardPos({ top: Math.round(below ? Math.max(12, floor - h) : 16), left: 12 });
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
  ]);

  // Foco no botão principal a cada passo (teclado e leitor de tela).
  useEffect(() => {
    if (!open) return;
    cardRef.current
      ?.querySelector<HTMLButtonElement>('[data-tour-next]')
      ?.focus({ preventScroll: true });
  }, [open, index]);

  if (!open) return null;

  const firstName = userName.split(' ')[0] ?? userName;
  const stops = steps.length - 2;
  const title =
    step.kind === 'welcome'
      ? `Olá, ${firstName}!`
      : step.kind === 'done'
        ? 'Tudo pronto!'
        : step.stop.title;

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
        aria-label={step.kind === 'welcome' ? 'Boas-vindas' : 'Apresentação'}
      >
        <button type="button" className="tourx__close" aria-label="Fechar" onClick={finish}>
          <X size={16} />
        </button>
        <div key={index} className="tourx__body">
          {step.kind !== 'stop' && (
            <div className="tourx__hero">
              <Mascot
                size={step.kind === 'welcome' ? 76 : 64}
                mood={step.kind === 'welcome' ? 'joy' : 'wink'}
                animated
              />
            </div>
          )}
          {step.kind === 'stop' && (
            <span className="tourx__step">
              Passo {index} de {stops} ·{' '}
              {phone && !tabs.includes(step.navKey) ? `Mais › ${step.where}` : step.where}
            </span>
          )}
          <h3 className="tourx__title">{title}</h3>
          {step.kind === 'welcome' && (
            <p className="tourx__text">
              Este é o painel de <b>{tenantName}</b>. Em {stops} passos rápidos mostramos o que
              fazer primeiro e onde fica cada coisa.
            </p>
          )}
          {step.kind === 'stop' && <p className="tourx__text">{step.stop.text}</p>}
          {step.kind === 'done' && (
            <p className="tourx__text">
              {menu ? 'Quando quiser rever, abra ' : 'Quando quiser rever, vá em '}
              <b>{phone ? 'Mais › Conta' : 'Conta'} › Rever apresentação</b>. Dica:{' '}
              {phone ? 'a lupa no topo' : <b>Ctrl + K</b>} acha qualquer tela, pedido ou produto.
            </p>
          )}
        </div>

        <div className="tourx__dots" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={i === index ? 'is-on' : i < index ? 'is-past' : ''} />
          ))}
        </div>

        <div className="tourx__foot">
          {index < last ? (
            <Button variant="ghost" onClick={finish}>
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
              {index === 0 ? 'Começar' : index === last ? 'Concluir' : 'Próximo'}
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
 * Posição do recorte que segue o botão. Procura o alvo por até 5 s (tela carregando sob
 * demanda), rola até ele e acompanha a cada quadro; o recorte desliza de um alvo ao outro.
 */
function useSpotlight(open: boolean, step: Step) {
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
    const started = performance.now();
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

    const tick = () => {
      let want: Rect | null = null;
      let wantMenu: Rect | null = null;
      if (step.kind === 'stop') {
        const waiting = performance.now() - started < 2500;
        if (!el?.isConnected) el = findTarget(step.stop);
        // Sem o botão (sem permissão ou ainda carregando): enquadra o título da tela.
        if (!el && (!waiting || !step.stop.targets.length)) el = findPageHead();
        if (!menuEl?.isConnected) menuEl = findMenu(step.navKey);
        if (el && !scrolled) {
          scrolled = true;
          el.scrollIntoView({
            block: 'center',
            inline: 'nearest',
            behavior: snap ? 'auto' : 'smooth',
          });
        }
        want = toRect(el, 6);
        wantMenu = toRect(menuEl, 4);
      } else if (step.kind === 'done') {
        if (!menuEl?.isConnected) menuEl = findMenu('conta');
        if (menuEl && !scrolled) {
          scrolled = true;
          menuEl.scrollIntoView({ block: 'nearest' });
        }
        wantMenu = toRect(menuEl, 4);
      }
      const prev = shown.current;
      const hole = ease(prev.hole ?? (want ? center() : null), want);
      const menu = ease(prev.menu ?? (wantMenu ? center() : null), wantMenu);
      if (!same(hole, prev.hole) || !same(menu, prev.menu)) {
        shown.current = { hole, menu };
        // No fim, o cartão se apoia no menu se não houver botão na tela.
        setState({ hole, ring: hole ?? (step.kind === 'done' ? menu : null), menu });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, step]);

  useEffect(() => {
    if (!open) {
      shown.current = { hole: null, menu: null };
      setState({ hole: null, ring: null, menu: null });
    }
  }, [open]);

  return state;
}
