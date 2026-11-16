import { Check, FileText, Globe, MessageCircle, Moon, Sparkles, Sun, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  Button,
  LivePanda,
  Mascot,
  Modal,
  switchTheme,
  useTheme,
  type PandaMood,
} from '../design-system';
import { brl } from '../lib/money';
import { contactHref, INCLUDED_IN_ALL, type PublicPlan } from '../pages/pricing-data';
import { Builder, PhoneMock, type Look } from './Builder';
import { loadSiteConfig, type SiteConfig } from './host';
import { FEATURES, SAMPLE_ITEMS, SITE_FAQ, STEPS, TOUR } from './site-data';
import './site.css';

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

const calmMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
      <div className="st-shot">
        <div className="st-shot__bar" aria-hidden>
          <i />
          <i />
          <i />
          <span>fumaca.comandou.com</span>
        </div>
        <div className="st-shot__view">
          <img
            key={`${tab}-${dark}`}
            src={`/site/${tab}-${dark ? 'dark' : 'light'}.webp`}
            width={1600}
            height={1000}
            alt={`Tela ${t.label} do Comandou: ${t.text}`}
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
    </div>
  );
}

/** Faixa do que vem junto, passando sem parar (duas cópias para emendar). */
function Marquee() {
  return (
    <section className="st-band" aria-label="O que vem junto">
      <div className="st-band__track">
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

/** Os detalhes: cada cartão com um título, uma linha e a sua animação. */
function Details() {
  return (
    <div className="st-bento">
      <article className="st-card st-card--wide st-reveal">
        <div className="st-card__text">
          <FileText size={20} aria-hidden />
          <h3>Cardápio pelo PDF ou foto</h3>
          <p>A IA lê itens, preços e fotos.</p>
        </div>
        <div className="st-mini st-mini--import" aria-hidden>
          <div className="st-mini__file">
            <FileText size={16} /> cardapio.pdf
            <i className="st-mini__scan" />
          </div>
          <div className="st-mini__rows">
            {['X-Burger', 'X-Salada', 'Batata frita'].map((n, i) => (
              <div key={n} style={{ animationDelay: `${i * 0.5}s` }}>
                <Check size={13} />
                <span>{n}</span>
                <em>{['28,90', '32,00', '18,00'][i]}</em>
              </div>
            ))}
          </div>
        </div>
      </article>

      <article className="st-card st-reveal">
        <div className="st-mini st-mini--spin" aria-hidden>
          <img src="/site/food-burger-fumaca.webp" alt="" width={120} height={120} loading="lazy" />
          <i />
        </div>
        <h3>Prato em 3D</h3>
        <p>Gira na tela e aparece na mesa.</p>
      </article>

      <article className="st-card st-reveal">
        <div className="st-mini st-mini--sync" aria-hidden>
          <WifiOff size={22} />
          <span>
            <i />
            <i />
            <i />
          </span>
        </div>
        <h3>Vende sem internet</h3>
        <p>Tudo sobe sozinho quando volta.</p>
      </article>

      <article className="st-card st-card--wide st-reveal">
        <div className="st-card__text">
          <MessageCircle size={20} aria-hidden />
          <h3>WhatsApp que responde sozinho</h3>
          <p>Conhece o seu cardápio e o seu horário.</p>
        </div>
        <div className="st-mini st-mini--chat" aria-hidden>
          <span>Vocês abrem hoje?</span>
          <span className="is-me">Abrimos às 18h. Quer ver o cardápio?</span>
          <span>Quero um Smash duplo</span>
          <span className="is-me">Anotado! Entrega ou retirada?</span>
        </div>
      </article>

      <article className="st-card st-reveal">
        <div className="st-mini st-mini--url" aria-hidden>
          <Globe size={15} />
          <span>
            <b>seunome</b>.comandou.com
          </span>
        </div>
        <h3>Endereço e marca seus</h3>
        <p>Suas cores, seu logo, seu domínio.</p>
      </article>

      <article className="st-card st-reveal">
        <div className="st-mini st-mini--receipt" aria-hidden>
          <div>
            <i />
            <i />
            <i />
            <b>Pix aprovado</b>
          </div>
        </div>
        <h3>NFC-e e Pix no caixa</h3>
        <p>Nota no fechamento, QR na tela.</p>
      </article>

      <article className="st-card st-reveal">
        <div className="st-mini st-mini--app" aria-hidden>
          <span>
            <Mascot size={26} />
          </span>
        </div>
        <h3>Instala como app</h3>
        <p>Celular, tablet e computador.</p>
      </article>
    </div>
  );
}

export function SiteApp() {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [plan, setPlan] = useState<PublicPlan | null>(null);
  const [look, setLook] = useState<Look>(FIRST_LOOK);
  const [mood, setMood] = useState<PandaMood>('idle');
  const [enter, setEnter] = useState(false);
  const [theme] = useTheme();
  const calm = useRef<number | undefined>(undefined);
  useReveal();

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

  const trialDays = config?.trialDays ?? 3;
  const contact = contactHref(config?.salesContact ?? '');
  const toBuilder = () => {
    document.getElementById('criar')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(
      () => document.querySelector<HTMLElement>('#criar .st-input')?.focus({ preventScroll: true }),
      450,
    );
  };

  return (
    <div className="st">
      <i className="st-progress" aria-hidden />
      <header className="st-nav">
        <div className="st-nav__in">
          <a className="st-brand" href="#topo" aria-label="Comandou, início">
            <Mascot size={30} badge />
            <span>Comandou</span>
          </a>
          <nav className="st-nav__links" aria-label="Seções">
            <a href="#sistema">O sistema</a>
            <a href="#como">Como funciona</a>
            <a href="#preco">Preço</a>
            <a href="#perguntas">Perguntas</a>
          </nav>
          <div className="st-nav__end">
            <button
              type="button"
              className="st-icon"
              aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
              onClick={(e) =>
                switchTheme(theme === 'dark' ? 'light' : 'dark', { x: e.clientX, y: e.clientY })
              }
            >
              {theme === 'dark' ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
            </button>
            <Button variant="ghost" onClick={() => setEnter(true)}>
              Entrar
            </Button>
            <Button className="st-nav__cta" onClick={toBuilder}>
              Criar meu restaurante
            </Button>
          </div>
        </div>
      </header>

      <main id="topo">
        <section className="st-hero">
          <div className="st-hero__text">
            <h1 className="st-h1">
              <span className="st-h1__line">Seu restaurante no ar</span>{' '}
              <span className="st-h1__line st-h1__accent">em minutos.</span>
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
          </div>
          <div className="st-hero__art">
            <div className="st-peek">
              <LivePanda size={132} mood={mood} title="Panda do Comandou" />
            </div>
            <div className="st-float">
              <PhoneMock look={look} />
            </div>
          </div>
        </section>

        <Marquee />

        <section className="st-sec" id="sistema">
          <div className="st-sec__head st-reveal">
            <h2>Tudo numa tela só.</h2>
          </div>
          <div className="st-reveal">
            <Tour dark={theme === 'dark'} />
          </div>
        </section>

        <section className="st-sec st-sec--tint">
          <div className="st-sec__head st-reveal">
            <h2>Feito para o balcão.</h2>
          </div>
          <Details />
        </section>

        <section className="st-sec" id="como">
          <div className="st-sec__head st-reveal">
            <h2>Três passos.</h2>
          </div>
          <ol className="st-how st-reveal">
            {STEPS.map((s, i) => (
              <li key={s.title} style={{ '--i': i } as React.CSSProperties}>
                <span className="st-how__n">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="st-sec st-sec--tint" id="preco">
          <div className="st-price st-reveal">
            <div className="st-price__left">
              <h2>Um plano. Tudo dentro.</h2>
              <p>{trialDays} dias grátis, sem cartão e sem limite de pedidos.</p>
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
              <div className="st-price__cta">
                <Button size="lg" onClick={toBuilder}>
                  Testar {trialDays} dias grátis
                </Button>
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
          </div>
        </section>

        <section className="st-sec st-sec--narrow" id="perguntas">
          <div className="st-sec__head st-reveal">
            <h2>Perguntas.</h2>
          </div>
          <div className="st-faq st-reveal">
            {SITE_FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="st-end st-reveal">
          <div className="st-end__panda">
            <LivePanda size={84} mood="happy" />
          </div>
          <h2>Vamos colocar o seu no ar?</h2>
          <div className="st-end__cta">
            <Button size="lg" onClick={toBuilder}>
              Criar meu restaurante
            </Button>
            {config?.demoUrl && (
              <a className="cm-btn cm-btn--secondary cm-btn--lg" href={config.demoUrl}>
                Ver um cardápio de exemplo
              </a>
            )}
          </div>
        </section>
      </main>

      <footer className="st-foot">
        <div className="st-foot__in">
          <span className="st-brand">
            <Mascot size={24} badge />
            <span>Comandou</span>
          </span>
          <nav aria-label="Rodapé">
            <a href="#sistema">O sistema</a>
            <a href="#preco">Preço</a>
            <a href="#perguntas">Perguntas</a>
            <button type="button" onClick={() => setEnter(true)}>
              Entrar
            </button>
          </nav>
          <small>Pedidos, salão, cozinha e caixa no mesmo lugar.</small>
        </div>
      </footer>

      <EnterModal open={enter} onClose={() => setEnter(false)} />
    </div>
  );
}
