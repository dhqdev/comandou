import {
  ArrowRight,
  Check,
  ChefHat,
  Cloud,
  FileText,
  Globe,
  Link2,
  Menu,
  QrCode,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  applyTheme,
  Button,
  LivePanda,
  Mascot,
  Modal,
  type ButtonProps,
  type PandaMood,
} from '../design-system';
import { brl } from '../lib/money';
import { contactHref, INCLUDED_IN_ALL, type PublicPlan } from '../pages/pricing-data';
import { Builder, PhoneMock, type Look } from './Builder';
import { loadSiteConfig, type SiteConfig } from './host';
import {
  APP_FEATURES,
  APP_ORDERS,
  DELIVERY_APPS,
  FEATURES,
  SAMPLE_ITEMS,
  SITE_FAQ,
  STEPS,
  TOUR,
} from './site-data';
import {
  calmMotion,
  scrollToEl,
  useReadingBar,
  useScrollProgress,
  useSmoothScroll,
  useStack,
  useVelocityMarquee,
} from './motion';
import ClickSpark from './reactbits/ClickSpark';
import GlareHover from './reactbits/GlareHover';
import Magnet from './reactbits/Magnet';
import SpotlightCard from './reactbits/SpotlightCard';
import StarBorder from './reactbits/StarBorder';
import './site.css';
import './scroll.css';
import './hero.css';

// O site é sempre claro (pedido do dono): não segue o tema do aparelho nem guarda escolha.
// Roda ao carregar este arquivo, antes do primeiro desenho, para não piscar escuro.
applyTheme('light');

/** Laranja da marca e um âmbar: as faíscas do clique (React Bits › ClickSpark). */
const SPARKS = ['#E23A00', '#F59E0B', '#FF7A45'];

/**
 * Botão principal do site: segue o ponteiro de leve (React Bits › Magnet) e afunda ao clicar
 * (efeito de botão físico no estilo dos elementos do Uiverse, em CSS: `.st-press`). Com `arrow`,
 * a seta corre para a frente no hover (também no estilo do Uiverse).
 */
function CtaButton({
  className = '',
  arrow,
  children,
  ...props
}: ButtonProps & { arrow?: boolean }) {
  return (
    <Magnet padding={60} magnetStrength={4} maxOffset={10} wrapperClassName="st-magnet">
      <Button {...props} className={`st-press ${arrow ? 'st-arrow' : ''} ${className}`}>
        {children}
        {arrow && (
          <span className="st-arrow__i" aria-hidden>
            <ArrowRight size={16} />
            <ArrowRight size={16} />
          </span>
        )}
      </Button>
    </Magnet>
  );
}

/**
 * Site público do Comandou (comandou.com): pouco texto e muito movimento. O topo cria o
 * restaurante (com IA quando o Super Admin liga), as telas do sistema passam sozinhas e cada
 * detalhe tem a sua animação curta. Tudo com os tokens do sistema e sem gradiente; com
 * "reduzir movimento" ligado, a página fica parada.
 */
const FIRST_LOOK: Look = {
  name: 'Seu restaurante',
  color: null,
  icon: null,
  cover: null,
  items: SAMPLE_ITEMS,
  typed: false,
};

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

const TOUR_MS = 5200;

/**
 * As telas de verdade passam sozinhas (a barrinha da aba mostra quanto falta). Para quando a
 * pessoa clica numa aba, passa o mouse em cima ou a seção sai da tela.
 */
function Tour({ dark }: { dark: boolean }) {
  const [tab, setTab] = useState(TOUR[0]!.key);
  const [auto, setAuto] = useState(true);
  const [hold, setHold] = useState(false);
  const [seen, setSeen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const rise = useScrollProgress<HTMLDivElement>('enter', 0.25);
  const t = TOUR.find((x) => x.key === tab)!;
  const running = auto && !hold && seen && !calmMotion();

  useEffect(() => {
    const el = root.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setSeen(!!e?.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(() => {
      const i = TOUR.findIndex((x) => x.key === tab);
      setTab(TOUR[(i + 1) % TOUR.length]!.key);
    }, TOUR_MS);
    return () => window.clearTimeout(id);
  }, [running, tab]);

  // Pré-carrega a próxima tela para a troca não piscar.
  useEffect(() => {
    const i = TOUR.findIndex((x) => x.key === tab);
    const next = TOUR[(i + 1) % TOUR.length]!;
    const img = new Image();
    img.src = `/site/${next.key}-${dark ? 'dark' : 'light'}.webp`;
  }, [tab, dark]);

  return (
    <div
      className="st-tour"
      ref={root}
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
    >
      <div className="st-tour__tabs" role="tablist" aria-label="Telas do sistema">
        {TOUR.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={x.key === tab}
            className={x.key === tab ? 'is-on' : ''}
            onClick={() => {
              setAuto(false);
              setTab(x.key);
            }}
          >
            {x.label}
            {x.key === tab && running && (
              <i
                className="st-tour__time"
                key={tab}
                style={{ animationDuration: `${TOUR_MS}ms` }}
              />
            )}
          </button>
        ))}
      </div>
      <h3 className="st-tour__head" key={`${tab}-head`}>
        {t.title}
      </h3>
      <div className="st-rise" ref={rise}>
        <div className="st-shot">
          <div className="st-shot__bar" aria-hidden>
            <i />
            <i />
            <i />
            <span>fumaca.comandou.com</span>
          </div>
          <GlareHover
            className="st-shot__view"
            width="100%"
            background="transparent"
            borderRadius="0"
            glareColor="#ffffff"
            glareOpacity={0.45}
            glareSize={40}
            variant="twin"
            blendMode="soft-light"
          >
            <img
              key={`${tab}-${dark}`}
              src={`/site/${tab}-${dark ? 'dark' : 'light'}.webp`}
              width={1600}
              height={1000}
              alt={`Tela ${t.label} do Comandou: ${t.text}`}
              loading="lazy"
              decoding="async"
            />
          </GlareHover>
        </div>
      </div>
    </div>
  );
}

/** Faixa do que vem junto: passa sozinha e acelera com a rolagem (duas cópias para emendar). */
function Marquee() {
  const track = useVelocityMarquee<HTMLDivElement>(36);
  return (
    <section className="st-band" aria-label="O que vem junto">
      <div className="st-band__track" ref={track}>
        {[0, 1].map((copy) => (
          <ul key={copy} aria-hidden={copy === 1 || undefined}>
            {FEATURES.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ))}
      </div>
    </section>
  );
}

/** Um cartão de detalhe: a animação em cima (palco do mesmo tamanho em todos) e o texto embaixo. */
function Card({
  title,
  text,
  wide,
  children,
}: {
  title: string;
  text: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <SpotlightCard
      theme="light"
      spotlightColor="rgba(226, 58, 0, 0.55)"
      intensity={0.12}
      spotlightSize={320}
      borderGlow={0.8}
      className={`st-card st-reveal ${wide ? 'st-card--wide' : ''}`}
    >
      <div className="st-card__stage" aria-hidden>
        {children}
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </SpotlightCard>
  );
}

/** Os detalhes: cada cartão com um título, uma linha e a sua animação. */
function Details() {
  return (
    <div className="st-bento">
      <Card
        wide
        title="Cardápio pelo PDF ou foto"
        text="A IA lê itens, preços e fotos. Você só confere."
      >
        <div className="st-mini st-mini--import">
          <div className="st-mini__file">
            <FileText size={18} />
            <span>cardapio.pdf</span>
            <i className="st-mini__scan" />
          </div>
          <div className="st-mini__rows">
            {['X-Burger', 'X-Salada', 'Batata frita'].map((n, i) => (
              <div key={n} style={{ animationDelay: `${i * 0.45}s` }}>
                <Check size={13} />
                <span>{n}</span>
                <em>{['28,90', '32,00', '18,00'][i]}</em>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card title="Prato em 3D" text="Gira na tela e aparece na mesa.">
        <div className="st-mini st-mini--spin">
          <img src="/site/food-burger-fumaca.webp" alt="" width={112} height={112} loading="lazy" />
          <i />
        </div>
      </Card>

      <Card title="Vende sem internet" text="Tudo sobe sozinho quando a conexão volta.">
        <div className="st-mini st-mini--sync">
          <span className="st-mini__wifi">
            <WifiOff size={20} />
          </span>
          <span className="st-mini__queue">
            <i />
            <i />
            <i />
          </span>
          <span className="st-mini__cloud">
            <Cloud size={22} />
          </span>
        </div>
      </Card>

      <Card
        wide
        title="WhatsApp que responde sozinho"
        text="Conhece o seu cardápio e o seu horário."
      >
        <div className="st-mini st-mini--chat">
          <span>Vocês abrem hoje?</span>
          <span className="is-me">Abrimos às 18h. Quer ver o cardápio?</span>
          <span>Quero um Smash duplo</span>
          <span className="is-me">Anotado! Entrega ou retirada?</span>
        </div>
      </Card>

      <Card title="Endereço e marca seus" text="Suas cores, seu logo, seu domínio.">
        <div className="st-mini st-mini--url">
          <Globe size={15} />
          <span>
            <b>seunome</b>.comandou.com
          </span>
        </div>
      </Card>

      <Card title="NFC-e e Pix no caixa" text="Nota no fechamento, QR Code na tela.">
        <div className="st-mini st-mini--receipt">
          <div>
            <QrCode size={34} />
            <i />
            <i />
            <b>
              <Check size={12} /> Pix aprovado
            </b>
          </div>
        </div>
      </Card>

      <Card title="Instala como app" text="Celular, tablet e computador.">
        <div className="st-mini st-mini--app">
          <span className="st-mini__home">
            <i />
            <i />
            <i />
            <b>
              <Mascot size={24} />
            </b>
            <i />
            <i />
          </span>
        </div>
      </Card>
    </div>
  );
}

/** Título que entra palavra por palavra (só transform e opacity). */
function Words({ text, from, accent }: { text: string; from: number; accent?: boolean }) {
  return (
    <span className={accent ? 'st-h1__accent' : undefined}>
      {text.split(' ').map((w, i, all) => (
        <span key={w + i} className="st-w" style={{ '--i': from + i } as React.CSSProperties}>
          {w}
          {i < all.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}

/** Avisos que surgem em volta do celular, como o sistema avisa no dia a dia. */
function HeroToasts() {
  return (
    <div className="st-toasts" aria-hidden>
      <div className="st-toast st-toast--a">
        <b className="st-toast__dot" />
        <span>
          <strong>Novo pedido do iFood</strong>
          <small>#7421 · R$ 71,80</small>
        </span>
      </div>
      <div className="st-toast st-toast--b">
        <Check size={14} />
        <span>
          <strong>Pix aprovado</strong>
          <small>Mesa 4 · R$ 128,40</small>
        </span>
      </div>
      <div className="st-toast st-toast--c">
        <ChefHat size={14} />
        <span>
          <strong>Cozinha</strong>
          <small>Pedido #128 pronto</small>
        </span>
      </div>
    </div>
  );
}

/**
 * Cabeçalho de seção: o título sobe palavra por palavra de trás de uma máscara quando a seção
 * chega na tela, e uma frase curta embaixo diz o que a seção prova. Sem número nem rótulo em
 * cima do título (a skill impeccable proíbe o "eyebrow"; o título fala sozinho).
 */
function SectionHead({ title, text }: { title: string; text?: string }) {
  return (
    <div className="st-sec__head st-reveal">
      <h2 className="st-split" aria-label={title}>
        {title.split(' ').map((w, i) => (
          <Fragment key={w + i}>
            {i > 0 && ' '}
            <span className="st-split__w" aria-hidden>
              <span style={{ '--i': i } as React.CSSProperties}>{w}</span>
            </span>
          </Fragment>
        ))}
      </h2>
      {text && <p>{text}</p>}
    </div>
  );
}

const MANIFESTO =
  'Você cuida da comida. O Comandou cuida do pedido, da mesa, da cozinha, do caixa e da entrega. Tudo no mesmo lugar.';

/**
 * Frase grande que acende palavra por palavra conforme a pessoa rola (ideia do ScrollReveal do
 * React Bits, refeita sem gsap). A seção é alta e o texto fica preso no meio da tela enquanto isso.
 */
function Manifesto() {
  const ref = useScrollProgress<HTMLElement>('pin');
  const words = MANIFESTO.split(' ');
  const hot = words.length - 3;
  return (
    <section
      className="st-manifesto"
      ref={ref}
      style={{ '--n': words.length } as React.CSSProperties}
    >
      <div className="st-manifesto__in">
        <p>
          {words.map((w, i) => (
            <span
              key={w + i}
              className={i >= hot ? 'is-hot' : undefined}
              style={{ '--i': i } as React.CSSProperties}
            >
              {w}{' '}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}

/** O desenho de cada passo, dentro do cartão da pilha. */
function StepArt({ i }: { i: number }) {
  if (i === 0)
    return (
      <div className="st-art st-art--link">
        <div className="st-art__field">
          <Link2 size={16} />
          <span>
            <b>fumacaburger.com.br</b>
          </span>
        </div>
        <span className="st-art__go">
          Criar <ArrowRight size={14} />
        </span>
      </div>
    );
  if (i === 1)
    return (
      <div className="st-art st-art--site">
        <img src="/site/cardapio-light.webp" alt="" width={1600} height={1000} loading="lazy" />
      </div>
    );
  return (
    <div className="st-art st-art--sale">
      {[
        ['Novo pedido #129', 'Delivery · R$ 71,80'],
        ['Pix aprovado', 'Mesa 4 · R$ 128,40'],
        ['Pedido pronto', 'Retirada · R$ 32,00'],
      ].map(([a, b], k) => (
        <div key={a} style={{ '--k': k } as React.CSSProperties}>
          <Check size={14} />
          <span>
            <strong>{a}</strong>
            <small>{b}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Três passos em pilha: cada cartão fica preso no topo e o próximo chega por cima, deixando o
 * anterior um pouco menor (ideia do ScrollStack do React Bits).
 */
function Steps() {
  const ref = useStack<HTMLOListElement>();
  return (
    <ol className="st-stack" ref={ref}>
      {STEPS.map((s, i) => (
        <li key={s.title} className="st-stack__card" style={{ '--i': i } as React.CSSProperties}>
          <div className="st-stack__text">
            <span className="st-stack__n">{String(i + 1).padStart(2, '0')}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
          <div className="st-stack__art" aria-hidden>
            <StepArt i={i} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Links do menu (e do rodapé, os quatro primeiros). */
const NAV: [string, string][] = [
  ['#sistema', 'O sistema'],
  ['#aplicativos', 'Aplicativos'],
  ['#como', 'Como funciona'],
  ['#preco', 'Preço'],
  ['#perguntas', 'Perguntas'],
];

/**
 * Aplicativos de delivery: à esquerda a fila de pedidos como aparece no Comandou (cada linha
 * com o aplicativo de onde veio, entrando uma a uma quando a seção chega); à direita o que dá
 * para fazer sem abrir o portal de cada aplicativo.
 */
function Apps() {
  return (
    <div className="st-apps">
      <div className="st-apps__feed st-reveal" aria-hidden>
        <div className="st-apps__bar">
          <strong>Pedidos</strong>
          <span>
            <i /> Ao vivo
          </span>
        </div>
        <ul>
          {APP_ORDERS.map((o, k) => (
            <li key={o.n} style={{ '--k': k } as React.CSSProperties}>
              <span className="st-apps__app">{o.app}</span>
              <span className="st-apps__who">
                <strong>#{o.n}</strong>
                <small>{o.items}</small>
              </span>
              <span className="st-apps__val">
                <strong>R$ {o.total}</strong>
                <small className={`st-apps__st st-apps__st--${o.tone}`}>{o.status}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="st-apps__side st-reveal">
        <ul className="st-apps__names" aria-label="Aplicativos que funcionam com o Comandou">
          {DELIVERY_APPS.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <dl className="st-apps__list">
          {APP_FEATURES.map((f) => (
            <div key={f.title}>
              <dt>{f.title}</dt>
              <dd>{f.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function SiteApp() {
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
        'Cardápio online, PDV, salão, cozinha, caixa, delivery e nota fiscal no mesmo lugar. Crie o seu restaurante em minutos e teste grátis.',
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

  // Os dias de teste vêm do plano (Super Admin › Preço): o mesmo tempo do sistema todo.
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

  return (
    <ClickSpark
      sparkColor={SPARKS}
      sparkSize={11}
      sparkRadius={26}
      sparkCount={9}
      duration={450}
      // A camada das faíscas cobre a página inteira (não só a primeira tela).
      style={{ height: 'auto', minHeight: '100%' }}
    >
      <div className="st">
        <i className="st-progress" ref={bar} aria-hidden />
        <header className={`st-nav ${scrolled ? 'is-scrolled' : ''} ${menu ? 'is-open' : ''}`}>
          <div className="st-nav__in">
            <a className="st-brand" href="#topo" aria-label="Comandou, início">
              <Mascot size={30} badge />
              <span>Comandou</span>
            </a>
            <nav className="st-nav__links" aria-label="Seções">
              {NAV.map(([href, label]) => (
                <a key={href} href={href}>
                  {label}
                </a>
              ))}
            </nav>
            <div className="st-nav__end">
              <Button variant="ghost" className="st-nav__enter" onClick={() => setEnter(true)}>
                Entrar
              </Button>
              <CtaButton className="st-nav__cta" onClick={toBuilder}>
                Criar meu restaurante
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
              <a key={href} href={href} onClick={() => setMenu(false)}>
                {label}
              </a>
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
                <span className="st-h1__row">
                  <Words text="Seu restaurante" from={0} />
                </span>{' '}
                <span className="st-h1__row">
                  <Words text="no ar" from={2} /> <Words text="em minutos." from={4} accent />
                </span>
              </h1>
              <p className="st-lead">
                {config?.ai ? (
                  <>
                    Cole o link ou descreva o cardápio.{' '}
                    <span className="st-lead__ai">
                      <Sparkles size={16} aria-hidden /> A IA monta o seu site.
                    </span>
                  </>
                ) : (
                  'Cole o link ou descreva o cardápio. O Comandou monta o resto.'
                )}
              </p>
              <Builder config={config} onLook={setLook} onMood={react} />
              <ul className="st-hero__facts">
                <li>
                  <Check size={15} aria-hidden /> {free}, sem cartão
                </li>
                <li>
                  <Check size={15} aria-hidden /> Recebe pedidos do iFood, 99Food, Keeta e Rappi
                </li>
              </ul>
            </div>
            <div className="st-hero__art">
              {/* O palco anda com a rolagem (deitado no topo, reto ao descer); o de dentro só entra. */}
              <div className="st-stage">
                <div className="st-stage__in">
                  <div className="st-desk" aria-hidden>
                    <div className="st-shot__bar">
                      <i />
                      <i />
                      <i />
                      <span>fumaca.comandou.com/cozinha</span>
                    </div>
                    <img
                      src="/site/cozinha-light.webp"
                      width={1600}
                      height={1000}
                      alt=""
                      fetchPriority="high"
                      decoding="async"
                    />
                  </div>
                  <div className="st-phonebox">
                    <div className="st-peek">
                      <LivePanda size={112} mood={mood} title="Panda do Comandou" />
                    </div>
                    <div className="st-float">
                      <PhoneMock look={look} />
                    </div>
                  </div>
                  <HeroToasts />
                </div>
              </div>
            </div>
          </section>

          <Marquee />

          <section className="st-sec" id="sistema">
            <SectionHead
              title="Tudo numa tela só."
              text="Balcão, salão, cozinha, caixa e entrega conversando entre si, sem planilha no meio."
            />
            <div className="st-reveal">
              <Tour dark={false} />
            </div>
          </section>

          <section className="st-sec st-sec--tint" id="aplicativos">
            <SectionHead
              title="Os pedidos dos aplicativos caem aqui."
              text="Ligue a sua loja do iFood, 99Food, Keeta, Rappi ou aiqfome e pare de pular entre tablets. O pedido entra na mesma fila da cozinha."
            />
            <Apps />
          </section>

          <Manifesto />

          <section className="st-sec">
            <SectionHead title="Feito para o balcão." />
            <Details />
          </section>

          <section className="st-sec st-sec--steps" id="como">
            <SectionHead title="Três passos." />
            <Steps />
          </section>

          <section className="st-sec st-sec--tint" id="preco">
            <div className="st-price st-reveal">
              <div className="st-price__left">
                <h2>Um preço só. Tudo dentro.</h2>
                <p>{free}, sem cartão e sem limite de pedidos.</p>
                <div className="st-price__value">
                  {plan ? (
                    <>
                      <strong>{brl(plan.priceMonthly).replace(/,00$/, '')}</strong>
                      <span>por mês</span>
                    </>
                  ) : (
                    <strong className="st-price__ask">Fale com a gente</strong>
                  )}
                </div>
                <p className="st-price__note">
                  Valor único: não muda com o número de pessoas, produtos ou pedidos.
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
              <StarBorder
                as="div"
                className="st-price__card"
                theme="light"
                color="#E23A00"
                trailColor="#F59E0B"
                radius={20}
                thickness={1}
                duration={6}
                trailLength={0.35}
                glow={0.7}
                hover="brighten"
                clickPulse={false}
                backgroundColor="var(--cm-surface)"
                borderColor="var(--cm-border)"
              >
                <ul className="st-price__list">
                  {[
                    ...INCLUDED_IN_ALL,
                    ...(plan?.featureFiscal ? ['Nota fiscal (NFC-e)'] : []),
                    ...(plan?.featureWhatsapp ? ['WhatsApp com avisos e atendente'] : []),
                    ...(plan?.featureCustomDomain ? ['Domínio próprio'] : []),
                  ].map((x, i) => (
                    <li key={x} style={{ '--i': i } as React.CSSProperties}>
                      <Check size={16} aria-hidden />
                      {x}
                    </li>
                  ))}
                </ul>
              </StarBorder>
            </div>
          </section>

          <section className="st-sec st-sec--narrow" id="perguntas">
            <SectionHead title="Ficou alguma dúvida?" />
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
          </section>

          <section className="st-end">
            <div className="st-end__in st-reveal">
              <div className="st-end__text">
                <h2>Vamos colocar o seu no ar?</h2>
                <p>
                  {free}, sem cartão. Em poucos minutos o cardápio está no ar e o primeiro pedido
                  chega na cozinha.
                </p>
                <div className="st-end__cta">
                  <CtaButton size="lg" arrow onClick={toBuilder}>
                    Criar meu restaurante
                  </CtaButton>
                  {config?.demoUrl && (
                    <a className="cm-btn cm-btn--secondary cm-btn--lg" href={config.demoUrl}>
                      Ver um cardápio de exemplo
                    </a>
                  )}
                </div>
              </div>
              <div className="st-end__panda" aria-hidden>
                <LivePanda size={150} mood="happy" />
              </div>
            </div>
          </section>
        </main>

        <footer className="st-foot">
          <div className="st-foot__in">
            <div className="st-foot__about">
              <a className="st-brand" href="#topo" aria-label="Comandou, voltar ao início">
                <Mascot size={28} badge />
                <span>Comandou</span>
              </a>
              <p>
                Sistema para restaurante: cardápio online, PDV, salão, cozinha, caixa, entrega e os
                pedidos dos aplicativos no mesmo lugar.
              </p>
            </div>
            <nav className="st-foot__col" aria-label="Produto">
              <h3>Produto</h3>
              {NAV.slice(0, 4).map(([href, label]) => (
                <a key={href} href={href}>
                  {label}
                </a>
              ))}
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
    </ClickSpark>
  );
}
