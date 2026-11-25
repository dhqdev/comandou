import { ArrowRight, Check, Globe, MapPin, PencilLine, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Button, Spinner, type PandaMood } from '../design-system';
import { CreateFlow, type Created, type CreateState, type TrialForm } from './CreateFlow';
import type { SiteConfig } from './host';
import { calmMotion } from './motion';
import type { Look } from './PhoneMock';
import { looksLikeUrl, parseItems, SAMPLE_ITEMS, SAMPLE_STORE } from './site-data';

/**
 * "Crie o seu restaurante": a pessoa cola o site, o link do Google Maps ou descreve os itens;
 * o celular ao lado já mostra a loja com o nome, a cor e os itens dela. Depois informa nome e
 * e-mail (CreateFlow.tsx), o restaurante é criado e ela entra direto nele, já logada.
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

/** A loja de exemplo do celular, antes de a pessoa mexer em qualquer coisa. */
export const FIRST_LOOK: Look = {
  name: SAMPLE_STORE.name,
  color: null,
  icon: SAMPLE_STORE.logo,
  cover: SAMPLE_STORE.cover,
  items: SAMPLE_ITEMS,
  typed: false,
  tagline: SAMPLE_STORE.tagline,
  chips: SAMPLE_STORE.chips,
};

const MODES: {
  key: Mode;
  label: string;
  short: string;
  icon: typeof Globe;
}[] = [
  { key: 'site', label: 'Tenho site', short: 'Site', icon: Globe },
  { key: 'maps', label: 'Google Maps', short: 'Maps', icon: MapPin },
  { key: 'text', label: 'Vou descrever', short: 'Descrever', icon: PencilLine },
];

/** Exemplos que o campo do site escreve sozinho enquanto está vazio. */
const SITE_EXAMPLES = [
  'seurestaurante.com.br',
  'pizzariadobairro.com.br',
  'lanchonetedaesquina.com',
  'hamburgueriacentral.com.br',
];

/**
 * Texto de exemplo que se escreve e se apaga no campo vazio (React Bits "TextType", feito sem
 * biblioteca e direto no atributo, sem redesenhar a tela a cada letra).
 */
function useTypedPlaceholder(
  ref: RefObject<HTMLInputElement | null>,
  phrases: string[],
  active: boolean,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !active || calmMotion()) return;
    let phrase = 0;
    let chars = 0;
    let erasing = false;
    let t = 0;
    const tick = () => {
      const full = phrases[phrase] ?? '';
      if (!erasing) {
        chars += 1;
        if (chars >= full.length) {
          erasing = true;
          el.placeholder = full;
          t = window.setTimeout(tick, 1800);
          return;
        }
      } else {
        chars -= 2;
        if (chars <= 0) {
          chars = 0;
          erasing = false;
          phrase = (phrase + 1) % phrases.length;
          el.placeholder = '';
          t = window.setTimeout(tick, 350);
          return;
        }
      }
      el.placeholder = full.slice(0, chars);
      t = window.setTimeout(tick, erasing ? 28 : 55 + Math.random() * 45);
    };
    el.placeholder = phrases[0] ?? '';
    t = window.setTimeout(() => {
      chars = (phrases[0] ?? '').length;
      erasing = true;
      tick();
    }, 2200);
    return () => {
      window.clearTimeout(t);
      el.placeholder = phrases[0] ?? '';
    };
  }, [ref, phrases, active]);
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

const EMPTY_FORM: TrialForm = { restaurant: '', name: '', email: '', phone: '', company: '' };

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
  const [form, setForm] = useState<TrialForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [state, setState] = useState<CreateState>('creating');
  const [tick, setTick] = useState(0);
  const [reachable, setReachable] = useState(false);
  const [ai, setAi] = useState<AiState>({ at: 'idle' });
  const named = useRef(false);
  const field = useRef<HTMLInputElement>(null);

  const value = mode === 'site' ? link : mode === 'maps' ? maps : text;
  useTypedPlaceholder(field, SITE_EXAMPLES, mode === 'site' && !link);

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

  // O celular acompanha: a loja de exemplo até a pessoa mexer; depois o nome, a cor e a capa do
  // site dela, os itens que ela está digitando ou o site inteiro que a IA montou.
  useEffect(() => {
    const typed = typedItems.length > 0;
    const touched = typed || !!preview || !!form.restaurant.trim() || ai.at !== 'idle';
    if (!touched) {
      onLook(FIRST_LOOK);
      return;
    }
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
      el.scrollIntoView({ block: 'center', behavior: calmMotion() ? 'auto' : 'smooth' });
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
        restaurant: form.restaurant.trim(),
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone || null,
        source: source(),
        ...(ai.at === 'done' ? { aiSite: ai.claim } : {}),
        company: form.company,
      });
      setState('creating');
      setTick(0);
      setReachable(false);
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
          // Não volta para este cadastro ao recarregar: a pessoa pode tentar de novo.
          try {
            sessionStorage.removeItem(STORE_KEY);
          } catch {
            /* sem armazenamento */
          }
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

  const retry = () => {
    setCreated(null);
    setState('creating');
    setError(null);
  };

  const closed = config && !config.signup;
  // Cor, ícone e capa da loja nova: do site que a IA montou, senão da prévia do site dela.
  const made = ai.at === 'done' ? ai.site : null;
  const brand = {
    color: made?.brandColor ?? preview?.color ?? null,
    icon: made?.logoUrl ?? preview?.icon ?? null,
    cover: made?.coverUrl ?? preview?.image ?? null,
  };
  const modeIndex = MODES.findIndex((m) => m.key === mode);
  const Icon = MODES[modeIndex]!.icon;

  return (
    <>
      <div className="st-build" id="criar">
        <div
          className="st-seg"
          role="tablist"
          aria-label="De onde vem o seu cardápio"
          style={{ '--seg-i': modeIndex } as CSSProperties}
        >
          <span className="st-seg__glider" aria-hidden />
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
          className={`st-build__form ${mode === 'text' ? 'is-text' : ''}`}
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
            <div className="st-input-wrap" key={mode}>
              <Icon className="st-input-wrap__ic" size={18} aria-hidden />
              <input
                ref={field}
                className="st-input"
                aria-label={mode === 'site' ? 'Endereço do seu site' : 'Link do Google Maps'}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={2000}
                placeholder={mode === 'site' ? SITE_EXAMPLES[0] : 'Cole o link do Google Maps'}
                value={value}
                onChange={(e) => (mode === 'site' ? setLink : setMaps)(e.target.value)}
              />
              {looking && <Spinner inline label="Procurando" />}
            </div>
          )}
          <Button
            type="submit"
            size="lg"
            className="st-build__go st-press"
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
                <ArrowRight size={18} aria-hidden className="st-arrow__i" />
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
          ) : mode === 'maps' ? (
            <span>No Maps, toque em Compartilhar e copie o link.</span>
          ) : (
            <span>Sem site? Use “Vou descrever” e escreva os itens.</span>
          )}
        </div>
      </div>

      {ai.at === 'done' && !open && (
        <div className="st-sticky">
          <Button size="lg" className="st-press" onClick={() => setOpen(true)}>
            Gostei, criar meu restaurante
            <ArrowRight size={18} aria-hidden />
          </Button>
        </div>
      )}

      <CreateFlow
        open={open}
        onClose={(force) => (force || !busy) && setOpen(false)}
        form={form}
        onForm={(f, byHand) => {
          if (byHand) named.current = true;
          setForm(f);
        }}
        busy={busy}
        error={error}
        onSubmit={() => void submit()}
        created={created}
        state={state}
        tick={tick}
        reachable={reachable}
        onEnter={enter}
        onRetry={retry}
        look={brand}
        trialDays={config?.trialDays ?? 0}
      />
    </>
  );
}
