import {
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  FileSignature,
  FileText,
  Paperclip,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Mascot, Spinner, TextField } from '../../design-system';
import type { StorePreviewData } from '../../lib/store-preview';
import '../../features/onboarding/onboarding.css';
import { goTo } from '../fx';
import { loadSiteConfig, type SiteConfig } from '../host';
import { parseItems, slugPreview } from '../site-data';
import {
  composeFile,
  FILE_ACCEPT,
  fromBr,
  isPdf,
  linksOf,
  logoColors,
  maskDocument,
  maskPhone,
  MAX_FILES,
  post,
  shortLink,
  siteSession,
  smallLogo,
  toBr,
  type Composed,
  type ContractState,
  type Created,
} from './create-api';
import { takeHandoff } from './handoff';
import { countItems, MenuEditor, missingPrice, newKey, type EditCat } from './MenuEditor';
import { StorePreview } from './StorePreview';
import './create.css';

/**
 * Criar o restaurante em forma de conversa, desde o começo (0.282, pedido do David: "desde o
 * inicial seja esse chat com a IA e ela vá perguntando o que é cada coisa, para quando criar o
 * domínio já conseguir acessar com tudo pronto"). É a mesma conversa dos Primeiros passos do
 * sistema, mas antes do cadastro: a pessoa manda o que tiver (link, cardápio em foto ou PDF,
 * logo, CNPJ), a IA lê tudo e a conversa confirma cada coisa (nome, cardápio, logo e cores, como
 * vende, WhatsApp, endereço, tempo de preparo). Ao lado, o cardápio de verdade montando. No fim, os
 * dados de login: o restaurante nasce e o combinado vai junto; no primeiro acesso o sistema aplica
 * tudo sozinho, sem perguntar de novo. Página própria (não janela): clicar fora não perde nada.
 */

type Step =
  | 'intro'
  | 'name'
  | 'menu'
  | 'more'
  | 'brand'
  | 'sell'
  | 'whats'
  | 'address'
  | 'eta'
  | 'owner'
  | 'creating'
  | 'ready'
  | 'failed';
const ORDER: Step[] = [
  'intro',
  'name',
  'menu',
  'brand',
  'sell',
  'whats',
  'address',
  'eta',
  'owner',
  'creating',
  'ready',
];

interface Msg {
  id: number;
  from: 'bot' | 'me';
  text: string;
  files?: string[];
}
interface Mark {
  step: Step;
  end: number;
}

const ETAS: [number, number][] = [
  [15, 30],
  [30, 45],
  [45, 60],
  [60, 90],
];
const SELL = [
  { key: 'delivery', label: 'Entrega' },
  { key: 'pickup', label: 'Retirada no balcão' },
  { key: 'tables', label: 'Mesas no salão' },
] as const;
type SellKey = (typeof SELL)[number]['key'];

const BUILD_STEPS = [
  'Reservando o seu endereço',
  'Montando cardápio, PDV, cozinha e caixa',
  'Criando o seu login',
  'Abrindo as portas',
];

const STORE_KEY = 'cm:trial';
const EMAIL = /^\S+@\S+\.\S+$/;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Owner {
  name: string;
  email: string;
  document: string;
  legalName: string;
  company: string;
}

/** O cardápio da IA vira a lista editável (com a foto que ela achou e o estoque sugerido). */
function catsFrom(r: Composed): EditCat[] {
  return r.menu.categories
    .filter((c) => c.items.length)
    .map((c) => ({
      key: newKey('c'),
      name: c.name,
      items: c.items.map((i) => ({
        key: newKey('i'),
        name: i.name,
        description: i.description ?? '',
        price: toBr(i.price),
        imageUrl: i.imageUrl ?? null,
        ...(i.stock !== undefined ? { stock: i.stock } : {}),
      })),
    }));
}

const nameKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Página nova do mesmo cardápio depois de a pessoa mexer: só entra o que ainda não está. */
function mergeCats(cur: EditCat[], next: EditCat[]): EditCat[] {
  const out = cur.map((c) => ({ ...c, items: [...c.items] }));
  const seen = new Set(out.flatMap((c) => c.items.map((i) => nameKey(i.name))));
  for (const c of next) {
    let into = out.find((x) => nameKey(x.name) === nameKey(c.name));
    for (const it of c.items) {
      if (seen.has(nameKey(it.name))) continue;
      if (!into) {
        into = { ...c, items: [] };
        out.push(into);
      }
      into.items.push(it);
      seen.add(nameKey(it.name));
    }
  }
  return out;
}

export function CreatePage() {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [log, setLog] = useState<Msg[]>([]);
  const [step, setStep] = useState<Step>('intro');
  const [typing, setTyping] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [trail, setTrail] = useState<Mark[]>([]);
  const [session] = useState(siteSession);
  const [result, setResult] = useState<Composed | null>(null);
  // O que a conversa já combinou.
  const [name, setName] = useState('');
  const [cats, setCats] = useState<EditCat[]>([]);
  const [brand, setBrand] = useState<{
    logo: string | null;
    /** Logo trocado aqui (vai junto da criação); o da IA fica no rascunho. */
    own: boolean;
    color: string;
    accent: string;
  }>({ logo: null, own: false, color: '#e23a00', accent: '#f2b705' });
  const [sell, setSell] = useState<Set<SellKey>>(new Set(['delivery', 'pickup']));
  const [whats, setWhats] = useState('');
  const [address, setAddress] = useState('');
  const [eta, setEta] = useState<[number, number] | null>(null);
  const [owner, setOwner] = useState<Owner>({
    name: '',
    email: '',
    document: '',
    legalName: '',
    company: '',
  });
  const [place, setPlace] = useState<{ city: string | null; state: string | null }>({
    city: null,
    state: null,
  });
  // O que a pessoa já mexeu (a leitura nova da IA não passa por cima).
  const touched = useRef({ name: false, menu: false, brand: false, whats: false, address: false });
  // Campo de mandar coisas (texto e arquivos).
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [firstText, setFirstText] = useState('');
  const [answer, setAnswer] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Criação.
  const [created, setCreated] = useState<Created | null>(null);
  const [state, setState] = useState<'creating' | 'ready' | 'failed' | 'slow'>('creating');
  const [tick, setTick] = useState(0);
  const [reachable, setReachable] = useState(false);
  const [contract, setContract] = useState<ContractState | null>(null);
  const [copied, setCopied] = useState(false);

  const seq = useRef(0);
  const logLen = useRef(0);
  const timers = useRef<number[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const logoPicker = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const push = useCallback((from: Msg['from'], t: string, f?: string[]) => {
    logLen.current++;
    setLog((cur) => [...cur, { id: ++seq.current, from, text: t, ...(f ? { files: f } : {}) }]);
  }, []);

  /** O mascote fala as frases em sequência e libera a resposta do passo. */
  const say = useCallback(
    (lines: string[], next: Step) => {
      const gap = reduced() ? 0 : 480;
      setTyping(true);
      lines.forEach((line, i) =>
        timers.current.push(
          window.setTimeout(
            () => {
              push('bot', line);
              if (i === lines.length - 1) {
                const at = logLen.current;
                setTyping(false);
                setStep(next);
                setTrail((t) => [...t, { step: next, end: at }]);
              }
            },
            gap * (i + 1),
          ),
        ),
      );
    },
    [push],
  );

  // Título da página e a configuração do site (IA ligada, dias de teste).
  useEffect(() => {
    document.title = 'Criar meu restaurante · Comandou';
    void loadSiteConfig().then(setConfig);
    window.scrollTo(0, 0);
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  // Acompanha o fim da conversa.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: reduced() ? 'auto' : 'smooth' });
  }, [log.length, typing, step, reading]);

  // Sair da página no meio perde a conversa: o navegador pergunta antes.
  const dirty = log.length > 2 && !created;
  useEffect(() => {
    if (!dirty) return;
    const on = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, [dirty]);

  // ---------------------------------------------------------------- leitura pela IA

  /** O que a IA achou entra no combinado (sem passar por cima do que a pessoa já mexeu). */
  const fill = (r: Composed) => {
    setResult(r);
    const t = touched.current;
    if (!t.name && r.site.name) setName(r.site.name);
    const next = catsFrom(r);
    if (next.length) setCats((cur) => (t.menu && cur.length ? mergeCats(cur, next) : next));
    if (!t.brand)
      setBrand((b) => ({
        ...b,
        logo: b.own ? b.logo : (r.site.logoUrl ?? b.logo),
        color: r.site.brandColor ?? b.color,
        accent: r.site.accentColor ?? b.accent,
      }));
    if (!t.whats && r.store.whatsapp) setWhats(maskPhone(r.store.whatsapp));
    if (!t.address && r.store.address) setAddress(r.store.address);
    setPlace({ city: r.store.city, state: r.store.state });
    setOwner((o) => ({
      ...o,
      document: o.document || maskDocument(r.legal.document ?? ''),
      legalName: o.legalName || r.legal.legalName || '',
    }));
  };

  /** Estoque sugerido pela IA (o sistema usa para começar o controle de estoque). */
  const suggestStock = async (claim: string, tries = 0): Promise<void> => {
    try {
      const r = await post<{ busy: boolean; menu: Composed['menu'] }>('stock', { claim });
      const byName = new Map<string, { qty: number; min: number } | null>();
      for (const c of r.menu.categories)
        for (const i of c.items) if (i.stock !== undefined) byName.set(nameKey(i.name), i.stock);
      setCats((cur) =>
        cur.map((c) => ({
          ...c,
          items: c.items.map((i) =>
            i.stock === undefined && byName.has(nameKey(i.name))
              ? { ...i, stock: byName.get(nameKey(i.name)) }
              : i,
          ),
        })),
      );
      if (r.busy && tries < 8) window.setTimeout(() => void suggestStock(claim, tries + 1), 2500);
    } catch {
      /* sem sugestão agora: o estoque fica para depois */
    }
  };

  /** Manda o texto e os arquivos para a IA, um de cada vez, e soma no rascunho. */
  const send = async (t: string, list: File[]): Promise<Composed | null> => {
    let claim = result?.claim;
    let last: Composed | null = null;
    let failed: string | null = null;
    if (t.trim()) {
      setReading(
        linksOf(t).length ? 'Abrindo os links e lendo o texto' : 'Lendo o que você escreveu',
      );
      try {
        last = await post<Composed>('compose', {
          text: t.trim().slice(0, 6000),
          session,
          ...(claim ? { claim } : {}),
        });
        claim = last.claim;
        fill(last);
      } catch (e) {
        failed = (e as Error).message;
      }
    }
    for (const [n, f] of list.entries()) {
      setReading(
        list.length > 1
          ? `Lendo os arquivos (${n + 1} de ${list.length})`
          : isPdf(f)
            ? 'Lendo o PDF página por página'
            : 'Lendo a foto',
      );
      try {
        last = await composeFile(f, { session, claim });
        claim = last.claim;
        fill(last);
      } catch (e) {
        failed = e instanceof TypeError ? 'Sem conexão agora' : (e as Error).message;
      }
    }
    setReading(null);
    if (last?.menu.stockPending) void suggestStock(last.claim);
    if (failed) setError(failed);
    return last ?? result;
  };

  /** Primeira mensagem (ou "mandar mais"): lê e segue para o próximo passo que falta. */
  const sendParts = async (t: string, list: File[], back: Step | null) => {
    push('me', t.trim() || (list.length === 1 ? 'Mandei um arquivo' : 'Mandei os arquivos'), [
      ...list.map((f) => f.name),
    ]);
    if (!firstText && t.trim()) setFirstText(t.trim());
    setText('');
    setFiles([]);
    setError(null);
    if (!config?.ai) {
      // Sem IA no site: os itens escritos com o preço (um por linha) entram no cardápio.
      const typed = parseItems(t, 200).filter((i) => i.price);
      if (typed.length) {
        touched.current.menu = true;
        setCats((cur) =>
          mergeCats(cur, [
            {
              key: newKey('c'),
              name: 'Cardápio',
              items: typed.map((i) => ({
                key: newKey('i'),
                name: i.name,
                description: '',
                price: i.price ?? '',
                imageUrl: null,
              })),
            },
          ]),
        );
      }
      if (back === 'menu')
        return say(
          typed.length
            ? [`Anotei ${typed.length} ${typed.length === 1 ? 'item' : 'itens'}. Confira:`]
            : ['Não achei itens com preço. Escreva um por linha, assim: X-Burger 28,90'],
          typed.length ? 'menu' : 'more',
        );
      return askName(null);
    }
    const r = await send(t, list);
    if (back === 'menu') return askMenu(r, true);
    const got = r
      ? [
          r.menu.items > 0 &&
            `${r.menu.items} ${r.menu.items === 1 ? 'item' : 'itens'} em ${r.menu.categories.length} ${r.menu.categories.length === 1 ? 'categoria' : 'categorias'}`,
          r.site.logoUrl && 'o logo',
          r.store.address && 'o endereço',
          r.store.whatsapp && 'o WhatsApp',
          r.legal.document && (r.legal.document.length === 14 ? 'o CNPJ' : 'o CPF'),
        ].filter((x): x is string => !!x)
      : [];
    askName(r, got.length ? `Pronto, li tudo! Achei ${got.join(', ')}.` : undefined);
  };

  // Chegou da página inicial com o campo preenchido: já começa lendo.
  useEffect(() => {
    if (started.current || !config) return;
    started.current = true;
    // Voltou para a página com o restaurante recém-criado: mostra o login de novo.
    try {
      const saved = sessionStorage.getItem(STORE_KEY);
      if (saved) {
        setCreated(JSON.parse(saved) as Created);
        setStep('creating');
        return;
      }
    } catch {
      /* sem armazenamento */
    }
    const h = takeHandoff();
    const hello = [
      'Oi! Eu sou o Comandou. 🐼',
      'Vou montar o seu restaurante com você agora. Quando ele for criado, já abre pronto para vender: cardápio, logo, cores e tudo mais.',
    ];
    // Sem IA no site, só o texto (os itens com preço) entra; arquivos ficam para o sistema.
    if (h && (config.ai || h.text.trim())) {
      say(hello, 'intro');
      const list = config.ai ? h.files.slice(0, MAX_FILES) : [];
      timers.current.push(window.setTimeout(() => void sendParts(h.text, list, null), 1100));
      return;
    }
    say(
      [
        ...hello,
        config.ai
          ? 'Me manda o que você tiver: o link do site, Instagram ou Google Maps, a foto ou o PDF do cardápio, o logo e o CNPJ. Pode ser tudo junto.'
          : 'Para começar: como o seu restaurante se chama?',
      ],
      config.ai ? 'intro' : 'name',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // ---------------------------------------------------------------- perguntas

  const askName = (r: Composed | null, lead?: string) => {
    const found = touched.current.name ? name : (r?.site.name ?? name);
    if (found) return say([...(lead ? [lead] : []), `O nome do restaurante é "${found}"?`], 'name');
    say([...(lead ? [lead] : []), 'Como o seu restaurante se chama?'], 'name');
  };

  const askMenu = (r: Composed | null, again = false) => {
    // O estado do cardápio ainda não atualizou nesta chamada: conta pelo que a IA devolveu.
    const n = touched.current.menu
      ? countItems(cats) + (r ? countItems(catsFrom(r)) : 0)
      : r
        ? r.menu.items
        : countItems(cats);
    if (n)
      return say(
        again
          ? ['Somei ao cardápio. Confira ao lado e aqui embaixo:']
          : [
              `Montei o seu cardápio com ${n} ${n === 1 ? 'item' : 'itens'}. Ele já aparece ao lado, do jeito que o cliente vai ver.`,
              'Confira os nomes e os preços e mude o que quiser. Pode tirar, pôr item e mudar a descrição.',
            ],
        'menu',
      );
    say(
      [
        config?.ai
          ? 'Ainda não tenho o seu cardápio. Me manda a foto ou o PDF dele, ou escreva os itens com o preço (um por linha).'
          : 'Escreva os itens do cardápio com o preço, um por linha (ex.: X-Burger 28,90).',
      ],
      'more',
    );
  };

  const askBrand = () =>
    say(
      [
        brand.logo
          ? 'Agora a cara da loja. Esse é o seu logo? E as cores, combinam?'
          : 'Agora a cara da loja: mande o seu logo (se tiver) e escolha as cores.',
      ],
      'brand',
    );
  const askSell = () => say(['Como você vende? Pode marcar mais de um.'], 'sell');
  const askWhats = () =>
    say(
      [
        whats
          ? `O WhatsApp da loja é ${whats}? Ele aparece para o cliente no cardápio.`
          : 'Qual é o WhatsApp da loja? Ele aparece para o cliente no cardápio.',
      ],
      'whats',
    );
  const askAddress = () =>
    say(
      [address ? `A loja fica em "${address}"?` : 'E o endereço da loja? Rua, número e bairro.'],
      'address',
    );
  const askEta = () =>
    sell.has('delivery') || sell.has('pickup')
      ? say(['Quanto tempo leva, em média, para um pedido ficar pronto?'], 'eta')
      : askOwner();
  const askOwner = () =>
    say(
      [
        'Ficou ótimo! Por último, os seus dados para o login.',
        `O e-mail recebe a senha${config?.trialDays ? ` e o teste vale ${config.trialDays} dias, sem cartão` : ''}.`,
      ],
      'owner',
    );

  // ---------------------------------------------------------------- respostas

  const answerName = (v: string) => {
    const t = v.trim().replace(/\s+/g, ' ');
    if (t.length < 2) return;
    touched.current.name = true;
    setName(t.slice(0, 80));
    setAnswer('');
    push('me', t);
    askMenu(result);
  };
  const confirmName = () => {
    push('me', 'Sim, é esse');
    askMenu(result);
  };
  const menuDone = () => {
    const n = countItems(cats);
    const off = missingPrice(cats);
    push(
      'me',
      n ? `Cardápio conferido (${n} ${n === 1 ? 'item' : 'itens'})` : 'Monto o cardápio depois',
    );
    if (off)
      push(
        'bot',
        `${off === 1 ? '1 item ficou' : `${off} itens ficaram`} sem preço: ${off === 1 ? 'ele entra' : 'eles entram'} quando você colocar o preço no sistema.`,
      );
    askBrand();
  };
  const brandDone = () => {
    push('me', brand.logo ? 'O logo e as cores estão certos' : 'As cores estão certas');
    askSell();
  };
  const sellDone = () => {
    push(
      'me',
      SELL.filter((s) => sell.has(s.key))
        .map((s) => s.label)
        .join(', '),
    );
    askWhats();
  };
  const whatsDone = (v: string | null) => {
    touched.current.whats = true;
    if (v !== null) setWhats(v);
    setAnswer('');
    push('me', v === null ? 'Depois eu coloco' : v || whats);
    askAddress();
  };
  const addressDone = (v: string | null) => {
    touched.current.address = true;
    if (v !== null) setAddress(v);
    setAnswer('');
    push('me', v === null ? 'Depois eu coloco' : v || address);
    askEta();
  };
  const etaDone = (e: [number, number]) => {
    setEta(e);
    push('me', `${e[0]} a ${e[1]} minutos`);
    askOwner();
  };

  /** Volta um passo: a conversa volta ao ponto da pergunta e as respostas ficam guardadas. */
  const back = () => {
    if (trail.length < 2 || typing || reading || busy) return;
    const rest = trail.slice(0, -1);
    const prev = rest[rest.length - 1]!;
    logLen.current = prev.end;
    setTrail(rest);
    setLog((cur) => cur.slice(0, prev.end));
    setStep(prev.step);
    setAnswer('');
  };

  // ---------------------------------------------------------------- criar

  const ownerIssues = {
    name: owner.name.trim().length >= 2 ? null : 'Escreva o seu nome.',
    email: EMAIL.test(owner.email.trim()) ? null : 'Confira o e-mail: falta alguma parte.',
    document: [0, 11, 14].includes(owner.document.replace(/\D/g, '').length)
      ? null
      : 'CPF tem 11 números e CNPJ tem 14.',
  };
  const show = (k: keyof typeof ownerIssues) => (tried ? (ownerIssues[k] ?? undefined) : undefined);

  const create = async () => {
    setTried(true);
    if (ownerIssues.name || ownerIssues.email || ownerIssues.document || busy) return;
    setBusy(true);
    setError(null);
    try {
      const doc = owner.document.replace(/\D/g, '');
      const phone = whats.replace(/\D/g, '');
      const c = await post<Created>('trials', {
        restaurant: (name.trim() || 'Meu restaurante').slice(0, 80),
        name: owner.name.trim(),
        email: owner.email.trim(),
        phone: phone.length >= 10 ? phone : null,
        document: doc || null,
        legalName: doc.length === 14 ? owner.legalName.trim() || null : null,
        city: place.city,
        state: place.state,
        source: firstText
          ? { kind: 'compose', value: firstText.slice(0, 6000) }
          : { kind: 'none', value: '' },
        ...(result ? { aiSite: result.claim } : {}),
        session,
        setup: {
          categories: cats
            .map((c) => ({
              name: c.name.trim() || 'Cardápio',
              items: c.items
                .filter((i) => i.name.trim())
                .map((i) => ({
                  name: i.name.trim().slice(0, 120),
                  description: i.description.trim().slice(0, 400) || null,
                  price: fromBr(i.price),
                  ...(i.stock !== undefined ? { stock: i.stock } : {}),
                })),
            }))
            .filter((c) => c.items.length),
          store: {
            brandColor: brand.color,
            accentColor: brand.accent,
            logoUrl: brand.own ? brand.logo : null,
            whatsapp: phone.length >= 10 ? phone : null,
            address: address.trim() || null,
          },
          sell: {
            delivery: sell.has('delivery'),
            pickup: sell.has('pickup'),
            tables: sell.has('tables'),
          },
          eta: eta ? { min: eta[0], max: eta[1] } : null,
        },
        company: owner.company,
      });
      push('me', 'Criar meu restaurante');
      setState('creating');
      setTick(0);
      setReachable(false);
      setContract(null);
      setCreated(c);
      setStep('creating');
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify(c));
      } catch {
        /* sem armazenamento: o login segue na tela e no e-mail */
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Acompanha a criação e depois confere se o endereço novo já responde.
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
        if (r.status === 404) return setState('ready');
        const s = (await r.json()) as { state: 'creating' | 'ready' | 'failed' };
        if (!alive) return;
        if (s.state === 'ready') return setState('ready');
        if (s.state === 'failed') {
          setState('failed');
          try {
            sessionStorage.removeItem(STORE_KEY);
          } catch {
            /* segue */
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
  }, [created]);

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
      const img = new Image();
      img.onload = () => alive && setReachable(true);
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
      /* os dados estão na tela */
    }
  };

  // ---------------------------------------------------------------- prévia

  const preview: StorePreviewData | null = useMemo(() => {
    if (!name && !cats.length && !result) return null;
    return {
      name: name || 'Seu restaurante',
      about: result?.site.tagline ?? result?.site.about ?? null,
      address: address || null,
      whatsapp: whats || null,
      logoUrl: brand.logo,
      coverUrl: result?.site.coverUrl ?? null,
      brandColor: brand.color,
      accentColor: brand.accent,
      delivery: sell.has('delivery'),
      pickup: sell.has('pickup'),
      etaMin: eta?.[0] ?? 30,
      etaMax: eta?.[1] ?? 45,
      categories: cats.map((c) => ({
        name: c.name,
        items: c.items
          .filter((i) => i.name.trim())
          .map((i) => ({
            name: i.name,
            description: i.description || null,
            price: fromBr(i.price) ?? '',
            imageUrl: i.imageUrl,
          })),
      })),
    };
  }, [name, cats, result, address, whats, brand, sell, eta]);

  // ---------------------------------------------------------------- tela

  const base = window.location.host.replace(/^www\./, '');
  const slug = created?.slug ?? slugPreview(name);
  const at = typing || reading ? null : step;
  const progress =
    step === 'more'
      ? ORDER.indexOf('menu')
      : step === 'failed'
        ? ORDER.indexOf('creating')
        : Math.max(0, ORDER.indexOf(step));
  const phase =
    created && state === 'ready' ? 'ready' : created && state === 'failed' ? 'failed' : null;

  const composer = (hint: string, onSend: () => void, extra?: ReactNode) => (
    <form
      className="stc-compose"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() || files.length) onSend();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const list = [...e.dataTransfer.files].filter(
          (f) => isPdf(f) || f.type.startsWith('image/'),
        );
        if (list.length) setFiles((cur) => [...cur, ...list].slice(0, MAX_FILES));
      }}
    >
      {files.length > 0 && (
        <div className="stc-compose__files">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="stc-file">
              <FileText size={14} aria-hidden /> {f.name.slice(0, 28)}
              <button
                type="button"
                aria-label={`Tirar ${f.name}`}
                onClick={() => setFiles((cur) => cur.filter((_, k) => k !== i))}
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        className="stc-compose__text"
        aria-label="Mensagem"
        rows={2}
        maxLength={6000}
        autoFocus
        placeholder={hint}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          if (e.clipboardData.files.length) {
            e.preventDefault();
            setFiles((cur) => [...cur, ...e.clipboardData.files].slice(0, MAX_FILES));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && (text.trim() || files.length)) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      <div className="stc-compose__bar">
        <input
          ref={picker}
          type="file"
          hidden
          multiple
          accept={FILE_ACCEPT}
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            if (list.length) setFiles((cur) => [...cur, ...list].slice(0, MAX_FILES));
            e.target.value = '';
          }}
        />
        {config?.ai && (
          <button
            type="button"
            className="stc-compose__attach"
            onClick={() => picker.current?.click()}
            disabled={files.length >= MAX_FILES}
          >
            <Paperclip size={17} aria-hidden /> Foto ou PDF
          </button>
        )}
        {linksOf(text).map((l) => (
          <span key={l} className="stc-link">
            {shortLink(l)}
          </span>
        ))}
        {extra}
        <button
          type="submit"
          className="onb-send"
          aria-label="Enviar"
          disabled={!text.trim() && !files.length}
        >
          <ArrowUp size={16} aria-hidden />
        </button>
      </div>
    </form>
  );

  const input = (
    placeholder: string,
    done: (v: string | null) => void,
    o: { tel?: boolean; value: string },
  ) => (
    <form
      className="onb-input"
      onSubmit={(e) => {
        e.preventDefault();
        done(answer.trim() || o.value);
      }}
    >
      <input
        autoFocus
        type={o.tel ? 'tel' : 'text'}
        inputMode={o.tel ? 'tel' : undefined}
        aria-label={placeholder}
        placeholder={o.value || placeholder}
        value={answer}
        maxLength={o.tel ? 20 : 300}
        onChange={(e) => setAnswer(o.tel ? maskPhone(e.target.value) : e.target.value)}
      />
      <button type="button" className="onb-skip" onClick={() => done(null)}>
        Depois
      </button>
      <button
        type="submit"
        className="onb-send"
        aria-label="Enviar"
        disabled={!answer.trim() && !o.value}
      >
        <ArrowUp size={16} aria-hidden />
      </button>
    </form>
  );

  let reply: ReactNode = null;
  if (at === 'intro')
    reply = composer(
      'Cole o link, escreva o cardápio ou anexe a foto ou o PDF…',
      () => void sendParts(text, files, null),
      <button
        type="button"
        className="onb-skip"
        onClick={() => {
          push('me', 'Prefiro ir respondendo');
          askName(null);
        }}
      >
        Não tenho agora
      </button>,
    );
  else if (at === 'more')
    reply = composer(
      'Anexe a foto ou o PDF, ou escreva os itens com o preço…',
      () => void sendParts(text, files, 'menu'),
      <button
        type="button"
        className="onb-skip"
        onClick={() => (countItems(cats) ? askMenu(result) : menuDone())}
      >
        {countItems(cats) ? 'Voltar ao cardápio' : 'Monto depois'}
      </button>,
    );
  else if (at === 'name')
    reply = (
      <>
        {name && !answer && (
          <div className="onb-choices stc-confirm">
            <Button onClick={confirmName}>Sim, é esse</Button>
          </div>
        )}
        <form
          className="onb-input"
          onSubmit={(e) => {
            e.preventDefault();
            answerName(answer);
          }}
        >
          <input
            autoFocus
            aria-label="Nome do restaurante"
            placeholder={name ? 'Ou escreva outro nome' : 'Nome do restaurante'}
            value={answer}
            maxLength={80}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <button
            type="submit"
            className="onb-send"
            aria-label="Enviar"
            disabled={answer.trim().length < 2}
          >
            <ArrowUp size={16} aria-hidden />
          </button>
        </form>
      </>
    );
  else if (at === 'menu')
    reply = (
      <div className="onb-choices">
        <Button onClick={menuDone}>Está certo, continuar</Button>
        {config?.ai && (
          <Button
            variant="secondary"
            icon={<Paperclip size={15} />}
            onClick={() => say(['Pode mandar: eu leio e somo ao cardápio.'], 'more')}
          >
            Mandar mais páginas
          </Button>
        )}
      </div>
    );
  else if (at === 'brand')
    reply = (
      <div className="onb-choices">
        <Button onClick={brandDone}>Está certo</Button>
      </div>
    );
  else if (at === 'sell')
    reply = (
      <div className="onb-choices">
        {SELL.map((s) => (
          <button
            key={s.key}
            type="button"
            className="onb-chip"
            aria-pressed={sell.has(s.key)}
            onClick={() =>
              setSell((cur) => {
                const n = new Set(cur);
                if (!n.delete(s.key)) n.add(s.key);
                return n;
              })
            }
          >
            {sell.has(s.key) && <Check size={14} aria-hidden />}
            {s.label}
          </button>
        ))}
        <Button disabled={sell.size === 0} onClick={sellDone}>
          Continuar
        </Button>
      </div>
    );
  else if (at === 'whats')
    reply = (
      <>
        {whats && !answer && (
          <div className="onb-choices stc-confirm">
            <Button onClick={() => whatsDone(whats)}>Sim, é esse</Button>
          </div>
        )}
        {input('(11) 99999-9999', whatsDone, { tel: true, value: whats })}
      </>
    );
  else if (at === 'address')
    reply = (
      <>
        {address && !answer && (
          <div className="onb-choices stc-confirm">
            <Button onClick={() => addressDone(address)}>Sim, é aí</Button>
          </div>
        )}
        {input('Rua, número e bairro', addressDone, { value: address })}
      </>
    );
  else if (at === 'eta')
    reply = (
      <div className="onb-choices">
        {ETAS.map((e) => (
          <button
            key={e[0]}
            type="button"
            className="onb-chip"
            aria-pressed={eta?.[0] === e[0]}
            onClick={() => etaDone(e)}
          >
            {e[0]} a {e[1]} min
          </button>
        ))}
      </div>
    );

  return (
    <div className="stc">
      <header className="stc-head">
        <button
          type="button"
          className="onb-back"
          aria-label="Voltar ao passo anterior"
          hidden={trail.length < 2 || !!created}
          disabled={!!typing || !!reading || busy}
          onClick={back}
        >
          <ArrowLeft size={16} aria-hidden />
          Voltar
        </button>
        <a
          className="stc-brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            if (dirty && !window.confirm('Sair agora? A conversa ainda não virou restaurante.'))
              return;
            goTo('/');
          }}
        >
          <Mascot size={32} badge />
          <span>
            <strong>Comandou</strong>
            <small>Criando o seu restaurante</small>
          </span>
        </a>
        {slug && (
          <span className="stc-addr" title="O endereço do seu restaurante">
            <b>{slug}</b>.{base}
          </span>
        )}
        <div className="onb-progress" aria-hidden>
          <i style={{ width: `${Math.round((progress / (ORDER.length - 1)) * 100)}%` }} />
        </div>
      </header>

      <div className="stc-body">
        <main className="stc-chat">
          <div className="onb-thread stc-thread" aria-live="polite">
            {log.map((m, i) => (
              <div key={m.id} className={`onb-msg onb-msg--${m.from}`}>
                {m.from === 'bot' &&
                  (log[i - 1]?.from === 'bot' ? (
                    <span className="onb-msg__gap" />
                  ) : (
                    <Mascot size={36} badge className="onb-msg__avatar" />
                  ))}
                <p>
                  {m.text}
                  {m.files?.length ? (
                    <span className="stc-msg-files">
                      {m.files.map((f) => (
                        <span key={f}>
                          <FileText size={13} aria-hidden /> {f.slice(0, 32)}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </p>
              </div>
            ))}

            {/* Cartões que ficam na conversa enquanto o passo está aberto. */}
            {at === 'menu' && cats.length > 0 && (
              <div className="onb-card stc-card">
                <MenuEditor
                  cats={cats}
                  onChange={(c) => {
                    touched.current.menu = true;
                    setCats(c);
                  }}
                />
              </div>
            )}

            {at === 'brand' && (
              <div className="onb-card stc-card stc-brandcard">
                <button
                  type="button"
                  className="stc-logo"
                  onClick={() => logoPicker.current?.click()}
                  aria-label={brand.logo ? 'Trocar o logo' : 'Mandar o logo'}
                >
                  {brand.logo ? (
                    <img src={brand.logo} alt="Logo" />
                  ) : (
                    <Upload size={22} aria-hidden />
                  )}
                  <small>{brand.logo ? 'Trocar' : 'Mandar logo'}</small>
                </button>
                <input
                  ref={logoPicker}
                  type="file"
                  hidden
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    try {
                      const logo = await smallLogo(f);
                      const [a, b] = await logoColors(logo).catch(() => [] as string[]);
                      touched.current.brand = true;
                      setBrand((cur) => ({
                        logo,
                        own: true,
                        color: a ?? cur.color,
                        accent: b && b !== a ? b : cur.accent,
                      }));
                    } catch {
                      setError('Não consegui abrir essa imagem. Tente um PNG ou JPG.');
                    }
                  }}
                />
                <div className="stc-colors">
                  {(
                    [
                      ['color', 'Principal'],
                      ['accent', 'Destaque'],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k} className="stc-color">
                      <input
                        type="color"
                        value={brand[k]}
                        aria-label={`Cor ${label.toLowerCase()}`}
                        onChange={(e) => {
                          touched.current.brand = true;
                          setBrand((b) => ({ ...b, [k]: e.target.value }));
                        }}
                      />
                      <span>
                        <strong>{label}</strong>
                        <small>{brand[k]}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {at === 'owner' && (
              <form
                className="onb-card stc-card stc-owner"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                {error && <Alert tone="danger">{error}</Alert>}
                <TextField
                  label="Seu nome"
                  name="name"
                  autoComplete="name"
                  autoFocus
                  maxLength={120}
                  value={owner.name}
                  error={show('name')}
                  onChange={(e) => setOwner({ ...owner, name: e.target.value })}
                />
                <TextField
                  label="E-mail"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  hint="O login e a senha chegam aqui."
                  maxLength={254}
                  value={owner.email}
                  error={show('email')}
                  onChange={(e) => setOwner({ ...owner, email: e.target.value })}
                />
                <TextField
                  label="CNPJ ou CPF"
                  name="document"
                  inputMode="numeric"
                  maxLength={18}
                  hint="Para o contrato do teste, que você assina pelo celular."
                  value={owner.document}
                  error={show('document')}
                  onChange={(e) => setOwner({ ...owner, document: maskDocument(e.target.value) })}
                />
                {owner.document.replace(/\D/g, '').length === 14 && (
                  <TextField
                    label="Razão social"
                    name="legalName"
                    autoComplete="organization"
                    maxLength={160}
                    value={owner.legalName}
                    onChange={(e) => setOwner({ ...owner, legalName: e.target.value })}
                  />
                )}
                {/* Campo que gente não vê nem preenche; robô preenche e o cadastro é recusado. */}
                <input
                  className="st-hp"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden
                  value={owner.company}
                  onChange={(e) => setOwner({ ...owner, company: e.target.value })}
                />
                <p className="stc-owner__addr">
                  Seu endereço: <b>{slug || 'seu-restaurante'}</b>.{base}
                </p>
                <Button type="submit" size="lg" block loading={busy}>
                  Criar meu restaurante
                </Button>
              </form>
            )}

            {created && !phase && (
              <div className="onb-card stc-card">
                <strong className="stc-card__title">Criando {name || 'o seu restaurante'}</strong>
                <ol className="stc-build" aria-live="polite">
                  {BUILD_STEPS.map((s, i) => {
                    const now = Math.min(BUILD_STEPS.length - 1, Math.floor(tick / 2));
                    return (
                      <li key={s} className={i < now ? 'is-done' : i === now ? 'is-now' : ''}>
                        <span>
                          {i < now ? (
                            <Check size={13} strokeWidth={3} />
                          ) : i === now ? (
                            <Spinner inline label="" />
                          ) : null}
                        </span>
                        {s}
                      </li>
                    );
                  })}
                  {state === 'slow' && (
                    <li className="stc-build__slow">
                      Está demorando mais que o normal. Pode fechar: o login chega no seu e-mail.
                    </li>
                  )}
                </ol>
              </div>
            )}

            {phase === 'ready' && created && (
              <div className="onb-card stc-card stc-ready">
                <strong className="stc-card__title">
                  🎉 {name || 'Seu restaurante'} está no ar!
                </strong>
                <p>
                  {created.emailOn
                    ? `Mandei o login para ${created.email}.`
                    : 'Guarde esses dados: eles aparecem só agora.'}{' '}
                  Ao entrar, eu já deixo o cardápio, o logo, as cores e tudo o que combinamos
                  aplicados.
                </p>
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
                {contract && (
                  <div className="st-contract" data-signed={contract.signed || undefined}>
                    <FileSignature size={22} aria-hidden className="st-contract__ic" />
                    <div className="st-contract__text">
                      <strong>
                        {contract.signed
                          ? 'Contrato assinado'
                          : contract.url
                            ? 'Seu contrato está pronto'
                            : contract.loading
                              ? 'Gerando o contrato'
                              : 'Contrato do teste'}
                      </strong>
                      <span>
                        {contract.signed
                          ? 'Recebemos a sua assinatura. A via final chega por e-mail.'
                          : contract.url
                            ? 'Leia e assine pelo celular ou computador. Leva um minuto.'
                            : contract.loading
                              ? 'Gerando o contrato…'
                              : (contract.reason ?? 'O contrato chega por e-mail.')}
                      </span>
                    </div>
                    {contract.url && !contract.signed && (
                      <a
                        className="cm-btn cm-btn--secondary"
                        href={contract.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Assinar contrato
                      </a>
                    )}
                  </div>
                )}
                <div className="stc-ready__foot">
                  <Button variant="secondary" icon={<Copy size={15} />} onClick={() => void copy()}>
                    {copied ? 'Copiado' : 'Copiar login'}
                  </Button>
                  <Button size="lg" onClick={enter} loading={!reachable}>
                    {reachable ? 'Abrir meu restaurante' : 'Preparando o endereço'}
                  </Button>
                </div>
              </div>
            )}

            {phase === 'failed' && (
              <div className="onb-card stc-card">
                <Alert tone="danger">
                  Não consegui criar o restaurante agora. Tente de novo em alguns minutos ou fale
                  com a gente.
                </Alert>
                <Button
                  onClick={() => {
                    setCreated(null);
                    setState('creating');
                    setStep('owner');
                  }}
                >
                  Tentar de novo
                </Button>
              </div>
            )}

            {(typing || reading) && (
              <div className="onb-msg onb-msg--bot" aria-label="Comandou está escrevendo">
                {log[log.length - 1]?.from === 'bot' ? (
                  <span className="onb-msg__gap" />
                ) : (
                  <Mascot size={36} badge className="onb-msg__avatar" />
                )}
                {reading ? (
                  <p className="stc-reading">
                    <Spinner inline label="" /> {reading}…
                  </p>
                ) : (
                  <p className="onb-typing">
                    <i />
                    <i />
                    <i />
                  </p>
                )}
              </div>
            )}
            {error && at !== 'owner' && (
              <p className="stc-error" role="alert">
                {error}
              </p>
            )}
            <div ref={end} className="stc-end" />
          </div>
          {reply && <footer className="onb-reply stc-reply">{reply}</footer>}
        </main>
        <StorePreview
          data={preview}
          hint={
            countItems(cats)
              ? 'Toque nos itens: é o cardápio de verdade. O que você muda na conversa aparece aqui.'
              : 'O cardápio aparece aqui quando eu ler os itens.'
          }
        />
      </div>
    </div>
  );
}
