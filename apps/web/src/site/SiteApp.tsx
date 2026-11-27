import {
  Armchair,
  ArrowRight,
  Bike,
  CalendarDays,
  ChartColumn,
  Check,
  CheckCheck,
  ChefHat,
  Layers,
  Menu,
  MessageCircle,
  Monitor,
  MousePointerClick,
  Package,
  PiggyBank,
  Printer,
  QrCode,
  Receipt,
  ShoppingBag,
  Sparkles,
  Store,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import {
  applyTheme,
  Button,
  LivePanda,
  Mascot,
  Modal,
  type ButtonProps,
  type PandaMood,
} from '../design-system';
import { lazyPage } from '../lib/lazy-page';
import { SANDBOX_MSG, sandboxScreenOf, SITE_MSG } from '../lib/sandbox';
import { brl } from '../lib/money';
import { contactHref, INCLUDED_IN_ALL, type PublicPlan } from '../pages/pricing-data';
import { Builder, FIRST_LOOK } from './Builder';
import { RollIn, RollingValue, SiteLink, useSitePath } from './fx';
import { loadSiteConfig, type SiteConfig } from './host';
import {
  calmMotion,
  scrollToEl,
  useReadingBar,
  useScrollProgress,
  useSmoothScroll,
  useTilt,
} from './motion';
import { PhoneMock, type Look } from './PhoneMock';
import { Shuffle, ShuffleWords } from './Shuffle';
import {
  APP_FEATURES,
  APP_HUE,
  APP_ORDERS,
  DELIVERY_APPS,
  HERO_ORDERS,
  HERO_WORDS,
  MODULES,
  SITE_FAQ,
  STEPS,
  TOUR,
} from './site-data';
import './site.css';
import './landing.css';

// O site é sempre claro (pedido do dono): não segue o tema do aparelho nem guarda escolha.
// Roda ao carregar este arquivo, antes do primeiro desenho, para não piscar escuro.
applyTheme('light');

/** A lanchonete de demonstração (/demo) é um arquivo à parte: só baixa quando alguém abre. */
const DemoStore = lazyPage(
  () => import('./DemoStore'),
  (m) => m.DemoStore,
);

/**
 * Site público do Comandou (comandou.com). Minimalista, com movimento de propósito: os títulos
 * com o Shuffle do React Bits, o celular do topo com o cardápio de uma lanchonete de verdade e a
 * lanchonete de demonstração (/demo) para testar na hora.
 * Tudo com os tokens do sistema; com "reduzir movimento" ligado, a página fica parada.
 */
export function SiteApp() {
  const path = useSitePath();
  if (/^\/demo\/?$/.test(path)) return <DemoStore />;
  return <Landing />;
}

/** Botão principal do site: afunda ao clicar (`.st-press`); com `arrow`, a seta anda no hover. */
function CtaButton({
  className = '',
  arrow,
  children,
  ...props
}: ButtonProps & { arrow?: boolean }) {
  return (
    <Button {...props} className={`st-press ${arrow ? 'st-arrow' : ''} ${className}`}>
      {children}
      {arrow && <ArrowRight size={16} className="st-arrow__i" aria-hidden />}
    </Button>
  );
}

/** Seções entram quando chegam na tela (uma vez só), com os filhos em cascata. */
function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.st-reveal')];
    if (!('IntersectionObserver' in window) || !els.length) return;
    document.documentElement.classList.add('st-js');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    els.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      document.documentElement.classList.remove('st-js');
    };
  }, []);
}

/** "Entrar": quem já é cliente diz o endereço do restaurante e vai para a tela de login dele. */
function EnterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [slug, setSlug] = useState('');
  const base = window.location.host.replace(/^www\./, '');
  const clean = slug
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(new RegExp(`\\.${base.replace(/[.:]/g, '\\$&')}.*$`), '')
    .replace(/[^a-z0-9-]/g, '');
  const go = () => {
    if (clean.length >= 3) window.location.assign(`${window.location.protocol}//${clean}.${base}/`);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Entrar no seu restaurante"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={go} disabled={clean.length < 3}>
            Continuar
          </Button>
        </>
      }
    >
      <form
        className="st-enter"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <label className="cm-label" htmlFor="st-enter">
          Endereço do restaurante
        </label>
        <div className="st-enter__row">
          <input
            id="st-enter"
            className="cm-input"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="seu-restaurante"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <span>.{base}</span>
        </div>
        <span className="cm-hint">É o endereço que veio no e-mail de boas-vindas.</span>
      </form>
    </Modal>
  );
}

/** Situação do pedido pela posição na fila: o de cima acabou de chegar. */
const HERO_STATUS = [
  ['Novo', 'new'],
  ['Preparando', 'cook'],
  ['Pronto', 'ready'],
  ['Pronto', 'ready'],
] as const;

/**
 * Quadro "Pedidos agora" do topo: a cada poucos segundos chega um pedido de um canal diferente
 * (mesa, balcão, cardápio online, aplicativos), os de baixo andam uma casa (FLIP, só transform)
 * e as vendas do dia rolam como um contador. Com "reduzir movimento", fica parado.
 */
function LiveOrders() {
  const [head, setHead] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const tops = useRef(new Map<string, number>());
  useEffect(() => {
    if (calmMotion()) return;
    const t = window.setInterval(() => {
      if (!document.hidden) setHead((h) => h + 1);
    }, 3400);
    return () => window.clearInterval(t);
  }, []);
  useLayoutEffect(() => {
    const ul = list.current;
    if (!ul) return;
    for (const li of Array.from(ul.children) as HTMLElement[]) {
      const k = li.dataset.k ?? '';
      const prev = tops.current.get(k);
      const top = li.offsetTop;
      if (prev !== undefined && prev !== top)
        li.animate([{ transform: `translateY(${prev - top}px)` }, { transform: 'none' }], {
          duration: 320,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        });
      tops.current.set(k, top);
    }
  }, [head]);
  const n = HERO_ORDERS.length;
  const rows = HERO_STATUS.map((st, i) => {
    const at = head - i;
    return { o: HERO_ORDERS[((at % n) + n) % n]!, key: String(at), st };
  });
  // Vendas do dia: um valor de partida e cada pedido que chega soma.
  let sold = 2184.6;
  let count = 48;
  for (let i = 1; i <= head; i++) {
    sold += HERO_ORDERS[i % n]!.total;
    count += 1;
  }
  return (
    <div className="st-live" aria-hidden>
      <div className="st-live__card">
        <div className="st-live__bar">
          <strong>Pedidos agora</strong>
          <span>
            <i /> Ao vivo
          </span>
        </div>
        <ul ref={list}>
          {rows.map(({ o, key, st }, i) => (
            <li
              key={key}
              data-k={key}
              className={i === 0 && head > 0 ? 'is-new' : undefined}
              style={{ '--hue': `var(--cm-tint-${o.hue})` } as CSSProperties}
            >
              <span className="st-live__ch">{o.ch}</span>
              <span className="st-live__st" data-tone={st[1]}>
                {st[0]}
              </span>
              <span className="st-live__items">
                #{o.n} · {o.items}
              </span>
              <strong className="st-live__val">{brl(o.total.toFixed(2))}</strong>
            </li>
          ))}
        </ul>
      </div>
      <div className="st-live__card st-live__day">
        <span>Vendas de hoje</span>
        <strong>
          <RollingValue text={brl(sold.toFixed(2))} />
        </strong>
        <small>{count} pedidos no mesmo caixa</small>
      </div>
    </div>
  );
}

/**
 * Cabeçalho de seção: título com o Shuffle (as letras correm na fita ao chegar e ao passar o
 * mouse) e uma frase curta. Sem número nem rótulo em cima (a skill impeccable proíbe o "eyebrow").
 */
function SectionHead({ title, text, center }: { title: string; text?: string; center?: boolean }) {
  return (
    <div className={`st-head st-reveal ${center ? 'st-head--center' : ''}`}>
      <h2>
        <Shuffle text={title} />
      </h2>
      {text && <p>{text}</p>}
    </div>
  );
}

/**
 * O palco do topo em 3D: o celular da loja (mostra o que a pessoa digita) em perspectiva, com os
 * pedidos e as vendas flutuando em camadas mais perto de quem olha. O conjunto gira de leve
 * seguindo o mouse (`useTilt`) e se endireita um pouco ao rolar (`--p` do topo).
 */
function Stage({ look, mood }: { look: Look; mood: PandaMood }) {
  const tilt = useTilt<HTMLDivElement>();
  return (
    <div className="st-stage" ref={tilt}>
      <div className="st-stage__world">
        <span className="st-stage__floor" aria-hidden />
        <div className="st-stage__phone">
          <div className="st-stage__peek">
            <LivePanda size={84} mood={mood} title="Panda do Comandou" />
          </div>
          <PhoneMock look={look} />
        </div>
        <LiveOrders />
        <div className="st-stage__chip st-stage__chip--pix" aria-hidden>
          <span className="st-stage__ok">
            <Check size={14} strokeWidth={2.6} />
          </span>
          <span>
            <strong>Pix aprovado</strong>
            <small>Mesa 4 · R$ 128,40</small>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Tamanho em que o exemplo é desenhado dentro da moldura (depois encolhe para caber). */
const TOUR_W = 1280;
const TOUR_H = 800;

/** Celular: o exemplo abre em tela cheia por cima do site (na moldura ficaria pequeno demais). */
function useNarrow(query = '(max-width: 760px)') {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

/** O exemplo do sistema (`/experimente`) num iframe, conversando com as abas de fora. */
function useSandboxFrame(tab: string, setTab: (k: string) => void) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const want = useRef(tab);
  want.current = tab;
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const d = e.data as { source?: string; ready?: boolean; at?: string } | null;
      if (d?.source !== SANDBOX_MSG) return;
      if (d.ready) setReady(true);
      if (typeof d.at === 'string') {
        const key = sandboxScreenOf(d.at);
        if (key && TOUR.some((x) => x.key === key)) setTab(key);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [setTab]);
  const go = (key: string) =>
    frame.current?.contentWindow?.postMessage(
      { source: SITE_MSG, go: key },
      window.location.origin,
    );
  // Abriu numa aba e a pessoa já trocou antes do exemplo terminar de carregar.
  useEffect(() => {
    if (ready) go(want.current);
  }, [ready]);
  return { frame, ready, go, reset: () => setReady(false) };
}

/**
 * O sistema de verdade, para clicar: as abas trocam a tela do exemplo (`/experimente`, com os dados
 * da Fumaça Burger respondidos dentro do navegador, nada vai para o servidor). No computador ele
 * roda dentro da moldura, desenhado em 1280 × 800 e encolhido para caber; o primeiro clique libera
 * o mouse lá dentro (antes disso a rolagem da página passa por cima). No celular, a foto da tela e
 * um botão que abre o exemplo em tela cheia. A moldura chega deitada em 3D e se endireita conforme
 * a seção sobe (`--p`).
 */
function Tour() {
  const [tab, setTab] = useState(TOUR[0]!.key);
  const [near, setNear] = useState(false);
  const [live, setLive] = useState(false);
  const [full, setFull] = useState(false);
  const [scale, setScale] = useState(0);
  const narrow = useNarrow();
  const root = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const rise = useScrollProgress<HTMLDivElement>('enter', 0.3);
  const t = TOUR.find((x) => x.key === tab)!;
  const sandbox = useSandboxFrame(tab, setTab);
  // A tela em que o exemplo abre; depois as abas trocam lá dentro, sem recarregar.
  const start = useRef<string | null>(null);
  const embedded = near && !narrow;

  // Só baixa o exemplo quando a seção chega perto; saiu da tela, devolve a rolagem para a página.
  useEffect(() => {
    const el = root.current;
    if (!el || !('IntersectionObserver' in window)) {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) setNear(true);
        else setLive(false);
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = view.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / TOUR_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const d = sheet.current;
    if (!d) return;
    if (full && !d.open) d.showModal();
    if (!full && d.open) d.close();
  }, [full]);

  const pick = (key: string) => {
    setTab(key);
    if (sandbox.ready) sandbox.go(key);
  };
  const src = `/experimente?tela=${tab}`;

  return (
    <div className="st-tour" ref={root}>
      <div className="st-tour__tabs" role="tablist" aria-label="Telas do sistema">
        {TOUR.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={x.key === tab}
            className={x.key === tab ? 'is-on' : ''}
            onClick={() => pick(x.key)}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="st-tour__scene" ref={rise}>
        <div className="st-tour__frame">
          <div className="st-tour__bar">
            <i aria-hidden />
            <i aria-hidden />
            <i aria-hidden />
            <span>fumaca.comandou.com</span>
            <em className="st-tour__note">Exemplo: clique à vontade, nada fica salvo</em>
          </div>
          <div className="st-tour__view" ref={view} data-ready={sandbox.ready || undefined}>
            <img
              src={`/site/${tab}-light.webp`}
              width={1600}
              height={1000}
              alt={`Tela ${t.label} do Comandou: ${t.text}`}
              loading="lazy"
              decoding="async"
            />
            {embedded && scale > 0 && (
              <iframe
                ref={sandbox.frame}
                src={`/experimente?tela=${(start.current ??= tab)}`}
                title="Sistema Comandou de exemplo"
                width={TOUR_W}
                height={TOUR_H}
                style={{ transform: `scale(${scale})` }}
                tabIndex={live ? 0 : -1}
              />
            )}
            {(!embedded || !live) && (
              <button
                type="button"
                className="st-tour__start"
                onClick={() => (narrow ? setFull(true) : setLive(true))}
                aria-label={`Mexer no sistema de exemplo: ${t.label}`}
              >
                <span className="cm-btn cm-btn--primary st-press">
                  <MousePointerClick size={16} aria-hidden />
                  {narrow ? 'Abrir e mexer no sistema' : 'Clique para mexer'}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="st-tour__caption" key={`${tab}-cap`}>
        <strong>{t.title}</strong>
        <span>
          {t.text}{' '}
          {!narrow && (
            <a href={src} target="_blank" rel="noreferrer" className="st-tour__open">
              Abrir em tela cheia
            </a>
          )}
        </span>
      </div>
      {narrow && (
        <dialog
          ref={sheet}
          className="st-tour__sheet"
          aria-label="Sistema Comandou de exemplo"
          onClose={() => {
            setFull(false);
            sandbox.reset();
          }}
        >
          <div className="st-tour__sheet-bar">
            <span>Exemplo: nada fica salvo</span>
            <button
              type="button"
              className="cm-btn cm-btn--secondary"
              onClick={() => setFull(false)}
            >
              <X size={16} aria-hidden />
              Fechar
            </button>
          </div>
          {full && <iframe ref={sandbox.frame} src={src} title="Sistema Comandou de exemplo" />}
        </dialog>
      )}
    </div>
  );
}

/** Ícone de cada módulo (mesma chave de MODULES). */
const MODULE_ICONS: Record<string, LucideIcon> = {
  pdv: Monitor,
  salao: Armchair,
  mesa: QrCode,
  cozinha: ChefHat,
  caixa: Wallet,
  loja: ShoppingBag,
  entregas: Bike,
  apps: Layers,
  estoque: Package,
  financeiro: PiggyBank,
  fiscal: Receipt,
  whatsapp: MessageCircle,
  reservas: CalendarDays,
  equipe: Users,
  impressao: Printer,
  relatorios: ChartColumn,
};

/**
 * Tudo o que vem junto: uma grade de linhas finas, ícone solto, nome e uma linha. Uma luz bem
 * fraca segue o mouse pela grade e acende as linhas por onde passa (no jeito do "MagicBento" do
 * React Bits, só com CSS e duas variáveis).
 */
function Modules() {
  const ref = useRef<HTMLUListElement>(null);
  const move = (e: PointerEvent<HTMLUListElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  return (
    <ul className="st-mods st-reveal" ref={ref} onPointerMove={move}>
      {MODULES.map((m, i) => {
        const Icon = MODULE_ICONS[m.key] ?? Check;
        return (
          <li key={m.key} style={{ '--k': i } as CSSProperties}>
            <Icon size={22} strokeWidth={1.6} aria-hidden />
            <h3>{m.title}</h3>
            <p>{m.text}</p>
          </li>
        );
      })}
    </ul>
  );
}

/** Ícone de cada item de APP_FEATURES (mesma ordem). */
const APP_FEATURE_ICONS = [Layers, CheckCheck, Bike, Store, Wallet];

/**
 * Aplicativos de delivery: a fila de pedidos como aparece no Comandou (as linhas entram uma a uma
 * quando a seção chega) e, ao lado, o que dá para fazer sem abrir o portal de cada aplicativo.
 */
function Apps() {
  const hue = (app: string) =>
    ({ '--hue': `var(--cm-tint-${APP_HUE[app] ?? 'slate'})` }) as CSSProperties;
  return (
    <div className="st-apps">
      <div className="st-apps__feed st-reveal" aria-hidden>
        <div className="st-apps__bar">
          <strong>Pedidos</strong>
          <span className="st-apps__tabs">
            <b>
              Todos <em>{APP_ORDERS.length}</em>
            </b>
            <span>Salão</span>
            <span>Aplicativos</span>
          </span>
          <span className="st-live-dot">
            <i /> Ao vivo
          </span>
        </div>
        <ul>
          {APP_ORDERS.map((o, k) => (
            <li key={o.n} style={{ ...hue(o.app), '--k': k } as CSSProperties}>
              <span className="st-apps__app">{o.app}</span>
              <span className="st-apps__who">
                <strong>
                  #{o.n} <span>· {o.who}</span>
                </strong>
                <small>{o.items}</small>
              </span>
              <span className="st-apps__val">
                <strong>R$ {o.total}</strong>
                <small>{o.time}</small>
              </span>
              {o.tone === 'new' ? (
                <span className="st-apps__act">Aceitar</span>
              ) : (
                <span className="st-apps__st" data-tone={o.tone}>
                  {o.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <ul className="st-apps__list st-reveal">
        {APP_FEATURES.map((f, i) => {
          const Icon = APP_FEATURE_ICONS[i] ?? Check;
          return (
            <li key={f.title} style={{ '--k': i } as CSSProperties}>
              <Icon size={20} strokeWidth={1.7} aria-hidden />
              <div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Links do menu (e do rodapé). */
const NAV: [string, string][] = [
  ['#sistema', 'O sistema'],
  ['#preco', 'Preço'],
  ['#perguntas', 'Perguntas'],
];

function NavLink({ href, label, onPick }: { href: string; label: string; onPick?: () => void }) {
  return href.startsWith('/') ? (
    <SiteLink to={href} onClick={onPick}>
      {label}
    </SiteLink>
  ) : (
    <a href={href} onClick={onPick}>
      {label}
    </a>
  );
}

function Landing() {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [plan, setPlan] = useState<PublicPlan | null>(null);
  const [look, setLook] = useState<Look>(FIRST_LOOK);
  const [mood, setMood] = useState<PandaMood>('idle');
  const [enter, setEnter] = useState(false);
  const [menu, setMenu] = useState(false);
  // Menu solto: depois de rolar um pouco, fica mais compacto e com sombra.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const calm = useRef<number | undefined>(undefined);
  useReveal();
  useSmoothScroll();
  const bar = useReadingBar<HTMLElement>();
  const hero = useScrollProgress<HTMLElement>('leave');

  useEffect(() => {
    document.title = 'Comandou · Seu restaurante no ar em minutos';
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        'Cardápio online, PDV, salão, cozinha, caixa, delivery, iFood e nota fiscal no mesmo lugar. Crie o seu restaurante em minutos e teste grátis.',
      );
    void loadSiteConfig().then(setConfig);
    fetch('/api/v1/public/plans', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { plans: PublicPlan[] } | null) => {
        const list = d?.plans ?? [];
        setPlan(list.find((p) => p.featured) ?? list[0] ?? null);
      })
      .catch(() => undefined);
  }, []);

  // O panda reage (achou o site, a IA montou, criou o restaurante) e volta ao normal sozinho.
  const react = (m: PandaMood) => {
    window.clearTimeout(calm.current);
    setMood(m);
    if (m !== 'idle' && m !== 'thinking')
      calm.current = window.setTimeout(() => setMood('idle'), 2600);
  };

  // Os dias de teste vêm do plano (Super Admin › Planos): o mesmo tempo do sistema todo.
  const days = config?.trialDays ?? 0;
  const free = days > 0 ? `${days} ${days === 1 ? 'dia' : 'dias'} grátis` : 'Teste grátis';
  const contact = contactHref(config?.salesContact ?? '');
  const toBuilder = () => {
    setMenu(false);
    scrollToEl(document.getElementById('criar'), true);
    window.setTimeout(
      () => document.querySelector<HTMLElement>('#criar .st-input')?.focus({ preventScroll: true }),
      calmMotion() ? 0 : 700,
    );
  };
  const included = [
    ...INCLUDED_IN_ALL,
    ...(plan?.featureFiscal ? ['Nota fiscal (NFC-e)'] : []),
    ...(plan?.featureWhatsapp ? ['WhatsApp com avisos e atendente'] : []),
    ...(plan?.featureCustomDomain ? ['Domínio próprio'] : []),
  ];

  return (
    <div className="st">
      <i className="st-progress" ref={bar} aria-hidden />
      <header className={`st-nav ${scrolled ? 'is-scrolled' : ''} ${menu ? 'is-open' : ''}`}>
        <div className="st-nav__in">
          <a className="st-brand" href="#topo" aria-label="Comandou, início">
            <Mascot size={28} badge />
            <span>Comandou</span>
          </a>
          <nav className="st-nav__links" aria-label="Seções">
            {NAV.map(([href, label]) => (
              <NavLink key={href} href={href} label={label} />
            ))}
          </nav>
          <div className="st-nav__end">
            <Button variant="ghost" className="st-nav__enter" onClick={() => setEnter(true)}>
              Entrar
            </Button>
            <CtaButton className="st-nav__cta" onClick={toBuilder}>
              Testar grátis
            </CtaButton>
            <button
              type="button"
              className="st-icon st-nav__menu"
              aria-label={menu ? 'Fechar o menu' : 'Abrir o menu'}
              aria-expanded={menu}
              aria-controls="st-menu"
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
            </button>
          </div>
        </div>
        <nav id="st-menu" className="st-nav__sheet" aria-label="Menu" hidden={!menu}>
          {NAV.map(([href, label]) => (
            <NavLink key={href} href={href} label={label} onPick={() => setMenu(false)} />
          ))}
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              setEnter(true);
            }}
          >
            Entrar
          </button>
          <Button size="lg" block className="st-press" onClick={toBuilder}>
            Criar meu restaurante
          </Button>
        </nav>
      </header>

      <main id="topo">
        <section className="st-hero" ref={hero}>
          <div className="st-hero__text">
            <h1 className="st-h1">
              <span className="cm-sr-only">Seu restaurante no ar em minutos.</span>
              <span className="st-h1__vis" aria-hidden>
                <span className="st-h1__row st-h1__swap">
                  <ShuffleWords words={HERO_WORDS} sr={false} />
                </span>
                <span className="st-h1__row">
                  <Shuffle text="no ar" trigger="mount" delay={260} hover={false} sr={false} />{' '}
                  <span className="st-h1__soft">
                    <Shuffle text="em minutos." trigger="mount" delay={380} sr={false} />
                  </span>
                </span>
              </span>
            </h1>
            <p className="st-lead">
              Cardápio online, PDV, salão, cozinha, caixa e os pedidos do iFood num sistema só.{' '}
              {config?.ai ? (
                <span className="st-lead__ai">
                  <Sparkles size={16} aria-hidden /> Cole o seu link e a IA monta a loja.
                </span>
              ) : (
                'Cole o seu link e o Comandou monta o resto.'
              )}
            </p>
            <Builder config={config} onLook={setLook} onMood={react} />
            <ul className="st-hero__facts">
              <li>
                <Check size={15} aria-hidden /> {free}, sem cartão
              </li>
              <li>
                <Check size={15} aria-hidden /> Sem limite de pedidos
              </li>
              <li>
                <Check size={15} aria-hidden /> Funciona sem internet
              </li>
            </ul>
          </div>
          <div className="st-hero__art">
            <Stage look={look} mood={mood} />
          </div>
        </section>

        <section
          className="st-works st-reveal"
          aria-label="Aplicativos que funcionam com o Comandou"
        >
          <p>Recebe os pedidos de</p>
          <ul>
            {DELIVERY_APPS.map((a) => (
              <li key={a}>
                <Shuffle text={a} mode="sequence" stagger={24} />
              </li>
            ))}
          </ul>
        </section>

        <section className="st-sec" id="sistema">
          <SectionHead
            center
            title="Tudo numa tela só."
            text="Balcão, salão, cozinha, caixa e entrega conversando entre si, sem planilha no meio."
          />
          <Tour />
        </section>

        <section className="st-sec" id="modulos">
          <SectionHead
            title="Tudo o que o restaurante usa."
            text="Um preço, um login, um cardápio. Mudou aqui, muda no PDV, no garçom, na loja e no iFood."
          />
          <Modules />
        </section>

        <section className="st-sec" id="aplicativos">
          <SectionHead
            title="Os pedidos dos aplicativos caem aqui."
            text="Ligue a loja do iFood, 99Food, Keeta, Rappi ou aiqfome e pare de pular entre tablets."
          />
          <Apps />
        </section>

        <section className="st-sec" id="como">
          <SectionHead center title="No ar em três passos." />
          <ol className="st-steps st-reveal">
            {STEPS.map((s, i) => (
              <li key={s.title} style={{ '--k': i } as CSSProperties}>
                <span className="st-steps__n">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="st-sec" id="preco">
          <div className="st-price st-reveal">
            <div className="st-price__main">
              <h2>
                <Shuffle text="Um preço só. Tudo dentro." />
              </h2>
              <div className="st-price__value">
                {plan ? (
                  <>
                    <strong>
                      <RollIn text={brl(plan.priceMonthly).replace(/,00$/, '')} />
                    </strong>
                    <span>por mês</span>
                  </>
                ) : (
                  <strong className="st-price__ask">Fale com a gente</strong>
                )}
              </div>
              <p>
                {free}, sem cartão. O valor não muda com o número de pessoas, produtos ou pedidos.
              </p>
              <div className="st-price__cta">
                <CtaButton size="lg" arrow onClick={toBuilder}>
                  {days > 0 ? `Testar ${free}` : 'Testar grátis'}
                </CtaButton>
                {contact && (
                  <a
                    className="cm-btn cm-btn--secondary cm-btn--lg"
                    href={contact}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Falar com a gente
                  </a>
                )}
              </div>
            </div>
            <ul className="st-price__list">
              {included.map((x, i) => (
                <li key={x} style={{ '--i': i } as CSSProperties}>
                  <Check size={16} aria-hidden />
                  {x}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="st-sec" id="perguntas">
          <div className="st-faq-wrap">
            <SectionHead title="Perguntas." text="O que mais perguntam antes de testar." />
            <div className="st-faq st-reveal">
              {SITE_FAQ.map((f) => (
                <details key={f.q}>
                  <summary>
                    {f.q}
                    <i className="st-faq__x" aria-hidden />
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="st-end">
          <div className="st-end__in st-reveal">
            <div className="st-end__panda" aria-hidden>
              <LivePanda size={96} mood="happy" />
            </div>
            <h2>
              <Shuffle text="Vamos colocar o seu no ar?" />
            </h2>
            <p>{free}, sem cartão. Hoje mesmo o primeiro pedido chega na cozinha.</p>
            <div className="st-end__cta">
              <CtaButton size="lg" arrow onClick={toBuilder}>
                Criar meu restaurante
              </CtaButton>
              <a href="#sistema" className="cm-btn cm-btn--secondary cm-btn--lg">
                Mexer no sistema
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="st-foot">
        <div className="st-foot__in">
          <div className="st-foot__about">
            <a className="st-brand" href="#topo" aria-label="Comandou, voltar ao início">
              <Mascot size={26} badge />
              <span>Comandou</span>
            </a>
            <p>
              Sistema para restaurante: cardápio online, PDV, salão, cozinha, caixa, entrega e os
              pedidos dos aplicativos no mesmo lugar.
            </p>
          </div>
          <nav className="st-foot__col" aria-label="Produto">
            <h3>Produto</h3>
            <a href="#sistema">O sistema</a>
            <a href="#aplicativos">Aplicativos</a>
            <a href="#sistema">Sistema de exemplo</a>
          </nav>
          <nav className="st-foot__col" aria-label="Ajuda">
            <h3>Ajuda</h3>
            <a href="#perguntas">Perguntas</a>
            <a href="/precos">Planos</a>
            {contact && (
              <a href={contact} target="_blank" rel="noreferrer">
                Falar com a gente
              </a>
            )}
            {config?.demoUrl && <a href={config.demoUrl}>Cardápio da Fumaça no ar</a>}
            <button type="button" onClick={() => setEnter(true)}>
              Entrar no meu restaurante
            </button>
          </nav>
        </div>
        <div className="st-foot__base">
          <small>© {new Date().getFullYear()} Comandou</small>
          <small>Feito no Brasil, para quem vive de balcão.</small>
        </div>
      </footer>

      <EnterModal open={enter} onClose={() => setEnter(false)} />
    </div>
  );
}
