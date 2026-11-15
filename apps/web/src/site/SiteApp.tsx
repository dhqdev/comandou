import {
  Box,
  Check,
  FileText,
  Globe,
  MessageCircle,
  Moon,
  ReceiptText,
  Smartphone,
  Sun,
  WifiOff,
} from 'lucide-react';
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
import { SAMPLE_ITEMS, SITE_FAQ, STEPS, TOUR } from './site-data';
import './site.css';

/**
 * Site público do Comandou (comandou.com): o que o sistema faz, com telas de verdade, e o
 * cadastro em que o dono cria o próprio restaurante de teste a partir do site, do Google Maps
 * ou de uma descrição. Usa os mesmos tokens do sistema (claro e escuro) e o panda.
 */
const FIRST_LOOK: Look = {
  name: 'Seu restaurante',
  color: null,
  icon: null,
  cover: null,
  items: SAMPLE_ITEMS,
  typed: false,
};

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

function Tour({ dark }: { dark: boolean }) {
  const [tab, setTab] = useState(TOUR[0]!.key);
  const t = TOUR.find((x) => x.key === tab)!;
  return (
    <div className="st-tour">
      <div className="st-tour__tabs" role="tablist" aria-label="Telas do sistema">
        {TOUR.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={x.key === tab}
            className={x.key === tab ? 'is-on' : ''}
            onClick={() => setTab(x.key)}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="st-tour__head" key={`${tab}-head`}>
        <h3>{t.title}</h3>
        <p>{t.text}</p>
      </div>
      <div className="st-shot">
        <div className="st-shot__bar" aria-hidden>
          <i />
          <i />
          <i />
          <span>fumaca.comandou.com</span>
        </div>
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

  // O panda reage (achou o site, criou o restaurante) e volta ao normal sozinho.
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
            <h1>
              Seu restaurante no ar <span>em minutos.</span>
            </h1>
            <p className="st-lead">
              Cole o link do seu site ou do Google Maps, ou conte o que você vende. O Comandou monta
              o cardápio online, o PDV, a cozinha e o caixa. Você só confere.
            </p>
            <Builder config={config} onLook={setLook} onMood={react} />
          </div>
          <div className="st-hero__art">
            <div className="st-peek">
              <LivePanda size={132} mood={mood} title="Panda do Comandou" />
            </div>
            <PhoneMock look={look} />
          </div>
        </section>

        <section className="st-band" aria-label="O que vem junto">
          <ul>
            {[
              'Cardápio online',
              'PDV',
              'Salão e garçom',
              'Cozinha',
              'Caixa',
              'Delivery',
              'Estoque',
              'Financeiro',
              'Nota fiscal',
              'WhatsApp',
            ].map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>

        <section className="st-sec" id="sistema">
          <div className="st-sec__head st-reveal">
            <h2>Um sistema só, do pedido ao fechamento.</h2>
            <p>
              Estas são telas de verdade, de uma hamburgueria com um ano de pedidos. Nada de
              desenho: é o que você abre no primeiro dia.
            </p>
          </div>
          <div className="st-reveal">
            <Tour dark={theme === 'dark'} />
          </div>
        </section>

        <section className="st-sec st-sec--tint">
          <div className="st-sec__head st-reveal">
            <h2>Os detalhes que fazem diferença no balcão.</h2>
          </div>
          <div className="st-bento">
            <article className="st-card st-card--wide st-reveal">
              <div className="st-card__text">
                <FileText size={20} aria-hidden />
                <h3>Cardápio pronto a partir do PDF ou de uma foto</h3>
                <p>
                  Mande o PDF, tire foto do cardápio impresso ou cole o link. A inteligência
                  artificial lê itens, preços e fotos. Você confere e publica.
                </p>
              </div>
              <div className="st-mini st-mini--import" aria-hidden>
                <div className="st-mini__file">
                  <FileText size={16} /> cardapio.pdf
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
              <Box size={20} aria-hidden />
              <h3>Prato em 3D no cardápio</h3>
              <p>
                O cliente gira o prato na tela e, no celular, abre a câmera para ver o prato na
                própria mesa, em tamanho real.
              </p>
            </article>

            <article className="st-card st-reveal">
              <WifiOff size={20} aria-hidden />
              <h3>Vende mesmo sem internet</h3>
              <p>
                Caiu a conexão, o caixa continua. O que foi feito offline sobe sozinho quando a
                internet volta.
              </p>
            </article>

            <article className="st-card st-card--wide st-reveal">
              <div className="st-card__text">
                <MessageCircle size={20} aria-hidden />
                <h3>WhatsApp que responde sozinho</h3>
                <p>
                  Avisos de pedido e um atendente com inteligência artificial que conhece o seu
                  cardápio e o seu horário.
                </p>
              </div>
              <div className="st-mini st-mini--chat" aria-hidden>
                <span>Vocês abrem hoje?</span>
                <span className="is-me">Abrimos às 18h. Quer ver o cardápio?</span>
                <span>Quero um Smash duplo</span>
                <span className="is-me">Anotado! Entrega ou retirada?</span>
              </div>
            </article>

            <article className="st-card st-reveal">
              <Globe size={20} aria-hidden />
              <h3>Endereço e marca seus</h3>
              <p>
                Seu restaurante em seunome.comandou.com ou no seu domínio, com as suas cores e o seu
                logo.
              </p>
            </article>

            <article className="st-card st-reveal">
              <ReceiptText size={20} aria-hidden />
              <h3>Nota fiscal e Pix no caixa</h3>
              <p>
                NFC-e emitida no fechamento da venda e Pix com QR Code na tela e no comprovante.
              </p>
            </article>

            <article className="st-card st-reveal">
              <Smartphone size={20} aria-hidden />
              <h3>Instala como aplicativo</h3>
              <p>
                No celular do garçom, no tablet da cozinha e no computador do caixa. Sem loja de
                aplicativos e sem instalar nada pesado.
              </p>
            </article>
          </div>
        </section>

        <section className="st-sec" id="como">
          <div className="st-sec__head st-reveal">
            <h2>Três passos. O primeiro você faz agora.</h2>
          </div>
          <ol className="st-how">
            {STEPS.map((s, i) => (
              <li key={s.title} className="st-reveal" style={{ transitionDelay: `${i * 60}ms` }}>
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
              <p>
                Sem tabela de recursos para decifrar e sem limite de pedidos. Comece pelo teste de{' '}
                {trialDays} dias, sem cartão.
              </p>
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
              ].map((x) => (
                <li key={x}>
                  <Check size={16} aria-hidden />
                  {x}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="st-sec st-sec--narrow" id="perguntas">
          <div className="st-sec__head st-reveal">
            <h2>Perguntas de quem está começando.</h2>
          </div>
          <div className="st-faq st-reveal">
            {SITE_FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a.replace('dias de teste', `${trialDays} dias de teste`)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="st-end st-reveal">
          <LivePanda size={84} mood="happy" />
          <h2>Vamos colocar o seu no ar?</h2>
          <p>Leva menos tempo que fechar o caixa.</p>
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
