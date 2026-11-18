import { ArrowRight, Check, Copy, Globe, MapPin, PencilLine, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Modal, Spinner, TextField, type PandaMood } from '../design-system';
import type { SiteConfig } from './host';
import { looksLikeUrl, parseItems, SAMPLE_ITEMS, type MockItem } from './site-data';

/**
 * "Crie o seu restaurante": a pessoa cola o site, o link do Google Maps ou descreve os itens;
 * o celular ao lado já mostra a loja com o nome, a cor e os itens dela. Depois informa nome e
 * e-mail, o restaurante é criado e ela entra direto nele, já logada.
 */
export type Mode = 'site' | 'maps' | 'text';

export interface Preview {
  kind: 'site' | 'maps';
  name: string | null;
  host: string;
  description?: string | null;
  icon?: string | null;
  image?: string | null;
  color?: string | null;
}

/** O que o celular do topo mostra agora. */
export interface Look {
  name: string;
  color: string | null;
  icon: string | null;
  cover: string | null;
  items: MockItem[];
  /** Itens digitados pela pessoa (sem foto). */
  typed: boolean;
  /** Frase do topo da loja (site montado pela IA). */
  tagline?: string | null;
  /** Categorias da loja (as da IA; sem elas, as de exemplo). */
  chips?: string[];
  /** A IA está montando o site agora. */
  building?: boolean;
  /** Site montado pela IA (o celular comemora). */
  ai?: boolean;
}

/** O site que a IA montou (o rascunho inteiro fica no servidor até o cadastro). */
interface AiSite {
  name: string | null;
  tagline: string | null;
  about: string | null;
  brandColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  suggested: boolean;
  items: number;
  categories: {
    name: string;
    items: {
      name: string;
      description: string | null;
      price: string | null;
      imageUrl: string | null;
    }[];
  }[];
}

type AiState =
  | { at: 'idle' }
  | { at: 'building' }
  | { at: 'done'; claim: string; site: AiSite; value: string }
  | { at: 'failed'; message: string | null };

const brl = (p: string | null) => (p ? p.replace('.', ',') : undefined);

interface Created {
  token: string;
  entry: string;
  slug: string;
  url: string;
  email: string;
  password: string;
  trialDays: number;
  trialEndsAt: string;
  emailOn: boolean;
}

const MODES: {
  key: Mode;
  label: string;
  short: string;
  icon: typeof Globe;
  placeholder: string;
}[] = [
  {
    key: 'site',
    label: 'Tenho site',
    short: 'Site',
    icon: Globe,
    placeholder: 'seurestaurante.com.br',
  },
  {
    key: 'maps',
    label: 'Google Maps',
    short: 'Maps',
    icon: MapPin,
    placeholder: 'Cole o link do Google Maps',
  },
  { key: 'text', label: 'Vou descrever', short: 'Descrever', icon: PencilLine, placeholder: '' },
];

/** (11) 99999-8888 enquanto a pessoa digita. */
function maskPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  const cut = d.length > 10 ? 7 : 6;
  return `(${d.slice(0, 2)}) ${d.slice(2, cut)}-${d.slice(cut)}`;
}

const STORE_KEY = 'cm:trial';
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'X-Comandou-Request': '1',
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/v1/public/site/${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { message?: string | string[] };
  if (!r.ok) {
    const m = Array.isArray(data.message) ? data.message[0] : data.message;
    throw new Error(
      r.status === 429
        ? 'Muitas tentativas agora. Espere um pouco e tente de novo.'
        : (m ?? 'Não deu certo agora. Tente de novo.'),
    );
  }
  return data as T;
}

/** O que o celular conta enquanto a IA monta o site. */
export const AI_STEPS = [
  'Lendo o que você mandou',
  'Escolhendo as cores',
  'Montando o cardápio',
  'Escrevendo as descrições',
];

const BUILD_STEPS = [
  'Reservando o seu endereço',
  'Montando cardápio, PDV, cozinha e caixa',
  'Criando o seu login',
  'Abrindo as portas',
];

export function Builder({
  config,
  onLook,
  onMood,
}: {
  config: SiteConfig | null;
  onLook: (l: Look) => void;
  onMood: (m: PandaMood) => void;
}) {
  const [mode, setMode] = useState<Mode>('site');
  const [link, setLink] = useState('');
  const [maps, setMaps] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [looking, setLooking] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ restaurant: '', name: '', email: '', phone: '', company: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [state, setState] = useState<'creating' | 'ready' | 'failed' | 'slow'>('creating');
  const [tick, setTick] = useState(0);
  const [reachable, setReachable] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ai, setAi] = useState<AiState>({ at: 'idle' });
  const named = useRef(false);

  const value = mode === 'site' ? link : mode === 'maps' ? maps : text;

  // Voltou para a página (ou recarregou) com o restaurante recém-criado: mostra o login de novo.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORE_KEY);
      if (!saved) return;
      setCreated(JSON.parse(saved) as Created);
      setOpen(true);
    } catch {
      /* sem armazenamento */
    }
  }, []);

  // Prévia do site ou do lugar (sem IA): nome, ícone, cor e capa, meio segundo depois de digitar.
  useEffect(() => {
    if (mode === 'text') return;
    const url = value.trim();
    setPreview(null);
    if (!looksLikeUrl(url)) {
      setLooking(false);
      return;
    }
    setLooking(true);
    onMood('thinking');
    let alive = true;
    const t = window.setTimeout(() => {
      post<Preview>('preview', { url })
        .then((p) => {
          if (!alive) return;
          setPreview(p);
          onMood(p.name ? 'joy' : 'happy');
        })
        .catch(() => alive && onMood('idle'))
        .finally(() => alive && setLooking(false));
    }, 550);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mode]);

  const typedItems = useMemo(() => (mode === 'text' ? parseItems(text) : []), [mode, text]);

  // Mudou o link ou o texto: o site da IA era de outra coisa.
  useEffect(() => {
    setAi((cur) =>
      (cur.at === 'done' && cur.value !== value.trim()) || cur.at === 'failed'
        ? { at: 'idle' }
        : cur,
    );
  }, [value]);

  // O celular acompanha: nome, cor e capa do site; os itens que a pessoa está digitando; ou o
  // site inteiro que a IA montou.
  useEffect(() => {
    const typed = typedItems.length > 0;
    const base: Look = {
      name: form.restaurant.trim() || preview?.name || 'Seu restaurante',
      color: preview?.color ?? null,
      icon: preview?.icon ?? null,
      cover: preview?.image ?? null,
      items: typed ? typedItems : SAMPLE_ITEMS,
      typed,
      building: ai.at === 'building',
    };
    if (ai.at === 'done') {
      const s = ai.site;
      const items = s.categories.flatMap((c) =>
        c.items.map((i) => ({
          name: i.name,
          desc: i.description ?? undefined,
          price: brl(i.price),
          photo: i.imageUrl ?? undefined,
        })),
      );
      onLook({
        ...base,
        name: form.restaurant.trim() || s.name || base.name,
        color: s.brandColor ?? base.color,
        icon: s.logoUrl ?? base.icon,
        cover: s.coverUrl ?? base.cover,
        items: items.length ? items : base.items,
        typed: items.length > 0 && !items.some((i) => i.photo),
        tagline: s.tagline,
        chips: s.categories.map((c) => c.name).slice(0, 4),
        ai: true,
      });
      return;
    }
    onLook(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, typedItems, form.restaurant, ai]);

  useEffect(() => {
    if (preview?.name && !named.current) setForm((f) => ({ ...f, restaurant: preview.name! }));
  }, [preview]);

  const start = () => {
    setError(null);
    const src = source();
    // Com a IA ligada, o primeiro clique monta o site no celular; o segundo cria o restaurante.
    if (
      config?.ai &&
      src.kind !== 'none' &&
      ai.at !== 'done' &&
      ai.at !== 'building' &&
      ai.at !== 'failed'
    ) {
      void build(src as { kind: 'site' | 'maps' | 'text'; value: string });
      return;
    }
    setOpen(true);
  };

  const build = async (src: { kind: 'site' | 'maps' | 'text'; value: string }) => {
    setAi({ at: 'building' });
    onMood('thinking');
    showPhone();
    try {
      const r = await post<{ claim: string; site: AiSite }>('ai', src);
      setAi({ at: 'done', claim: r.claim, site: r.site, value: src.value });
      if (r.site.name && !named.current) setForm((f) => ({ ...f, restaurant: r.site.name! }));
      onMood('joy');
    } catch (e) {
      // Sem IA agora (limite, fora do ar): segue o cadastro de sempre.
      const msg = (e as Error).message;
      setAi({ at: 'failed', message: /criou alguns sites/.test(msg) ? msg : null });
      onMood('idle');
      setOpen(true);
    }
  };

  /** No celular, o aparelho fica embaixo do formulário: rola até ele para ver a IA montando. */
  const showPhone = () => {
    const el = document.querySelector('.st-phone');
    if (!el || window.innerWidth > 900) return;
    const r = el.getBoundingClientRect();
    if (r.top > window.innerHeight * 0.6)
      el.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
  };

  const source = () => {
    const v = value.trim();
    if (mode === 'text')
      return v.length >= 10 ? { kind: 'text', value: v } : { kind: 'none', value: '' };
    if (!looksLikeUrl(v)) return { kind: 'none', value: '' };
    return { kind: preview?.kind === 'maps' || mode === 'maps' ? 'maps' : 'site', value: v };
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    onMood('thinking');
    try {
      const c = await post<Created>('trials', {
        restaurant: form.restaurant,
        name: form.name,
        email: form.email,
        phone: form.phone || null,
        source: source(),
        ...(ai.at === 'done' ? { aiSite: ai.claim } : {}),
        company: form.company,
      });
      setState('creating');
      setTick(0);
      setCreated(c);
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify(c));
      } catch {
        /* sem armazenamento: o login segue na tela e no e-mail */
      }
    } catch (e) {
      setError((e as Error).message);
      onMood('sad');
    } finally {
      setBusy(false);
    }
  };

  // Acompanha a criação (leva poucos segundos) e depois confere se o endereço novo já responde.
  useEffect(() => {
    if (!created || state === 'ready' || state === 'failed') return;
    let alive = true;
    let n = 0;
    const poll = async () => {
      if (!alive) return;
      n++;
      setTick((t) => t + 1);
      try {
        const r = await fetch(`/api/v1/public/site/trials/${created.token}`, {
          headers: { Accept: 'application/json' },
        });
        if (r.status === 404) {
          // Cadastro antigo guardado nesta aba: não há mais o que acompanhar.
          setState('ready');
          return;
        }
        const s = (await r.json()) as { state: 'creating' | 'ready' | 'failed' };
        if (!alive) return;
        if (s.state === 'ready') {
          setState('ready');
          onMood('joy');
          return;
        }
        if (s.state === 'failed') {
          setState('failed');
          onMood('sad');
          return;
        }
      } catch {
        /* rede oscilou: tenta de novo */
      }
      if (n > 60) setState('slow');
      window.setTimeout(poll, n < 10 ? 1200 : 3000);
    };
    void poll();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created]);

  useEffect(() => {
    if (!created || state !== 'ready' || reachable) return;
    let alive = true;
    let n = 0;
    const ping = () => {
      if (!alive) return;
      n++;
      // Uma imagem do endereço novo (a política de segurança da página só deixa imagens de fora).
      const img = new Image();
      img.onload = () => alive && setReachable(true);
      // Endereço novo ainda ganhando o certificado: tenta por até 1 minuto e libera mesmo assim.
      img.onerror = () => (n > 20 ? alive && setReachable(true) : window.setTimeout(ping, 3000));
      img.src = `${created.url}/favicon.svg?t=${Date.now()}`;
    };
    ping();
    return () => {
      alive = false;
    };
  }, [created, state, reachable]);

  const enter = () => {
    if (!created) return;
    try {
      sessionStorage.removeItem(STORE_KEY);
    } catch {
      /* segue */
    }
    window.location.assign(`${created.url}/entrar#${created.entry}`);
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(
        `${created.url}\nLogin: ${created.email}\nSenha: ${created.password}`,
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* sem permissão de copiar: os dados estão na tela */
    }
  };

  const closed = config && !config.signup;
  const valid =
    form.restaurant.trim().length >= 2 &&
    form.name.trim().length >= 2 &&
    /^\S+@\S+\.\S+$/.test(form.email.trim());
  const step = Math.min(BUILD_STEPS.length - 1, Math.floor(tick / 2));

  return (
    <>
      <div className="st-build" id="criar">
        <div className="st-seg" role="tablist" aria-label="De onde vem o seu cardápio">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={mode === m.key}
              className={`st-seg__btn ${mode === m.key ? 'is-on' : ''}`}
              onClick={() => {
                setMode(m.key);
                onMood('idle');
              }}
            >
              <m.icon size={15} aria-hidden />
              <span className="st-seg__full">{m.label}</span>
              <span className="st-seg__short">{m.short}</span>
            </button>
          ))}
        </div>
        <form
          className="st-build__form"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          {mode === 'text' ? (
            <textarea
              className="st-input st-input--area"
              aria-label="Descreva o que você vende"
              rows={4}
              maxLength={6000}
              placeholder={
                'X-Burger 28,90\nX-Salada 32,00\nBatata frita 18,00\nRefrigerante lata 7,00'
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          ) : (
            <div className="st-input-wrap">
              <input
                className="st-input"
                aria-label={mode === 'site' ? 'Endereço do seu site' : 'Link do Google Maps'}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={2000}
                placeholder={MODES.find((m) => m.key === mode)!.placeholder}
                value={value}
                onChange={(e) => (mode === 'site' ? setLink : setMaps)(e.target.value)}
              />
              {looking && <Spinner inline label="Procurando" />}
            </div>
          )}
          <Button
            type="submit"
            size="lg"
            className="st-build__go"
            disabled={!!closed}
            loading={ai.at === 'building'}
          >
            {ai.at === 'building'
              ? 'Montando'
              : ai.at === 'done'
                ? 'Gostei, criar'
                : config?.ai && value.trim()
                  ? 'Criar com IA'
                  : 'Criar meu restaurante'}
            {ai.at !== 'building' &&
              (config?.ai && value.trim() && ai.at !== 'done' ? (
                <Sparkles size={17} aria-hidden />
              ) : (
                <ArrowRight size={18} aria-hidden />
              ))}
          </Button>
        </form>
        <div className="st-build__under" aria-live="polite">
          {ai.at === 'building' ? (
            <span className="st-found st-found--ai">
              <Sparkles size={15} aria-hidden /> A IA está montando o seu site
            </span>
          ) : ai.at === 'done' ? (
            <span className="st-found st-found--ai">
              <Sparkles size={15} aria-hidden />
              Site pronto, com {ai.site.items} {ai.site.items === 1 ? 'item' : 'itens'}
              {ai.site.suggested ? ' de sugestão' : ''}.
              <button
                type="button"
                className="st-link"
                onClick={() => {
                  const v = source();
                  if (v.kind !== 'none')
                    void build(v as { kind: 'site' | 'maps' | 'text'; value: string });
                }}
              >
                Refazer
              </button>
            </span>
          ) : ai.at === 'failed' && ai.message ? (
            <span>{ai.message}</span>
          ) : preview?.name ? (
            <span className="st-found">
              {preview.icon ? (
                <img src={preview.icon} alt="" width={18} height={18} />
              ) : (
                <Check size={15} aria-hidden />
              )}
              Achei <strong>{preview.name}</strong>
              <span className="st-found__host">{preview.host}</span>
            </span>
          ) : closed ? (
            <span>O cadastro pelo site está fechado no momento. Fale com a gente.</span>
          ) : mode === 'text' ? (
            <span>Um item por linha, com o preço no fim.</span>
          ) : (
            <span>Sem site? Use “Vou descrever” e escreva os itens.</span>
          )}
        </div>
      </div>

      {ai.at === 'done' && !open && (
        <div className="st-sticky">
          <Button size="lg" onClick={() => setOpen(true)}>
            Gostei, criar meu restaurante
            <ArrowRight size={18} aria-hidden />
          </Button>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={
          !created
            ? 'Falta pouco'
            : state === 'ready'
              ? 'Seu restaurante está no ar'
              : state === 'failed'
                ? 'Não deu certo'
                : 'Criando o seu restaurante'
        }
        footer={
          !created ? (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Voltar
              </Button>
              <Button onClick={() => void submit()} loading={busy} disabled={!valid}>
                Criar e abrir
              </Button>
            </>
          ) : state === 'ready' ? (
            <>
              <Button variant="secondary" onClick={() => void copy()} icon={<Copy size={15} />}>
                {copied ? 'Copiado' : 'Copiar login'}
              </Button>
              <Button onClick={enter} loading={!reachable}>
                {reachable ? 'Abrir meu restaurante' : 'Preparando o endereço'}
              </Button>
            </>
          ) : undefined
        }
      >
        {!created ? (
          <div className="cm-form">
            {error && (
              <div className="cm-form__block">
                <Alert tone="danger">{error}</Alert>
              </div>
            )}
            <TextField
              label="Nome do restaurante"
              autoComplete="organization"
              maxLength={80}
              value={form.restaurant}
              onChange={(e) => {
                named.current = true;
                setForm({ ...form, restaurant: e.target.value });
              }}
            />
            <TextField
              label="Seu nome"
              autoComplete="name"
              maxLength={120}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <TextField
              label="E-mail"
              type="email"
              inputMode="email"
              autoComplete="email"
              hint="O login e a senha chegam aqui."
              maxLength={254}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <TextField
              label="WhatsApp (opcional)"
              inputMode="tel"
              autoComplete="tel"
              maxLength={20}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })}
            />
            {/* Campo que gente não vê nem preenche; robô preenche e o cadastro é recusado. */}
            <input
              className="st-hp"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
          </div>
        ) : state === 'ready' ? (
          <div className="st-ready">
            <dl className="st-cred">
              <div>
                <dt>Endereço</dt>
                <dd>{created.url.replace(/^https?:\/\//, '')}</dd>
              </div>
              <div>
                <dt>Login</dt>
                <dd>{created.email}</dd>
              </div>
              <div>
                <dt>Senha</dt>
                <dd className="st-cred__pass">{created.password}</dd>
              </div>
            </dl>
            <p className="st-ready__note">
              {created.emailOn
                ? `Mandamos esses dados para ${created.email}. `
                : 'Guarde esses dados: eles aparecem só agora. '}
              O teste vale por {created.trialDays} dias.
            </p>
          </div>
        ) : state === 'failed' ? (
          <Alert tone="danger">
            Não conseguimos criar o restaurante agora. Tente de novo em alguns minutos ou fale com a
            gente.
          </Alert>
        ) : (
          <ol className="st-steps-live" aria-live="polite">
            {BUILD_STEPS.map((s, i) => (
              <li key={s} className={i < step ? 'is-done' : i === step ? 'is-now' : ''}>
                <span className="st-steps-live__dot">
                  {i < step ? (
                    <Check size={13} aria-hidden />
                  ) : i === step ? (
                    <Spinner inline label="" />
                  ) : null}
                </span>
                {s}
              </li>
            ))}
            {state === 'slow' && (
              <li className="st-steps-live__slow">
                Está demorando mais que o normal. Pode fechar: o login chega no seu e-mail quando
                ficar pronto.
              </li>
            )}
          </ol>
        )}
      </Modal>
    </>
  );
}

/** Celular com a loja online: a mesma cara do cardápio de verdade, em miniatura. */
export function PhoneMock({ look }: { look: Look }) {
  const initial = look.name.trim()[0]?.toUpperCase() ?? 'C';
  const chips = look.chips?.length ? look.chips : ['Mais pedidos', 'Combos', 'Bebidas'];
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!look.building) return;
    setStep(0);
    const t = window.setInterval(() => setStep((n) => (n + 1) % AI_STEPS.length), 1500);
    return () => window.clearInterval(t);
  }, [look.building]);
  // Uma "versão" por site montado: os itens entram de novo, um atrás do outro.
  const stamp = `${look.ai ? 'ai' : 'base'}-${look.name}-${look.items[0]?.name ?? ''}`;
  return (
    <div
      className={`st-phone ${look.building ? 'is-building' : ''} ${look.ai ? 'is-ai' : ''}`}
      style={look.color ? ({ '--st-brand': look.color } as React.CSSProperties) : undefined}
      aria-hidden
    >
      <div className="st-phone__screen">
        <div
          className="st-phone__cover"
          style={{ backgroundImage: `url(${look.cover ?? '/site/food-capa.webp'})` }}
        />
        <div className="st-phone__logo">
          {look.icon ? <img src={look.icon} alt="" /> : <span>{initial}</span>}
        </div>
        <div className="st-phone__name" key={look.name}>
          {look.name}
        </div>
        {look.tagline ? (
          <div className="st-phone__tag" key={look.tagline}>
            {look.tagline}
          </div>
        ) : (
          <div className="st-phone__open">
            <i /> Aberto agora
          </div>
        )}
        <div className="st-phone__chips" key={`c-${stamp}`}>
          {chips.map((c, i) => (
            <span
              key={c}
              className={i === 0 ? 'is-on' : ''}
              style={{ animationDelay: `${i * 50}ms` }}
            >
              {c}
            </span>
          ))}
        </div>
        <ul className="st-phone__items" key={stamp}>
          {look.items.slice(0, 3).map((it, i) => (
            <li
              key={`${it.name}-${i}`}
              style={{ animationDelay: `${look.ai ? 120 + i * 110 : i * 40}ms` }}
            >
              <div>
                <strong>{it.name}</strong>
                {it.desc && <span>{it.desc}</span>}
                <em>{it.price ? `R$ ${it.price}` : 'Preço a definir'}</em>
              </div>
              {it.photo ? (
                <img src={it.photo} alt="" loading="lazy" />
              ) : (
                <b className="st-phone__ph">{it.name[0]?.toUpperCase()}</b>
              )}
            </li>
          ))}
        </ul>
        <div className="st-phone__bag">
          <span>Ver sacola</span>
          <span>R$ 71,80</span>
        </div>
        {look.building && (
          <div className="st-phone__ai">
            <span className="st-phone__scan" />
            <div className="st-phone__ai-card">
              <Sparkles size={18} />
              <span key={step}>{AI_STEPS[step]}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
