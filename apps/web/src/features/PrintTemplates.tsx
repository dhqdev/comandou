import {
  compileLayout,
  layoutPreset,
  PRINT_TEMPLATE_FILTERS,
  PRINT_TEMPLATE_HELP,
  PRINT_TEMPLATE_LABELS,
  PRINT_TEMPLATE_VARS,
  readLayout,
  splitLayoutPreview,
  type PrintLayout,
  type PrintTemplateKind,
} from '@comandou/shared';
import {
  ChevronDown,
  ChevronUp,
  Check,
  CodeXml,
  LayoutTemplate,
  Redo2,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Square,
  Undo2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Badge, Button, Card, Segmented, Skeleton, Spinner } from '../design-system';
import { api } from '../lib/api';
import { changedLines } from './paper-diff';
import { PaperText } from './PaperText';
import { VisualEditor, VisualStart } from './print-visual/VisualEditor';
import './print-visual/print-visual.css';

type Kind = PrintTemplateKind;
interface Template {
  kind: Kind;
  body: string | null;
  updatedAt: string | null;
  default: string;
}
interface Preview {
  text: string;
  logoUrl: string | null;
  /** Número do pedido usado na prévia (null = pedido de exemplo). */
  order: number | null;
  /** Bloco do editor visual de cada linha (prévia pedida com as marcas). */
  owners?: (string | null)[];
}
interface PreviewReply {
  text: string;
  logoUrl?: string | null;
  order?: number | null;
}
interface AiStatus {
  enabled: boolean;
  reason: string | null;
  name: string;
}
interface AiReply {
  resposta: string;
  modelo: string | null;
  aviso: string | null;
  /** Prévia do modelo novo (mesmos dados da aba Prévia), para trocar na hora. */
  previa?: PreviewReply | null;
}

type ChangeState = 'applied' | 'undone' | 'saved';
interface Change {
  before: string;
  after: string;
  state: ChangeState;
  /** A mudança não aparece no pedido da prévia (ex.: tirou o CPF e o pedido não tem CPF). */
  hidden: boolean;
  saving?: boolean;
  error?: string | null;
}
type Entry =
  | { id: number; type: 'paper'; kind: Kind }
  | { id: number; type: 'user'; kind: Kind; text: string }
  | {
      id: number;
      type: 'ai';
      kind: Kind;
      text: string;
      aviso: string | null;
      change: Change | null;
    }
  | { id: number; type: 'error'; kind: Kind; text: string; ask: string };

/** Omit que vale para cada tipo da união (o Omit comum só guarda os campos em comum). */
type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewEntry = OmitEach<Entry, 'id'>;

type Side = 'preview' | 'help';
type Mode = 'visual' | 'code';
interface History {
  past: string[];
  future: string[];
  group?: string;
  at: number;
}

const LABEL = PRINT_TEMPLATE_LABELS;
const HELP = PRINT_TEMPLATE_HELP;
const VARS = PRINT_TEMPLATE_VARS;
const FILTERS = PRINT_TEMPLATE_FILTERS;
const KINDS = Object.keys(LABEL) as Kind[];
/** Tamanho máximo do modelo (o mesmo da API). */
const TEMPLATE_MAX = 8000;
/** Espera depois da última tecla para montar a prévia (tempo real sem pedir a cada letra). */
const PREVIEW_DELAY = 350;
/** Conversa e folha da IA: largura do computador (abaixo disso, folha embaixo). */
const DOCK_WIDE = 1100;

function byKind<T>(v: T): Record<Kind, T> {
  return { receipt: v, delivery_slip: v, kitchen_ticket: v, fiscal_footer: v };
}

/** Próximo quadro da tela (com reserva onde não há requestAnimationFrame). Devolve o cancelar. */
function nextFrame(cb: () => void) {
  if (typeof requestAnimationFrame !== 'function') {
    const t = setTimeout(cb, 0);
    return () => clearTimeout(t);
  }
  const id = requestAnimationFrame(cb);
  return () => cancelAnimationFrame(id);
}

/** O papel em uma linha curta, para a escolha na conversa. */
const PAPER_HINT: Record<Kind, string> = {
  receipt: 'O cliente confere antes de pagar',
  delivery_slip: 'Vai com o motoboy',
  kitchen_ticket: 'Sai na cozinha e no bar',
  fiscal_footer: 'O fim do cupom da NFC-e',
};

/** De onde vem o pedido da prévia. */
function previewSource(kind: Kind, p: Preview) {
  if (kind === 'fiscal_footer') return 'Com uma nota de exemplo';
  if (p.order === null) return 'Com um pedido de exemplo';
  return kind === 'delivery_slip'
    ? `Com o último delivery (#${p.order})`
    : `Com o último pedido (#${p.order})`;
}

/** Na tela larga a conversa fica ao lado; na estreita, folha embaixo. */
function useWideDock() {
  const query = `(min-width: ${DOCK_WIDE}px)`;
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : true,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, [query]);
  return wide;
}

/**
 * Modelos de impressão em Liquid (a mesma ideia do Jinja): o restaurante muda o que sai na
 * conferência, na via de entrega, na comanda da cozinha e no rodapé do cupom fiscal. A prévia
 * acompanha em tempo real (o que se digita no editor e o que a IA muda, piscando as linhas que
 * mudaram). No canto da tela fica a conversa com a IA (pedido do David, 0.233; refeita na 0.274):
 * primeiro se escolhe o papel, depois se pede; a mudança aparece só na Prévia (a conversa não
 * repete o papel) e Salvar/Desfazer ficam na própria mensagem. No celular a conversa é uma folha
 * embaixo e a prévia fica à vista em cima.
 */
export function PrintTemplatesCard() {
  const areaId = useId();
  const wide = useWideDock();
  const [list, setList] = useState<Template[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKindState] = useState<Kind>('receipt');
  const [draft, setDraft] = useState<Record<Kind, string>>(byKind(''));
  const [preview, setPreview] = useState<Partial<Record<Kind, Preview>>>({});
  const [previewErr, setPreviewErr] = useState<Partial<Record<Kind, string>>>({});
  const [previewBusy, setPreviewBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: Kind; lines: number[]; key: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const [savedNote, setSavedNote] = useState<{ kind: Kind; text: string } | null>(null);
  const [side, setSide] = useState<Side>('preview');
  const [mode, setMode] = useState<Mode>('visual');
  /** Só para redesenhar quando o histórico do Desfazer muda (ele mora numa ref). */
  const [, setHistTick] = useState(0);
  // IA
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [small, setSmall] = useState(false);
  const [chatKind, setChatKind] = useState<Kind | null>(null);
  const [thread, setThread] = useState<Entry[]>([]);
  const [asking, setAsking] = useState<{ kind: Kind; since: number } | null>(null);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const chatKindRef = useRef(chatKind);
  chatKindRef.current = chatKind;
  /** Texto do modelo da última prévia pedida (ou recebida da IA), por papel. */
  const asked = useRef<Partial<Record<Kind, string>>>({});
  /** Prévias já montadas (papel + modelo): desfazer volta na hora, sem pedir de novo. */
  const cache = useRef(new Map<string, Preview>());
  const seq = useRef(0);
  const nextId = useRef(1);
  const stop = useRef<AbortController | null>(null);
  const previewBox = useRef<HTMLDivElement>(null);
  /** Blocos do editor visual por modelo (papel + texto): os mesmos blocos voltam no Desfazer. */
  const layouts = useRef(new Map<string, PrintLayout>());
  const history = useRef<Record<Kind, History>>({
    receipt: { past: [], future: [], at: 0 },
    delivery_slip: { past: [], future: [], at: 0 },
    kitchen_ticket: { past: [], future: [], at: 0 },
    fiscal_footer: { past: [], future: [], at: 0 },
  });
  const listRef = useRef(list);
  listRef.current = list;

  const keepLayout = (key: string, l: PrintLayout) => {
    layouts.current.delete(key);
    layouts.current.set(key, l);
    if (layouts.current.size > 200) layouts.current.delete(layouts.current.keys().next().value!);
  };

  /**
   * Blocos do modelo, se ele é do editor visual. O modelo padrão do Comandou abre no estilo
   * Clássico (imprime igual: o teste da API confere). `stale` = era do visual, mas mudou no código.
   */
  const layoutOf = useCallback(
    (k: Kind, body: string): { layout: PrintLayout | null; stale: PrintLayout | null } => {
      const key = `${k}\n${body}`;
      const hit = layouts.current.get(key);
      if (hit) return { layout: hit, stale: null };
      const def = listRef.current?.find((t) => t.kind === k)?.default;
      if (def !== undefined && body === def) {
        const l = layoutPreset(k, 'classico');
        keepLayout(key, l);
        return { layout: l, stale: null };
      }
      const r = readLayout(k, body);
      if (r?.exact) {
        keepLayout(key, r.layout);
        return { layout: r.layout, stale: null };
      }
      return { layout: null, stale: r?.layout ?? null };
    },
    [],
  );

  /** O que vai para a prévia: no visual, o modelo com as marcas de bloco (clicar no papel). */
  const previewBody = useCallback(
    (k: Kind, body: string) => {
      const l = layoutOf(k, body).layout;
      return l ? { body: compileLayout(k, l, true), marked: true } : { body, marked: false };
    },
    [layoutOf],
  );

  const saved = (k: Kind) => {
    const t = list?.find((x) => x.kind === k);
    return t ? (t.body ?? t.default) : '';
  };
  const dirty = (k: Kind) => !!list && draft[k] !== saved(k);
  const anyDirty = KINDS.some(dirty);

  useEffect(() => {
    api<Template[]>('/printing/templates')
      .then((r) => {
        setList(r);
        setDraft({
          ...byKind(''),
          ...(Object.fromEntries(r.map((t) => [t.kind, t.body ?? t.default])) as Record<
            Kind,
            string
          >),
        });
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const loadAi = useCallback(() => {
    setAiError(null);
    api<AiStatus>('/printing/templates/ai')
      .then(setAi)
      .catch((e: Error) => {
        setAi(null);
        setAiError(e.message);
      });
  }, []);
  useEffect(loadAi, [loadAi]);

  // Fechar a aba com mudança não salva: o navegador pergunta antes.
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  const remember = (k: Kind, body: string, p: Preview) => {
    const key = `${k}\n${body}`;
    cache.current.delete(key);
    cache.current.set(key, p);
    if (cache.current.size > 30) cache.current.delete(cache.current.keys().next().value!);
  };

  /** Troca a prévia do papel e pisca as linhas que mudaram. */
  const showPreview = useCallback((k: Kind, body: string, p: Preview, blink: boolean) => {
    const old = previewRef.current[k]?.text;
    asked.current[k] = body;
    remember(k, body, p);
    setPreview((cur) => ({ ...cur, [k]: p }));
    setPreviewErr((cur) => ({ ...cur, [k]: undefined }));
    if (blink && old !== undefined) {
      const lines = changedLines(old, p.text);
      setFlash({ kind: k, lines, key: Date.now() });
      return lines.length > 0;
    }
    return true;
  }, []);

  const fetchPreview = useCallback(
    async (k: Kind, body: string) => {
      const my = ++seq.current;
      asked.current[k] = body;
      setPreviewBusy(true);
      try {
        const sent = previewBody(k, body);
        const r = await api<PreviewReply>('/printing/templates/preview', {
          method: 'POST',
          json: { kind: k, body: sent.body },
        });
        if (my !== seq.current) return;
        const split = sent.marked ? splitLayoutPreview(r.text) : null;
        showPreview(
          k,
          body,
          {
            text: split ? split.text : r.text,
            logoUrl: r.logoUrl ?? null,
            order: r.order ?? null,
            owners: split?.owners,
          },
          false,
        );
      } catch (e) {
        if (my !== seq.current) return;
        setPreviewErr((cur) => ({ ...cur, [k]: (e as Error).message }));
      } finally {
        if (my === seq.current) setPreviewBusy(false);
      }
    },
    [showPreview, previewBody],
  );

  // Prévia em tempo real: o que muda no editor aparece no papel ao lado.
  useEffect(() => {
    if (!list) return;
    const body = draft[kind];
    if (!body.trim() || asked.current[kind] === body) return;
    const hit = cache.current.get(`${kind}\n${body}`);
    if (hit) {
      seq.current++;
      setPreviewBusy(false);
      showPreview(kind, body, hit, false);
      return;
    }
    const t = window.setTimeout(
      () => void fetchPreview(kind, body),
      previewRef.current[kind] ? PREVIEW_DELAY : 0,
    );
    return () => window.clearTimeout(t);
  }, [list, kind, draft, fetchPreview, showPreview]);

  // A linha que mudou aparece na tela (no celular, acima da folha da conversa).
  useEffect(() => {
    if (!flash) return;
    return nextFrame(() => {
      const box = previewBox.current;
      const target = box?.querySelector('[data-flash]') ?? box;
      target?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
  }, [flash]);

  // Conversa aberta: a tela abre espaço para ela (ao lado no computador, embaixo no celular).
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('tpl-ai-open', aiOpen);
    root.classList.toggle('tpl-ai-small', aiOpen && small && !wide);
    return () => root.classList.remove('tpl-ai-open', 'tpl-ai-small');
  }, [aiOpen, small, wide]);

  const push = (e: NewEntry) => {
    const entry = { ...e, id: nextId.current++ } as Entry;
    setThread((t) => [...t, entry]);
    return entry.id;
  };
  const patchChange = (id: number, up: Partial<Change>) =>
    setThread((t) =>
      t.map((e) =>
        e.id === id && e.type === 'ai' && e.change ? { ...e, change: { ...e.change, ...up } } : e,
      ),
    );

  /** Papel da conversa: muda junto o papel do editor e marca na conversa. */
  function choosePaper(k: Kind) {
    if (chatKindRef.current !== k) push({ type: 'paper', kind: k });
    setChatKind(k);
    setKindState(k);
    setSide('preview');
    setError(null);
  }

  /** Aba do editor: se a conversa já tem papel, ela acompanha. */
  function setKind(k: Kind) {
    setKindState(k);
    setError(null);
    if (chatKindRef.current && chatKindRef.current !== k) {
      push({ type: 'paper', kind: k });
      setChatKind(k);
    }
  }

  function openAi() {
    setAiOpen(true);
    setSmall(false);
    setSide('preview');
    if (!ai) loadAi();
    nextFrame(() => previewBox.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
  }

  /** Grava o modelo do papel. Devolve o erro (ou null). */
  async function persist(k: Kind): Promise<string | null> {
    const body = draftRef.current[k];
    try {
      await api(`/printing/templates/${k}`, { method: 'PUT', json: { body } });
      setList((l) =>
        l
          ? l.map((t) => (t.kind === k ? { ...t, body, updatedAt: new Date().toISOString() } : t))
          : l,
      );
      setSavedNote({ kind: k, text: 'Modelo salvo: as próximas impressões já saem assim.' });
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  async function save() {
    setBusy('save');
    setError(null);
    const err = await persist(kind);
    if (err) setError(err);
    setBusy(null);
  }

  async function reset() {
    setBusy('reset');
    setError(null);
    try {
      await api(`/printing/templates/${kind}`, { method: 'DELETE' });
      const t = list?.find((x) => x.kind === kind);
      setList((l) =>
        l ? l.map((x) => (x.kind === kind ? { ...x, body: null, updatedAt: null } : x)) : l,
      );
      if (t) {
        // O Desfazer do visual volta ao que estava antes do padrão.
        history.current[kind].past.push(draftRef.current[kind]);
        history.current[kind].future = [];
        setDraft((d) => ({ ...d, [kind]: t.default }));
      }
      setSavedNote({ kind, text: 'Voltou ao modelo padrão do Comandou.' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Mudança no editor visual: vira o modelo (Liquid) e entra no Desfazer. */
  function applyVisual(k: Kind, next: PrintLayout, group?: string) {
    const prev = draftRef.current[k];
    const body = compileLayout(k, next);
    keepLayout(`${k}\n${body}`, next);
    if (body === prev) return;
    const h = history.current[k];
    const now = Date.now();
    // Letras seguidas no mesmo campo viram um passo só do Desfazer.
    if (!(group && h.group === group && now - h.at < 1500)) {
      h.past.push(prev);
      if (h.past.length > 80) h.past.shift();
    }
    h.future = [];
    h.group = group;
    h.at = now;
    setDraft((d) => ({ ...d, [k]: body }));
    setSavedNote(null);
    setError(null);
    setHistTick((t) => t + 1);
  }

  function travel(k: Kind, back: boolean) {
    const h = history.current[k];
    const to = back ? h.past.pop() : h.future.pop();
    if (to === undefined) return;
    (back ? h.future : h.past).push(draftRef.current[k]);
    h.group = undefined;
    setDraft((d) => ({ ...d, [k]: to }));
    setSavedNote(null);
    setHistTick((t) => t + 1);
  }

  /** Põe um modelo no editor e mostra a prévia (a que veio da IA, a guardada ou pede uma nova). */
  function putModel(k: Kind, body: string, given: Preview | null) {
    setDraft((d) => ({ ...d, [k]: body }));
    setKindState(k);
    setSide('preview');
    setSavedNote(null);
    const p = given ?? cache.current.get(`${k}\n${body}`) ?? null;
    if (p) {
      seq.current++;
      setPreviewBusy(false);
      return showPreview(k, body, p, true);
    }
    return true;
  }

  async function ask(text: string, k: Kind) {
    const q = text.trim();
    if (!q || asking) return;
    const userId = push({ type: 'user', kind: k, text: q });
    const history = [...thread, { id: userId, type: 'user' as const, kind: k, text: q }]
      .filter(
        (e): e is Extract<Entry, { type: 'user' | 'ai' }> =>
          (e.type === 'user' || e.type === 'ai') && e.kind === k,
      )
      .slice(-7)
      .map((e) => ({
        role: e.type === 'user' ? ('user' as const) : ('assistant' as const),
        content: e.text,
      }));
    const body = draftRef.current[k];
    const ctrl = new AbortController();
    stop.current = ctrl;
    setAsking({ kind: k, since: Date.now() });
    try {
      const r = await api<AiReply>('/printing/templates/ai', {
        method: 'POST',
        json: { kind: k, body, messages: history },
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      const changed = !!r.modelo && r.modelo !== body;
      let shown = true;
      if (changed)
        shown = putModel(
          k,
          r.modelo!,
          r.previa
            ? {
                text: r.previa.text,
                logoUrl: r.previa.logoUrl ?? null,
                order: r.previa.order ?? null,
              }
            : null,
        );
      push({
        type: 'ai',
        kind: k,
        text: r.resposta,
        aviso: r.aviso,
        change: changed
          ? { before: body, after: r.modelo!, state: 'applied', hidden: !shown }
          : null,
      });
    } catch (e) {
      push({
        type: 'error',
        kind: k,
        text: ctrl.signal.aborted ? 'Você parou o pedido.' : (e as Error).message,
        ask: q,
      });
    } finally {
      if (stop.current === ctrl) stop.current = null;
      setAsking(null);
    }
  }

  function undo(e: Extract<Entry, { type: 'ai' }>) {
    if (!e.change) return;
    putModel(e.kind, e.change.before, null);
    patchChange(e.id, { state: 'undone', error: null });
  }
  function redo(e: Extract<Entry, { type: 'ai' }>) {
    if (!e.change) return;
    putModel(e.kind, e.change.after, null);
    patchChange(e.id, { state: 'applied', error: null });
  }
  async function saveFromChat(e: Extract<Entry, { type: 'ai' }>) {
    patchChange(e.id, { saving: true, error: null });
    const err = await persist(e.kind);
    patchChange(e.id, err ? { saving: false, error: err } : { saving: false, state: 'saved' });
  }

  const cur = list?.find((t) => t.kind === kind);
  const body = draft[kind];
  const pv = preview[kind];
  const pvErr = previewErr[kind];
  const aiName = ai?.name || 'IA';
  const lockEditor = asking?.kind === kind;
  const vis = layoutOf(kind, body);

  return (
    <Card
      searchId="secao-modelos"
      title="Modelos de impressão"
      actions={
        <Button
          variant="secondary"
          size="sm"
          icon={<Sparkles size={15} />}
          onClick={openAi}
          aria-expanded={aiOpen}
        >
          Montar com IA
        </Button>
      }
    >
      {list === null ? (
        loadError ? (
          <Alert tone="danger">{loadError}</Alert>
        ) : (
          <Skeleton variant="grid" />
        )
      ) : (
        <div className="print-tpl">
          <div className="print-tpl__top">
            <Segmented
              label="Papel"
              value={kind}
              onChange={setKind}
              options={KINDS.map((k) => ({
                value: k,
                label: LABEL[k],
                icon: dirty(k) ? (
                  <span className="print-tpl__dirty" role="img" aria-label="não salvo" />
                ) : undefined,
              }))}
            />
            <Segmented
              label="Jeito de editar"
              className="print-tpl__mode"
              value={mode}
              onChange={setMode}
              options={[
                {
                  value: 'visual',
                  label: 'Visual',
                  icon: <LayoutTemplate size={15} aria-hidden />,
                },
                { value: 'code', label: 'Código', icon: <CodeXml size={15} aria-hidden /> },
              ]}
            />
          </div>
          <p className="cm-hint print-tpl__help">
            {HELP[kind]}{' '}
            {cur?.body ? <Badge tone="brand">personalizado</Badge> : <Badge>padrão</Badge>}
          </p>
          {mode === 'visual' ? (
            <div className="print-tpl__visual" ref={previewBox}>
              {vis.layout ? (
                <VisualEditor
                  kind={kind}
                  layout={vis.layout}
                  preview={pv}
                  previewErr={pvErr}
                  busy={previewBusy}
                  source={pv ? previewSource(kind, pv) : ''}
                  locked={lockEditor}
                  canUndo={history.current[kind].past.length > 0}
                  canRedo={history.current[kind].future.length > 0}
                  onUndo={() => travel(kind, true)}
                  onRedo={() => travel(kind, false)}
                  onChange={(l, g) => applyVisual(kind, l, g)}
                />
              ) : (
                <VisualStart
                  kind={kind}
                  stale={vis.stale}
                  locked={lockEditor}
                  onLayout={(l) => applyVisual(kind, l)}
                  onCode={() => setMode('code')}
                  paper={
                    pv ? (
                      <PaperText
                        key={flash?.kind === kind ? flash.key : 0}
                        text={pv.text}
                        logoUrl={pv.logoUrl}
                        flash={flash?.kind === kind ? flash.lines : undefined}
                        className={`print-tpl__paper${pvErr ? ' is-stale' : ''}`}
                        label="Prévia do modelo"
                      />
                    ) : pvErr ? (
                      <Alert tone="danger">{pvErr}</Alert>
                    ) : (
                      <Skeleton variant="list" rows={8} label="Montando a prévia" />
                    )
                  }
                  source={pv ? previewSource(kind, pv) : 'Montando a prévia…'}
                />
              )}
            </div>
          ) : (
            <div className="print-tpl__grid">
              <div className="cm-field">
                <label className="cm-label" htmlFor={areaId}>
                  Modelo
                </label>
                <textarea
                  id={areaId}
                  className="cm-input print-tpl__area"
                  spellCheck={false}
                  rows={22}
                  maxLength={TEMPLATE_MAX}
                  value={body}
                  readOnly={lockEditor}
                  aria-busy={lockEditor || undefined}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDraft((d) => ({ ...d, [kind]: v }));
                    setSavedNote(null);
                  }}
                />
                <span className="cm-hint">
                  {lockEditor
                    ? `${aiName} está mudando este papel…`
                    : 'Use {{ variável }} para mostrar um dado e {% if %} / {% for %} para condições e listas. A bobina tem 42 colunas; a letra grande, 21. A prévia muda enquanto você digita.'}
                  {body.startsWith('{% comment %}comandou-visual') &&
                    ' O comentário do começo guarda as partes do editor visual: mudar o código tira este papel do visual (dá para voltar lá).'}
                </span>
              </div>
              <div className="print-tpl__side">
                <Segmented
                  label="Ao lado do editor"
                  value={side}
                  onChange={setSide}
                  options={[
                    { value: 'preview', label: 'Prévia' },
                    { value: 'help', label: 'O que dá para usar' },
                  ]}
                />
                {side === 'preview' ? (
                  <div className="print-tpl__preview" ref={previewBox}>
                    <div className="print-tpl__src">
                      <span className="cm-hint">
                        {pv ? previewSource(kind, pv) : 'Montando a prévia…'}
                      </span>
                      {(previewBusy || lockEditor) && (
                        <Spinner inline label="Atualizando a prévia" />
                      )}
                    </div>
                    {pvErr && <Alert tone="danger">{pvErr}</Alert>}
                    {pv ? (
                      <PaperText
                        key={flash?.kind === kind ? flash.key : 0}
                        text={pv.text}
                        logoUrl={pv.logoUrl}
                        flash={flash?.kind === kind ? flash.lines : undefined}
                        className={`print-tpl__paper${pvErr ? ' is-stale' : ''}`}
                        label="Prévia do modelo"
                      />
                    ) : pvErr ? null : (
                      <Skeleton variant="list" rows={8} label="Montando a prévia" />
                    )}
                  </div>
                ) : (
                  <>
                    <strong>O que dá para usar</strong>
                    <ul className="print-tpl__vars">
                      {VARS[kind].map(([v, d]) => (
                        <li key={v}>
                          <code>{v}</code> <span className="cm-hint">{d}</span>
                        </li>
                      ))}
                    </ul>
                    <strong>Ajudantes</strong>
                    <ul className="print-tpl__vars">
                      {FILTERS.map(([v, d]) => (
                        <li key={v}>
                          <code>{v}</code> <span className="cm-hint">{d}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}
          {body.length > TEMPLATE_MAX && (
            <Alert tone="warning">
              O papel passou do tamanho máximo do modelo. Tire algumas partes ou textos longos para
              conseguir salvar.
            </Alert>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="print-tpl__actions">
            <Button
              icon={<Save size={16} />}
              loading={busy === 'save'}
              disabled={!body.trim() || !dirty(kind) || lockEditor}
              onClick={() => void save()}
            >
              Salvar modelo
            </Button>
            {cur?.body && (
              <Button
                variant="ghost"
                icon={<RotateCcw size={16} />}
                loading={busy === 'reset'}
                disabled={lockEditor}
                onClick={() => void reset()}
              >
                Voltar ao padrão
              </Button>
            )}
            <span className="print-tpl__state" role="status">
              {dirty(kind) ? (
                <>
                  <span className="print-tpl__dirty" aria-hidden />
                  Não salvo: as impressões ainda saem com o modelo anterior.
                </>
              ) : savedNote?.kind === kind ? (
                <>
                  <Check size={15} aria-hidden /> {savedNote.text}
                </>
              ) : null}
            </span>
          </div>
        </div>
      )}
      {list !== null &&
        createPortal(
          aiOpen ? (
            <AiDock
              name={aiName}
              ai={ai}
              aiError={aiError}
              onRetryStatus={loadAi}
              editorKind={kind}
              chatKind={chatKind}
              thread={thread}
              asking={asking}
              wide={wide}
              small={small}
              onSmall={setSmall}
              onClose={() => setAiOpen(false)}
              onChoose={choosePaper}
              onAsk={(t, k) => void ask(t, k)}
              onStop={() => stop.current?.abort()}
              onUndo={undo}
              onRedo={redo}
              onSave={(e) => void saveFromChat(e)}
            />
          ) : (
            <button type="button" className="tpl-ai-fab" onClick={openAi}>
              <Sparkles size={18} aria-hidden />
              <span>Montar o papel com IA</span>
            </button>
          ),
          document.body,
        )}
    </Card>
  );
}

/** Por que a IA não abre, em palavras do dono do restaurante. */
const AI_OFF: Record<string, string> = {
  platform:
    'A IA ainda não está ligada no Comandou (falta a chave do OpenRouter dos restaurantes no painel). Fale com o suporte do Comandou.',
  tenant: 'A IA está desligada para este restaurante. Peça ao suporte do Comandou para ligar.',
  limit: 'O limite de uso da IA neste mês acabou. Fale com o suporte do Comandou.',
};

const SUGGESTIONS: Record<Kind, string[]> = {
  receipt: [
    'Coloque "Obrigado e volte sempre!" no final',
    'Tire o CPF/CNPJ do cliente',
    'Deixe o número do pedido bem grande',
  ],
  delivery_slip: [
    'Deixe o endereço e o telefone bem grandes',
    'Tire os preços dos itens',
    'Coloque "Confira seu pedido na entrega" no final',
  ],
  kitchen_ticket: [
    'Deixe os itens em letra grande',
    'Tire o nome do cliente',
    'Deixe a observação do pedido bem grande',
  ],
  fiscal_footer: [
    'Coloque a senha do Wi-Fi: cliente123',
    'Coloque nosso Instagram @minhaloja',
    'Deixe o agradecimento em letra grande',
  ],
};

/** Escolha do papel na conversa: os quatro, com uma linha do que é cada um. */
function PaperPicker({
  current,
  hint,
  onChoose,
  compact,
}: {
  current: Kind | null;
  hint: Kind;
  onChoose(k: Kind): void;
  compact?: boolean;
}) {
  return (
    <div
      className={`tpl-ai__papers${compact ? ' tpl-ai__papers--compact' : ''}`}
      role="group"
      aria-label="Papel que vai mudar"
    >
      {KINDS.map((k) => (
        <button
          key={k}
          type="button"
          className="tpl-ai__paper-opt"
          aria-pressed={current === k}
          onClick={() => onChoose(k)}
        >
          <strong>{LABEL[k]}</strong>
          {!compact && (
            <span>
              {PAPER_HINT[k]}
              {current === null && k === hint ? ' · aberto no editor' : ''}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Conversa com a IA no canto da tela (folha embaixo no celular). Uma conversa só, com o papel de
 * cada pedido marcado nela. A mudança não é desenhada aqui: ela aparece na aba Prévia, ao lado.
 */
function AiDock({
  name,
  ai,
  aiError,
  onRetryStatus,
  editorKind,
  chatKind,
  thread,
  asking,
  wide,
  small,
  onSmall,
  onClose,
  onChoose,
  onAsk,
  onStop,
  onUndo,
  onRedo,
  onSave,
}: {
  name: string;
  ai: AiStatus | null;
  aiError: string | null;
  onRetryStatus(): void;
  editorKind: Kind;
  chatKind: Kind | null;
  thread: Entry[];
  asking: { kind: Kind; since: number } | null;
  wide: boolean;
  small: boolean;
  onSmall(v: boolean): void;
  onClose(): void;
  onChoose(k: Kind): void;
  onAsk(text: string, k: Kind): void;
  onStop(): void;
  onUndo(e: Extract<Entry, { type: 'ai' }>): void;
  onRedo(e: Extract<Entry, { type: 'ai' }>): void;
  onSave(e: Extract<Entry, { type: 'ai' }>): void;
}) {
  const [text, setText] = useState('');
  const [picking, setPicking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();

  // Desce até a última fala (no começo fica a pergunta do papel à vista).
  useEffect(() => {
    const el = scroller.current;
    if (el && (thread.length || asking)) el.scrollTop = el.scrollHeight;
  }, [thread, asking, chatKind]);

  // Relógio do "mexendo no papel" (aparece depois de alguns segundos).
  useEffect(() => {
    if (!asking) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [asking]);

  useEffect(() => {
    if (chatKind && wide) input.current?.focus();
  }, [chatKind, wide]);

  const asked = chatKind ? thread.some((e) => e.type === 'user' && e.kind === chatKind) : false;
  const seconds = asking ? Math.max(0, Math.round((now - asking.since) / 1000)) : 0;

  function submit(q = text) {
    if (!chatKind || !q.trim() || asking) return;
    onAsk(q, chatKind);
    setText('');
    setPicking(false);
    // No celular o teclado fecha e a prévia (em cima da folha) aparece.
    if (!wide) input.current?.blur();
  }

  let body: ReactNode;
  if (!ai?.enabled)
    body = (
      <div className="tpl-ai-dock__off">
        {ai ? (
          <Alert tone="warning">{AI_OFF[ai.reason ?? 'platform'] ?? AI_OFF.platform}</Alert>
        ) : aiError ? (
          <>
            <Alert tone="danger">Não deu para abrir a IA agora: {aiError}</Alert>
            <Button variant="secondary" size="sm" onClick={onRetryStatus}>
              Tentar de novo
            </Button>
          </>
        ) : (
          <Skeleton variant="chat" />
        )}
      </div>
    );
  else
    body = (
      <div className="tpl-ai">
        <div className="tpl-ai__scroll" ref={scroller} aria-live="polite">
          <div className="tpl-ai__msg">
            <span className="tpl-ai__who">{name}</span>
            <p>
              Qual papel você quer mudar? Depois é só dizer o que quer: a mudança aparece na hora na
              prévia, ao lado do editor. Nada vale na impressora até você salvar.
            </p>
            {!chatKind && <PaperPicker current={null} hint={editorKind} onChoose={onChoose} />}
          </div>
          {thread.map((e) => {
            if (e.type === 'paper')
              return (
                <div key={e.id} className="tpl-ai__divider">
                  Papel: <strong>{LABEL[e.kind]}</strong>
                </div>
              );
            if (e.type === 'user')
              return (
                <div key={e.id} className="tpl-ai__msg is-mine">
                  <p>{e.text}</p>
                </div>
              );
            if (e.type === 'error')
              return (
                <div key={e.id} className="tpl-ai__msg is-error">
                  <span className="tpl-ai__who">{name}</span>
                  <p>Não deu certo: {e.text}</p>
                  <div className="tpl-ai__actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!!asking}
                      onClick={() => onAsk(e.ask, e.kind)}
                    >
                      Tentar de novo
                    </Button>
                  </div>
                </div>
              );
            const c = e.change;
            return (
              <div key={e.id} className="tpl-ai__msg">
                <span className="tpl-ai__who">{name}</span>
                <p>{e.text}</p>
                {e.aviso && <span className="tpl-ai__warn">{e.aviso}</span>}
                {c && (
                  <div className="tpl-ai__change" data-state={c.state}>
                    <span className="tpl-ai__change-what">
                      {c.state === 'undone'
                        ? 'Mudança desfeita.'
                        : c.state === 'saved'
                          ? 'Salvo: já vale na impressora.'
                          : c.hidden
                            ? `Mudou o modelo de ${LABEL[e.kind]}, mas não aparece no pedido da prévia.`
                            : `Mudou na prévia de ${LABEL[e.kind]}.`}
                    </span>
                    {c.error && <span className="tpl-ai__warn">Não salvou: {c.error}</span>}
                    <div className="tpl-ai__actions">
                      {c.state === 'applied' && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Save size={14} />}
                            loading={c.saving}
                            onClick={() => onSave(e)}
                          >
                            Salvar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Undo2 size={14} />}
                            disabled={c.saving}
                            onClick={() => onUndo(e)}
                          >
                            Desfazer
                          </Button>
                        </>
                      )}
                      {c.state === 'undone' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Redo2 size={14} />}
                          onClick={() => onRedo(e)}
                        >
                          Refazer
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {asking && (
            <div className="tpl-ai__msg">
              <span className="tpl-ai__who">{name}</span>
              <p className="tpl-ai__typing">
                <Spinner inline label="Mudando o papel" /> Mudando {LABEL[asking.kind]}…
                {seconds >= 5 ? ` ${seconds} s` : ''}
              </p>
              <div className="tpl-ai__actions">
                <Button size="sm" variant="ghost" icon={<Square size={12} />} onClick={onStop}>
                  Parar
                </Button>
              </div>
            </div>
          )}
          {chatKind && !asked && !asking && (
            <div className="tpl-ai__chips" aria-label="Ideias">
              {SUGGESTIONS[chatKind].map((s) => (
                <button key={s} type="button" className="tpl-ai__chip" onClick={() => submit(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        {chatKind && (
          <form
            className="tpl-ai__form"
            onSubmit={(ev) => {
              ev.preventDefault();
              submit();
            }}
          >
            <div className="tpl-ai__target">
              <button
                type="button"
                className="tpl-ai__target-btn"
                aria-expanded={picking}
                aria-label={`Trocar o papel (agora: ${LABEL[chatKind]})`}
                onClick={() => setPicking((v) => !v)}
              >
                Mudando: <strong>{LABEL[chatKind]}</strong>
                {picking ? (
                  <ChevronUp size={14} aria-hidden />
                ) : (
                  <ChevronDown size={14} aria-hidden />
                )}
              </button>
            </div>
            {picking && (
              <PaperPicker
                current={chatKind}
                hint={editorKind}
                compact
                onChoose={(k) => {
                  onChoose(k);
                  setPicking(false);
                }}
              />
            )}
            <div className="tpl-ai__row">
              <label className="cm-sr-only" htmlFor={inputId}>
                O que mudar no papel
              </label>
              <textarea
                id={inputId}
                ref={input}
                className="cm-input tpl-ai__input"
                rows={2}
                maxLength={1500}
                placeholder={'Ex.: coloque "Volte sempre!" no final'}
                value={text}
                onChange={(ev) => setText(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' && !ev.shiftKey) {
                    ev.preventDefault();
                    submit();
                  }
                }}
              />
              <Button
                type="submit"
                size="sm"
                icon={<Send size={14} />}
                loading={!!asking}
                disabled={!text.trim()}
                aria-label="Enviar"
              >
                Enviar
              </Button>
            </div>
          </form>
        )}
      </div>
    );

  return (
    <section
      className="tpl-ai-dock"
      role="dialog"
      aria-label={`Montar o papel com ${name}`}
      data-size={small && !wide ? 'small' : undefined}
    >
      <header className="tpl-ai-dock__head">
        <Sparkles size={18} aria-hidden className="tpl-ai-dock__icon" />
        <div className="tpl-ai-dock__title">
          <strong>Montar o papel com {name}</strong>
          <span className="cm-hint">
            {chatKind ? `Mudando: ${LABEL[chatKind]}` : 'Escolha o papel para começar'}
          </span>
        </div>
        {!wide && (
          <Button
            variant="ghost"
            size="sm"
            icon={small ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            aria-label={small ? 'Aumentar a conversa' : 'Diminuir a conversa'}
            onClick={() => onSmall(!small)}
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={<X size={16} />}
          aria-label="Fechar a conversa"
          onClick={onClose}
        />
      </header>
      {body}
    </section>
  );
}
