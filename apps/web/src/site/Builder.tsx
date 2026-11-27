import {
  ArrowRight,
  Check,
  FileText,
  Globe,
  Instagram,
  Link2,
  MapPin,
  Paperclip,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react';
import { Button, Spinner, type PandaMood } from '../design-system';
import { shrinkImage } from '../lib/media';
import {
  CreateFlow,
  type ContractState,
  type Created,
  type CreateState,
  type TrialForm,
} from './CreateFlow';
import type { SiteConfig } from './host';
import type { SiteMenu } from './MenuField';
import { calmMotion } from './motion';
import type { Look } from './PhoneMock';
import { parseItems, SAMPLE_ITEMS, SAMPLE_STORE } from './site-data';

/**
 * "Crie o seu restaurante" (0.279, pedido do David: "uma barra de texto para eu enviar o que eu
 * quiser sobre o restaurante, seja texto, imagem, link"): um campo só, como uma conversa. A
 * pessoa escreve, cola links (site, Google Maps, iFood), anexa fotos e PDF (logo, cardápio,
 * fachada, cartão do CNPJ) e a IA vai montando a loja no celular ao lado: nome, logo, endereço,
 * cardápio com os preços, estoque sugerido e o CNPJ/CPF. Depois o cadastro (CreateFlow.tsx), o
 * restaurante nasce já logado e o contrato fica pronto para assinar.
 */

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

/** Resposta de cada parte do campo único (texto ou arquivo). */
interface Composed {
  claim: string;
  kind: string | null;
  site: AiSite;
  menu: SiteMenu;
  legal: { document: string | null; legalName: string | null };
  store: {
    address: string | null;
    city: string | null;
    state: string | null;
    cep: string | null;
    whatsapp: string | null;
    hours: number;
  };
  parts: number;
  files: string[];
}

type AiState =
  | { at: 'idle' }
  | { at: 'working'; label: string; prev: Composed | null }
  | { at: 'done'; r: Composed }
  | { at: 'failed'; message: string | null; prev: Composed | null };

/** Arquivo anexado ao campo único. */
interface Attach {
  id: string;
  file: File;
  pdf: boolean;
  preview: string | null;
  state: 'wait' | 'reading' | 'done' | 'failed';
  kind?: string | null;
  error?: string;
}

const KIND_LABEL: Record<string, string> = {
  logo: 'Logo',
  menu: 'Cardápio',
  cover: 'Capa',
  document: 'Documento',
  other: 'Lido',
};

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

/** Exemplos que o campo escreve sozinho enquanto está vazio. */
const EXAMPLES = [
  'Cole o site, o link do Google Maps ou do iFood…',
  'Escreva o cardápio: X-Burger 28,90 · Batata 18,00',
  'Anexe a foto do cardápio e o logo pelo clipe',
  'Mande o CNPJ, o endereço e o horário da loja',
];

/**
 * Texto de exemplo que se escreve e se apaga no campo vazio (React Bits "TextType", feito sem
 * biblioteca e direto no atributo, sem redesenhar a tela a cada letra).
 */
function useTypedPlaceholder(
  ref: RefObject<HTMLTextAreaElement | null>,
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
      t = window.setTimeout(tick, erasing ? 22 : 40 + Math.random() * 35);
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
/** Esta visita ao site: junta as partes e o cardápio enviado ao restaurante criado no fim. */
const SESSION_KEY = 'cm:site-session';
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function siteSession(): string {
  const fresh = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => ID_CHARS[b & 63]).join('');
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return saved;
    const id = fresh();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return fresh();
  }
}

/** Foto ou PDF até 3 MB (o limite da API). Logo em PNG pequeno vai como está (transparência). */
const FILE_MAX = 3 * 1024 * 1024;
const MAX_FILES = 8;
const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
async function fileBody(file: File): Promise<{ body: Blob; type: string }> {
  if (isPdf(file)) {
    if (file.size > FILE_MAX)
      throw new Error('O PDF tem mais de 3 MB. Mande as páginas como fotos ou um PDF menor.');
    return { body: file, type: 'application/pdf' };
  }
  if (file.type === 'image/png' && file.size <= 500 * 1024)
    return { body: file, type: 'image/png' };
  let img = await shrinkImage(file, 2000);
  if (img.blob.size > FILE_MAX) img = await shrinkImage(file);
  return { body: img.blob, type: img.blob.type };
}

/** Links escritos no campo (para mostrar o que a IA vai abrir). */
const LINK_RE =
  /\b((?:https?:\/\/|www\.)[^\s<>"']+|[a-z0-9][a-z0-9-]{1,62}\.(?:com\.br|com|net\.br|net|app|site|menu|food|delivery)(?:\/[^\s<>"']*)?)/gi;
function linksOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    const u = m[1]!.replace(/[),.;!?]+$/, '');
    if (!out.includes(u)) out.push(u);
  }
  return out.slice(0, 3);
}
const linkIcon = (u: string) =>
  /maps\.app\.goo\.gl|google\.[a-z.]+\/maps|goo\.gl\/maps/i.test(u)
    ? MapPin
    : /instagram\.com/i.test(u)
      ? Instagram
      : /ifood|aiqfome|99food|rappi/i.test(u)
        ? Link2
        : Globe;
const shortLink = (u: string) =>
  u
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/\/$/, '')
    .slice(0, 34);

const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'X-Comandou-Request': '1',
};

async function post<T>(path: string, body: unknown): Promise<T> {
  return answer<T>(
    await fetch(`/api/v1/public/site/${path}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    }),
  );
}

async function answer<T>(r: Response): Promise<T> {
  const data = (await r.json().catch(() => ({}))) as { message?: string | string[] };
  if (!r.ok) {
    const m = Array.isArray(data.message) ? data.message[0] : data.message;
    throw new Error(
      r.status === 429
        ? 'Muitas tentativas agora. Espere um pouco e tente de novo.'
        : r.status === 413
          ? 'Arquivo grande demais. Mande uma foto ou um PDF menor.'
          : (m ?? 'Não deu certo agora. Tente de novo.'),
    );
  }
  return data as T;
}

const EMPTY_FORM: TrialForm = {
  restaurant: '',
  name: '',
  email: '',
  phone: '',
  document: '',
  legalName: '',
  company: '',
};

const docMask = (d: string | null) => {
  const v = (d ?? '').replace(/\D/g, '');
  if (v.length === 14) return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (v.length === 11) return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return v;
};

export function Builder({
  config,
  onLook,
  onMood,
}: {
  config: SiteConfig | null;
  onLook: (l: Look) => void;
  onMood: (m: PandaMood) => void;
}) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState('');
  const [files, setFiles] = useState<Attach[]>([]);
  const [drag, setDrag] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TrialForm>(EMPTY_FORM);
  const [place, setPlace] = useState<{ city: string | null; state: string | null }>({
    city: null,
    state: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [state, setState] = useState<CreateState>('creating');
  const [tick, setTick] = useState(0);
  const [reachable, setReachable] = useState(false);
  const [ai, setAi] = useState<AiState>({ at: 'idle' });
  const [session] = useState(siteSession);
  const [contract, setContract] = useState<ContractState | null>(null);
  /** Cardápio com o estoque sugerido (o que a IA montou do campo único). */
  const [siteMenu, setSiteMenu] = useState<{ claim: string; menu: SiteMenu } | null>(null);
  const [stocking, setStocking] = useState(0);
  const stockAsked = useRef(new Set<string>());
  const named = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useTypedPlaceholder(field, EXAMPLES, !text && !files.length);

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

  // Solta as prévias das fotos quando saem do campo.
  useEffect(
    () => () => files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Links não viram itens no celular (só as linhas com o preço).
  const typedItems = useMemo(() => parseItems(text.replace(LINK_RE, '')), [text]);
  const links = useMemo(() => linksOf(text), [text]);
  const result = ai.at === 'done' ? ai.r : ai.at === 'idle' ? null : ai.prev;

  // O celular acompanha: a loja de exemplo até a pessoa mexer; depois os itens que ela escreve e
  // a loja que a IA monta (nome, cor, logo, capa e cardápio).
  useEffect(() => {
    const typed = typedItems.length > 0;
    const touched = typed || !!form.restaurant.trim() || ai.at !== 'idle' || files.length > 0;
    if (!touched) {
      onLook(FIRST_LOOK);
      return;
    }
    const localLogo = files.find((f) => f.kind === 'logo')?.preview ?? null;
    const base: Look = {
      name: form.restaurant.trim() || 'Seu restaurante',
      color: null,
      icon: localLogo,
      cover: null,
      items: typed ? typedItems : SAMPLE_ITEMS,
      typed,
      building: ai.at === 'working',
    };
    if (result) {
      const s = result.site;
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
        color: s.brandColor,
        icon: s.logoUrl ?? localLogo,
        cover: s.coverUrl ?? files.find((f) => f.kind === 'cover')?.preview ?? null,
        items: items.length ? items : base.items,
        typed: items.length > 0 && !items.some((i) => i.photo),
        tagline: s.tagline,
        chips: s.categories.map((c) => c.name).slice(0, 4),
        ai: ai.at === 'done',
      });
      return;
    }
    onLook(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedItems, form.restaurant, ai, files]);

  /** O que a IA achou entra no cadastro (a pessoa confere na janela de criar). */
  const fill = (r: Composed) => {
    setForm((f) => ({
      ...f,
      restaurant: !named.current && r.site.name ? r.site.name : f.restaurant,
      document: f.document || docMask(r.legal.document),
      legalName: f.legalName || r.legal.legalName || '',
      phone: f.phone || (r.store.whatsapp ? maskPhone(r.store.whatsapp) : ''),
    }));
    setPlace({ city: r.store.city, state: r.store.state });
    setSiteMenu({ claim: r.claim, menu: r.menu });
  };

  const addFiles = (list: FileList | File[]) => {
    const picked = Array.from(list).filter((f) => isPdf(f) || f.type.startsWith('image/'));
    if (!picked.length) return;
    setFiles((cur) => {
      const room = Math.max(0, MAX_FILES - cur.length);
      return [
        ...cur,
        ...picked.slice(0, room).map((file) => ({
          id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          pdf: isPdf(file),
          preview: isPdf(file) ? null : URL.createObjectURL(file),
          state: 'wait' as const,
        })),
      ];
    });
    onMood('happy');
  };

  const removeFile = (id: string) =>
    setFiles((cur) => {
      const f = cur.find((x) => x.id === id);
      if (f?.preview) URL.revokeObjectURL(f.preview);
      return cur.filter((x) => x.id !== id);
    });

  const pending = files.filter((f) => f.state === 'wait' || f.state === 'failed');
  const newText = text.trim() && text.trim() !== sent ? text.trim() : '';
  const hasNew = !!newText || pending.length > 0;

  /** Manda o que é novo (texto e arquivos), um de cada vez, e soma no rascunho. */
  const compose = async () => {
    let claim = result?.claim;
    let last: Composed | null = result;
    let failed: string | null = null;
    onMood('thinking');
    showPhone();
    if (newText) {
      setAi({
        at: 'working',
        label: links.length ? 'Abrindo os links e lendo o texto' : 'Lendo o que você escreveu',
        prev: last,
      });
      try {
        last = await post<Composed>('compose', {
          text: newText,
          session,
          ...(claim ? { claim } : {}),
        });
        claim = last.claim;
        setSent(newText);
        fill(last);
      } catch (e) {
        failed = (e as Error).message;
      }
    }
    for (const [n, a] of pending.entries()) {
      setFiles((cur) => cur.map((x) => (x.id === a.id ? { ...x, state: 'reading' } : x)));
      setAi({
        at: 'working',
        label:
          pending.length > 1
            ? `Lendo os arquivos (${n + 1} de ${pending.length})`
            : `Lendo ${a.pdf ? 'o PDF' : 'a foto'}`,
        prev: last,
      });
      try {
        const { body, type } = await fileBody(a.file);
        const q = new URLSearchParams({ sessao: session, nome: a.file.name.slice(0, 100) });
        if (claim) q.set('rascunho', claim);
        last = await answer<Composed>(
          await fetch(`/api/v1/public/site/compose/file?${q}`, {
            method: 'POST',
            headers: {
              'Content-Type': type,
              Accept: 'application/json',
              'X-Comandou-Request': '1',
            },
            body,
          }),
        );
        claim = last.claim;
        fill(last);
        const kind = last.kind;
        setFiles((cur) => cur.map((x) => (x.id === a.id ? { ...x, state: 'done', kind } : x)));
      } catch (e) {
        const msg = e instanceof TypeError ? 'Sem conexão agora' : (e as Error).message;
        failed = msg;
        setFiles((cur) =>
          cur.map((x) => (x.id === a.id ? { ...x, state: 'failed', error: msg } : x)),
        );
      }
    }
    if (last) {
      setAi(failed ? { at: 'failed', message: failed, prev: last } : { at: 'done', r: last });
      onMood('joy');
      if (last.menu.stockPending && !stockAsked.current.has(`${last.claim}:${last.menu.items}`)) {
        stockAsked.current.add(`${last.claim}:${last.menu.items}`);
        void suggestStock(last.claim);
      }
    } else {
      // Sem IA agora (limite, fora do ar): segue o cadastro de sempre.
      setAi({ at: 'failed', message: failed, prev: null });
      onMood('idle');
      if (failed && /criou alguns|Muitas tentativas/.test(failed)) return;
      setOpen(true);
    }
  };

  const start = () => {
    setError(null);
    // Com a IA ligada: o que é novo vai para a IA; sem nada novo, abre o cadastro.
    if (config?.ai && hasNew && ai.at !== 'working') {
      void compose();
      return;
    }
    if (ai.at === 'working') return;
    setOpen(true);
  };

  /** No celular, o aparelho fica embaixo do formulário: rola até ele para ver a IA montando. */
  const showPhone = () => {
    const el = document.querySelector('.st-phone');
    if (!el || window.innerWidth > 900) return;
    const r = el.getBoundingClientRect();
    if (r.top > window.innerHeight * 0.6)
      el.scrollIntoView({ block: 'center', behavior: calmMotion() ? 'auto' : 'smooth' });
  };

  /**
   * Estoque sugerido pela IA para os itens que ainda não têm (uma vez por item; outra sugestão
   * do mesmo rascunho em andamento devolve `busy` e tenta de novo daqui a pouco).
   */
  const suggestStock = async (claim: string, tries = 0) => {
    setStocking((n) => n + 1);
    try {
      const r = await post<{ busy: boolean; menu: SiteMenu }>('stock', { claim });
      setSiteMenu((cur) =>
        !cur || cur.claim !== claim || r.menu.items >= cur.menu.items
          ? { claim, menu: r.menu }
          : cur,
      );
      if (r.busy && tries < 8) window.setTimeout(() => void suggestStock(claim, tries + 1), 2500);
    } catch {
      /* sem a sugestão agora: os itens entram e o estoque fica para os primeiros passos */
    } finally {
      setStocking((n) => n - 1);
    }
  };

  /** Sem IA: de onde vem o cardápio, pelo que a pessoa escreveu (link, Maps ou os itens). */
  const source = () => {
    const v = text.trim();
    if (result) return { kind: 'compose', value: v.slice(0, 6000) };
    const link = links[0];
    if (link) {
      const url = /^https?:\/\//i.test(link) ? link : `https://${link}`;
      return { kind: linkIcon(link) === MapPin ? 'maps' : 'site', value: url };
    }
    if (v.length >= 10) return { kind: 'text', value: v.slice(0, 6000) };
    return { kind: 'none', value: '' };
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    onMood('thinking');
    try {
      const doc = form.document.replace(/\D/g, '');
      const c = await post<Created>('trials', {
        restaurant: form.restaurant.trim(),
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone || null,
        document: doc || null,
        legalName: doc.length === 14 ? form.legalName.trim() || null : null,
        city: place.city,
        state: place.state,
        source: source(),
        ...(result ? { aiSite: result.claim } : {}),
        session,
        company: form.company,
      });
      setState('creating');
      setTick(0);
      setReachable(false);
      setContract(null);
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

  // Pronto: o contrato do teste é gerado e o link de assinatura aparece na tela.
  const loadContract = async () => {
    if (!created) return;
    setContract((c) => ({ url: c?.url ?? null, signed: false, reason: null, loading: true }));
    try {
      const r = await post<{ url: string | null; signed: boolean; reason: string | null }>(
        `trials/${created.token}/contract`,
        {},
      );
      setContract({ ...r, loading: false });
    } catch (e) {
      setContract({ url: null, signed: false, reason: (e as Error).message, loading: false });
    }
  };
  useEffect(() => {
    if (created && state === 'ready' && !contract) void loadContract();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created, state]);

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
    setContract(null);
  };

  const closed = config && !config.signup;
  const made = result?.site ?? null;
  const brand = {
    color: made?.brandColor ?? null,
    icon: made?.logoUrl ?? files.find((f) => f.kind === 'logo')?.preview ?? null,
    cover: made?.coverUrl ?? null,
  };
  const working = ai.at === 'working';
  const found = result
    ? [
        result.site.items > 0 &&
          `${result.site.items} ${result.site.items === 1 ? 'item' : 'itens'}${result.site.suggested ? ' de sugestão' : ''}`,
        (result.site.logoUrl || result.files.includes('logo')) && 'logo',
        result.store.address && 'endereço',
        result.legal.document && (result.legal.document.length === 14 ? 'CNPJ' : 'CPF'),
        result.store.hours > 0 && 'horário',
      ].filter((x): x is string => !!x)
    : [];

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  return (
    <>
      <div className="st-build" id="criar">
        <form
          className="st-compose"
          data-drag={drag || undefined}
          data-busy={working || undefined}
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        >
          <textarea
            ref={field}
            className="st-compose__text"
            aria-label="Conte sobre o seu restaurante"
            rows={3}
            maxLength={6000}
            placeholder={EXAMPLES[0]}
            value={text}
            disabled={!!closed}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                addFiles(e.clipboardData.files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                start();
              }
            }}
          />
          {(files.length > 0 || links.length > 0) && (
            <div className="st-compose__chips" aria-label="O que vai junto">
              {links.map((l) => {
                const Ic = linkIcon(l);
                return (
                  <span key={l} className="st-chip">
                    <Ic size={14} aria-hidden />
                    {shortLink(l)}
                  </span>
                );
              })}
              {files.map((f) => (
                <span
                  key={f.id}
                  className="st-att"
                  data-state={f.state}
                  title={f.error ?? f.file.name}
                >
                  {f.preview ? (
                    <img src={f.preview} alt="" />
                  ) : (
                    <span className="st-att__pdf">
                      <FileText size={18} aria-hidden />
                    </span>
                  )}
                  <span className="st-att__label">
                    {f.state === 'reading'
                      ? 'Lendo…'
                      : f.state === 'done'
                        ? KIND_LABEL[f.kind ?? 'other']
                        : f.state === 'failed'
                          ? 'Não li'
                          : f.pdf
                            ? 'PDF'
                            : 'Foto'}
                  </span>
                  {f.state === 'reading' ? (
                    <span className="st-att__spin">
                      <Spinner inline label="Lendo" />
                    </span>
                  ) : f.state === 'done' ? (
                    <Check size={13} className="st-att__ok" aria-hidden />
                  ) : (
                    <button
                      type="button"
                      className="st-att__x"
                      aria-label={`Tirar ${f.file.name}`}
                      onClick={() => removeFile(f.id)}
                    >
                      <X size={12} aria-hidden />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <div className="st-compose__bar">
            <input
              ref={picker}
              type="file"
              hidden
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="st-compose__attach"
              aria-label="Anexar foto ou PDF"
              title="Anexar foto ou PDF (logo, cardápio, fachada, cartão do CNPJ)"
              disabled={!!closed || files.length >= MAX_FILES || !config?.ai}
              onClick={() => picker.current?.click()}
            >
              <Paperclip size={18} aria-hidden />
            </button>
            <span className="st-compose__hint">
              {config?.ai
                ? 'Texto, links, fotos e PDF. Tudo junto ou aos poucos.'
                : 'Cole o link do site ou escreva os itens com o preço.'}
            </span>
            <Button
              type="submit"
              size="lg"
              className="st-build__go st-press"
              disabled={!!closed}
              loading={working}
            >
              {working
                ? 'Lendo'
                : config?.ai && hasNew
                  ? result
                    ? 'Mandar'
                    : 'Criar com IA'
                  : result
                    ? 'Gostei, criar'
                    : 'Criar meu restaurante'}
              {!working &&
                (config?.ai && hasNew ? (
                  result ? (
                    <Send size={16} aria-hidden />
                  ) : (
                    <Sparkles size={17} aria-hidden />
                  )
                ) : (
                  <ArrowRight size={18} aria-hidden className="st-arrow__i" />
                ))}
            </Button>
          </div>
          {drag && <div className="st-compose__drop">Solte aqui as fotos ou o PDF</div>}
        </form>
        <div className="st-build__under" aria-live="polite">
          {ai.at === 'working' ? (
            <span className="st-found st-found--ai">
              <Sparkles size={15} aria-hidden /> {ai.label}
            </span>
          ) : result ? (
            <span className="st-found st-found--ai">
              <Sparkles size={15} aria-hidden />
              {ai.at === 'failed' && ai.message ? `${ai.message} ` : ''}
              Montei {result.site.name ? <strong>{result.site.name}</strong> : 'a sua loja'}
              {found.length ? ` com ${found.join(', ')}` : ''}. Mande mais coisas ou crie.
            </span>
          ) : ai.at === 'failed' && ai.message ? (
            <span>{ai.message}</span>
          ) : closed ? (
            <span>O cadastro pelo site está fechado no momento. Fale com a gente.</span>
          ) : (
            <span>
              Ex.: o site ou o Instagram, o link do Google Maps, a foto do cardápio, o logo e o
              CNPJ.
            </span>
          )}
        </div>
      </div>

      {result && ai.at !== 'working' && !open && (
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
        contract={contract}
        onContract={() => void loadContract()}
        menu={
          config?.ai && siteMenu && result && siteMenu.claim === result.claim
            ? {
                reading: null,
                menu: siteMenu.menu,
                fromSite: true,
                pages: 0,
                stocking: stocking > 0,
                error: null,
                onFile: (f) => {
                  setOpen(false);
                  addFiles([f]);
                },
                onClear: () => setSiteMenu(null),
              }
            : null
        }
      />
    </>
  );
}

/** "11987654321" → "(11) 98765-4321". */
function maskPhone(v: string) {
  const d = v
    .replace(/\D/g, '')
    .replace(/^55(?=\d{10,11}$)/, '')
    .slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
