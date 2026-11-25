import {
  AlertCircle,
  ArrowDown,
  Camera,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  LifeBuoy,
  ImageOff,
  Paperclip,
  Play,
  ReceiptText,
  RotateCw,
  SendHorizontal,
  Smile,
  Video,
  X,
  Zap,
} from 'lucide-react';
import {
  ClipboardEvent,
  CSSProperties,
  DragEvent,
  Fragment,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { runInfo, useFreshKeys } from '../chat/bubbles';
import { avatarColors } from '../chat/util';
import {
  ChatMessage,
  ChatTicket,
  mediaFiles,
  Prepared,
  prepareFile,
  Sender,
  uploadFile,
} from './chat-media';
import { EMOJI_GROUPS, emojiCount, recentEmojis, rememberEmoji } from './emoji';
import './store-chat.css';

/* ------------------------------------------------------------------ util */

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === yest.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** Texto com links clicáveis (só http/https). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow">
            {p}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

const coarse = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/* ------------------------------------------------------------------ visualizador */

/**
 * Foto ou vídeo em tela cheia. É um <dialog> aberto com showModal(): fica na camada de cima do
 * navegador, por cima de tudo (barra do topo do tablet, menu lateral, outra janela aberta), e não
 * pode ficar preso dentro da conversa que rola.
 */
export function MediaViewer({
  item,
  onClose,
}: {
  item: { kind: 'image' | 'video'; url: string } | null;
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || !item) return;
    if (!d.open) d.showModal?.();
    return () => {
      if (d.open) d.close?.();
    };
  }, [item]);
  if (!item) return null;
  return (
    <dialog
      ref={ref}
      className="scx-viewer"
      aria-label={item.kind === 'image' ? 'Foto' : 'Vídeo'}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={onClose}
    >
      <button type="button" className="scx-viewer__close" aria-label="Fechar" onClick={onClose}>
        <X size={22} />
      </button>
      {item.kind === 'image' ? (
        <img src={item.url} alt="" onClick={(e) => e.stopPropagation()} />
      ) : (
        <video src={item.url} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
      )}
    </dialog>
  );
}

/* ------------------------------------------------------------------ mensagens */

function Media({
  m,
  onOpen,
}: {
  m: ChatMessage;
  onOpen(item: { kind: 'image' | 'video'; url: string }): void;
}) {
  const url = m.localUrl ?? m.file?.url;
  const kind = m.file?.kind ?? (m.localUrl ? (m.fileGone ?? 'image') : null);
  if (m.fileGone && !m.localUrl)
    return (
      <span className="scx-gone">
        <ImageOff size={16} /> {m.fileGone === 'video' ? 'Vídeo' : 'Foto'} apagada para liberar
        espaço
      </span>
    );
  if (!url || !kind) return null;
  const ratio =
    m.file?.width && m.file?.height
      ? `${m.file.width} / ${m.file.height}`
      : kind === 'video'
        ? '9 / 16'
        : undefined;
  if (kind === 'image')
    return (
      <button
        type="button"
        className="scx-media"
        style={{ aspectRatio: ratio }}
        onClick={() => onOpen({ kind, url })}
        aria-label="Ampliar foto"
      >
        <img src={url} alt="Foto enviada" loading="lazy" decoding="async" />
      </button>
    );
  return (
    <div className="scx-media scx-media--video">
      {/* #t=0.1: o iPhone mostra o primeiro quadro no lugar de um quadro preto. */}
      <video src={`${url}#t=0.1`} preload="metadata" playsInline muted />
      <button
        type="button"
        className="scx-media__play"
        onClick={() => onOpen({ kind, url })}
        aria-label="Assistir vídeo"
      >
        <Play size={26} fill="currentColor" />
      </button>
    </div>
  );
}

export interface ThreadProps {
  messages: ChatMessage[];
  /** De que lado está quem vê: as mensagens dele ficam à direita. */
  side: 'customer' | 'staff';
  /** Até quando o outro lado leu (risquinhos azuis). */
  otherReadAt?: string | null;
  typing?: string | null;
  hasMore?: boolean;
  onLoadMore?(): Promise<void> | void;
  greeting?: ReactNode;
  /** Nome de cada lado quando a mensagem não traz o autor (ex.: o cliente, a loja). */
  names?: { customer?: string | null; staff?: string | null };
  onOrder?(m: ChatMessage): void;
  onRetry?(m: ChatMessage): void;
  empty?: ReactNode;
  /** Toque no cartão do chamado citado numa mensagem. */
  onTicket?(t: ChatTicket): void;
  /**
   * Chave estável de cada mensagem: a enviada agora continua com a chave de quando estava indo
   * (o balão não some e volta quando o servidor responde, e o efeito de envio roda uma vez só).
   */
  keyOf?(m: ChatMessage): string;
}

type Status = 'sending' | 'failed' | 'sent' | 'read';
const STATUS_LABEL: Record<Status, string> = {
  sending: 'Enviando',
  failed: 'Não enviada',
  sent: 'Enviada',
  read: 'Lida',
};

/** Risquinhos da mensagem de quem vê: relógio indo, ✓ enviada, ✓✓ azul lida. */
export function Ticks({ status }: { status: Status }) {
  return (
    <span className="scx-status" data-state={status} data-read={status === 'read' || undefined}>
      {status === 'sending' ? (
        <Clock3 size={12} aria-hidden />
      ) : status === 'failed' ? (
        <AlertCircle size={13} aria-hidden />
      ) : status === 'read' ? (
        <CheckCheck size={15} aria-hidden />
      ) : (
        <Check size={15} aria-hidden />
      )}
      <span className="cm-sr-only">{STATUS_LABEL[status]}</span>
    </span>
  );
}

function Thread({
  messages,
  side,
  otherReadAt,
  typing,
  hasMore,
  onLoadMore,
  greeting,
  names,
  onOrder,
  onRetry,
  empty,
  onTicket,
  keyOf = (m) => m.id,
}: ThreadProps) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  // Dia das mensagens no topo, só enquanto rola (como no WhatsApp): parado, ele não fica por
  // cima do texto das mensagens.
  const [day, setDay] = useState<{ label: string; on: boolean }>({ label: '', on: false });
  const dayTimer = useRef<number | undefined>(undefined);
  // Rolagem feita pelo código (segurar no fim) ou pelo navegador quando a área mudou de tamanho:
  // não mostra o dia no topo.
  const quiet = useRef(false);
  const seenHeight = useRef(0);
  const scrollBox = (el: HTMLDivElement, top: number) => {
    const t = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight));
    if (Math.abs(el.scrollTop - t) < 1) return;
    quiet.current = true;
    el.scrollTop = t;
  };
  const [fresh, setFresh] = useState(0);
  const [viewer, setViewer] = useState<{ kind: 'image' | 'video'; url: string } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const lastId = messages.at(-1)?.id;
  const firstId = messages[0]?.id;
  const prevFirst = useRef<string | undefined>(undefined);
  const prevHeight = useRef(0);
  const atBottomRef = useRef(true);

  // Mensagem nova: desce se já estava embaixo (ou se foi quem vê que mandou).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const last = messages.at(-1);
    if (prevFirst.current && firstId !== prevFirst.current && prevHeight.current) {
      // Carregou mensagens antigas no topo: mantém o lugar da leitura.
      scrollBox(el, el.scrollHeight - prevHeight.current + el.scrollTop);
    } else if (atBottom || !last || last.sender === side) {
      scrollBox(el, el.scrollHeight);
      setFresh(0);
    } else {
      setFresh((n) => n + 1);
    }
    prevFirst.current = firstId;
    prevHeight.current = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, firstId, messages.length]);

  useLayoutEffect(() => {
    if (typing && atBottom && box.current) scrollBox(box.current, box.current.scrollHeight);
  }, [typing, atBottom]);

  // A conversa fica presa embaixo quando algo muda de tamanho: fotos carregando (o conteúdo
  // cresce) ou a área da conversa encolhendo porque o teclado, os emojis, a prévia da foto ou o
  // campo de várias linhas subiram. Sem isso as últimas mensagens sumiam atrás do que subiu.
  // Lendo mais para cima, o que estava no pé da tela continua no mesmo lugar.
  useEffect(() => {
    const el = box.current;
    const content = inner.current;
    if (!el || !content || typeof ResizeObserver === 'undefined') return;
    let boxH = el.clientHeight;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      if (atBottomRef.current) scrollBox(el, el.scrollHeight);
      else if (h !== boxH) scrollBox(el, el.scrollTop + boxH - h);
      boxH = h;
      prevHeight.current = el.scrollHeight;
    });
    ro.observe(content);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => window.clearTimeout(dayTimer.current), []);

  /** Mostra o dia da mensagem que está no topo e esconde logo depois que a rolagem para. */
  function showDay(el: HTMLDivElement) {
    let label = '';
    for (const d of el.querySelectorAll<HTMLElement>('.scx-thread__inner > .scx-day')) {
      if (d.offsetTop >= el.scrollTop + 4) break;
      label = d.textContent ?? '';
    }
    // Mesmo dia na tela: não redesenha a conversa a cada quadro da rolagem.
    setDay((d) => (d.label === label && d.on === !!label ? d : { label, on: !!label }));
    window.clearTimeout(dayTimer.current);
    dayTimer.current = window.setTimeout(() => setDay((d) => ({ ...d, on: false })), 900);
  }

  async function onScroll() {
    const el = box.current!;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    atBottomRef.current = bottom;
    const resized = el.clientHeight !== seenHeight.current;
    seenHeight.current = el.clientHeight;
    if (quiet.current || resized) quiet.current = false;
    else showDay(el);
    if (bottom !== atBottom) setAtBottom(bottom);
    if (bottom) setFresh(0);
    if (el.scrollTop < 80 && hasMore && onLoadMore && !loadingMore) {
      setLoadingMore(true);
      prevHeight.current = el.scrollHeight;
      try {
        await onLoadMore();
      } finally {
        setLoadingMore(false);
      }
    }
  }

  const toBottom = () => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' });
    setFresh(0);
  };

  const keys = messages.map(keyOf);
  // Só a mensagem que acabou de chegar (ou de sair) entra com efeito; as da carga não.
  const arrived = useFreshKeys(keys, true, side);
  const runs = runInfo(
    messages.map((m) => ({
      author: m.sender === 'system' ? null : `${m.sender}:${m.authorName ?? ''}`,
      at: m.createdAt,
      system: m.sender === 'system',
    })),
  );
  // Mais de uma pessoa escrevendo pelo mesmo lado (dois atendentes, dono e gerente): o nome de
  // quem escreveu aparece no balão, como num grupo. Uma pessoa só de cada lado: sem nomes.
  const authors = { customer: new Set<string>(), staff: new Set<string>() };
  for (const m of messages)
    if (m.sender !== 'system' && m.authorName) authors[m.sender].add(m.authorName);
  return (
    <div className="scx-thread" ref={box} onScroll={onScroll} aria-live="polite">
      <div className="scx-float" data-on={day.on || undefined} aria-hidden>
        <span className="scx-day">{day.label}</span>
      </div>
      <div className="scx-thread__inner" ref={inner}>
        {hasMore && (
          <div className="scx-more">{loadingMore ? 'Carregando…' : 'Role para ver mais'}</div>
        )}
        {greeting && !hasMore && <div className="scx-greeting">{greeting}</div>}
        {!messages.length && empty}
        {messages.map((m, i) => {
          const run = runs[i]!;
          const key = keys[i]!;
          const isNew = arrived.has(key);
          if (m.sender === 'system')
            return (
              <Fragment key={key}>
                {run.newDay && <div className="scx-day">{dayLabel(m.createdAt)}</div>}
                <div className="scx-system" data-fresh={isNew || undefined}>
                  {m.body}
                </div>
              </Fragment>
            );
          const mine = m.sender === side;
          const hasMedia = !!(m.file || m.localUrl || m.fileGone);
          const big = !hasMedia && !m.orderNumber && !m.ticket ? emojiCount(m.body) : 0;
          const status: Status | null = !mine
            ? null
            : m.pending === 'failed'
              ? 'failed'
              : m.pending
                ? 'sending'
                : otherReadAt && m.createdAt <= otherReadAt
                  ? 'read'
                  : 'sent';
          const who =
            m.authorName ||
            names?.[m.sender as 'customer' | 'staff'] ||
            (mine ? 'Você' : m.sender === 'customer' ? 'Cliente' : 'Equipe');
          const showName = run.first && authors[m.sender].size > 1;
          const [nameBg, nameFg] = avatarColors(`${m.sender}:${who}`);
          const meta = (
            <span className="scx-meta">
              <time dateTime={m.createdAt}>{hhmm(m.createdAt)}</time>
              {status && <Ticks status={status} />}
            </span>
          );
          return (
            <Fragment key={key}>
              {run.newDay && <div className="scx-day">{dayLabel(m.createdAt)}</div>}
              <div
                className="scx-msg"
                data-mine={mine || undefined}
                data-first={run.first || undefined}
                data-pending={m.pending}
                data-emoji={big || undefined}
                data-fresh={isNew || undefined}
              >
                <div
                  className="scx-bubble"
                  data-media={hasMedia && !m.body ? 'solo' : hasMedia ? 'caption' : undefined}
                >
                  {showName && (
                    <span
                      className="scx-who"
                      style={{ '--who-fg': nameFg, '--who-bg': nameBg } as CSSProperties}
                    >
                      {who}
                    </span>
                  )}
                  {hasMedia && <Media m={m} onOpen={setViewer} />}
                  {m.orderNumber && (
                    <button
                      type="button"
                      className="scx-order"
                      onClick={() => onOrder?.(m)}
                      disabled={!onOrder}
                    >
                      <ReceiptText size={15} /> Pedido #{m.orderNumber}
                    </button>
                  )}
                  {m.ticket && (
                    <TicketCard
                      t={m.ticket}
                      onOpen={onTicket && !m.pending ? () => onTicket(m.ticket!) : undefined}
                    />
                  )}
                  {m.body ? (
                    <p className="scx-text">
                      <Linkified text={m.body} />
                      {/* Lugar da hora no fim da última linha (a hora fica por cima dele). */}
                      {!big && <span className="scx-meta-gap" aria-hidden />}
                    </p>
                  ) : null}
                  {meta}
                </div>
                {m.pending === 'failed' && (
                  <button type="button" className="scx-retry" onClick={() => onRetry?.(m)}>
                    <RotateCw size={13} /> Não foi. Tentar de novo
                  </button>
                )}
              </div>
            </Fragment>
          );
        })}
        {typing && (
          <div className="scx-msg scx-typing" aria-label={typing} data-first>
            <div className="scx-bubble">
              <span className="scx-typing__dots" aria-hidden>
                <span />
                <span />
                <span />
              </span>
            </div>
            <span className="scx-typing__label">{typing}</span>
          </div>
        )}
      </div>
      {!atBottom && (
        <button type="button" className="scx-down" onClick={toBottom} aria-label="Ir para o fim">
          <ArrowDown size={18} />
          {fresh > 0 && <span className="scx-down__n">{fresh}</span>}
        </button>
      )}
      <MediaViewer item={viewer} onClose={() => setViewer(null)} />
    </div>
  );
}

/** Cartão do chamado dentro da mensagem: número, título e em que pé está. */
function TicketCard({ t, onOpen }: { t: ChatTicket; onOpen?(): void }) {
  const inner = (
    <>
      <LifeBuoy size={18} className="scx-ticket__icon" aria-hidden />
      <span className="scx-ticket__text">
        <small>
          Chamado {t.code}
          {t.statusLabel && (
            <span className="scx-ticket__status" data-done={t.done || undefined}>
              {t.statusLabel}
            </span>
          )}
        </small>
        <strong>{t.title}</strong>
      </span>
      {onOpen && <ChevronRight size={16} className="scx-ticket__go" aria-hidden />}
    </>
  );
  return onOpen ? (
    <button type="button" className="scx-ticket" onClick={onOpen} title="Abrir o chamado">
      {inner}
    </button>
  ) : (
    <div className="scx-ticket">{inner}</div>
  );
}

/* ------------------------------------------------------------------ emojis */

/**
 * Seletor de emojis: recentes primeiro e os grupos em abas. O mesmo do chat da equipe, do
 * suporte, dos clientes e do cardápio.
 */
export function EmojiPanel({ onPick }: { onPick(e: string): void }) {
  const recent = recentEmojis();
  const groups = recent.length
    ? [{ id: 'recentes', label: 'Recentes', icon: '🕘', list: recent }, ...EMOJI_GROUPS]
    : EMOJI_GROUPS;
  const [tab, setTab] = useState(groups[0]!.id);
  const g = groups.find((x) => x.id === tab) ?? groups[0]!;
  return (
    <div className="scx-emoji" role="dialog" aria-label="Emojis">
      <div className="scx-emoji__tabs" role="tablist">
        {groups.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={x.id === g.id}
            title={x.label}
            aria-label={x.label}
            onClick={() => setTab(x.id)}
          >
            {x.icon}
          </button>
        ))}
      </div>
      <div className="scx-emoji__grid" key={g.id}>
        {g.list.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => {
              rememberEmoji(e);
              onPick(e);
            }}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ campo de mensagem */

export interface SendInput {
  body: string;
  fileId?: string | null;
  orderNumber?: number | null;
  ticketId?: string | null;
}

export interface ChatPaneProps extends Omit<ThreadProps, 'onRetry'> {
  /** Envia a mensagem (o arquivo já subiu) e devolve a mensagem salva. */
  send(input: SendInput): Promise<ChatMessage>;
  /** Caminho da API para subir foto/vídeo. */
  uploadPath: string;
  onTyping?(): void;
  disabled?: boolean;
  disabledHint?: ReactNode;
  placeholder?: string;
  /** Respostas prontas (equipe). */
  quickReplies?: string[];
  /** Pedido que vai junto da próxima mensagem. */
  orderNumber?: number | null;
  onClearOrder?(): void;
  /** Chamados que dá para citar pelo clipe (conversa com a Comandou). */
  tickets?: ChatTicket[];
  /** Chamado que já vem citado na próxima mensagem. */
  initialTicket?: ChatTicket | null;
  /** Texto que já vem no campo. */
  initialText?: string;
  onSent?(m: ChatMessage): void;
  onError?(message: string): void;
  autoFocus?: boolean;
}

let localSeq = 0;

/** Conversa completa: mensagens, emojis, foto/vídeo (arrastar, colar ou câmera) e envio. */
export function ChatPane(props: ChatPaneProps) {
  const {
    send,
    uploadPath,
    onTyping,
    disabled,
    disabledHint,
    placeholder = 'Escreva uma mensagem',
    quickReplies,
    orderNumber,
    onClearOrder,
    tickets,
    initialTicket = null,
    initialText = '',
    onSent,
    onError,
    autoFocus,
    ...thread
  } = props;
  const [text, setText] = useState(initialText);
  const [file, setFile] = useState<Prepared | null>(null);
  const [ticket, setTicket] = useState<ChatTicket | null>(initialTicket);
  useEffect(() => {
    if (initialTicket) setTicket(initialTicket);
  }, [initialTicket]);
  const [preparing, setPreparing] = useState(false);
  const [pending, setPending] = useState<
    (ChatMessage & { input: SendInput; prepared?: Prepared })[]
  >([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [panel, setPanel] = useState<null | 'emoji' | 'attach' | 'quick' | 'ticket'>(null);
  const [drag, setDrag] = useState(false);
  // Mensagem enviada: a chave da tela continua a de quando ela estava indo (`local-N`), então o
  // balão fica no lugar quando o servidor responde (sem piscar nem repetir o efeito de envio).
  const sentKeys = useRef(new Map<string, string>());
  // Cada envio faz o aviãozinho do botão sair e voltar (o ícone nasce de novo).
  const [flights, setFlights] = useState(0);
  // Mensagens mandadas em seguida chegam ao servidor na ordem em que foram escritas: a foto sobe
  // ao mesmo tempo, mas cada mensagem espera a de antes ser salva (ou falhar) para ser gravada.
  const order = useRef<Promise<void>>(Promise.resolve());
  const input = useRef<HTMLTextAreaElement>(null);
  const compose = useRef<HTMLDivElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  useEffect(() => {
    if (initialText) setText(initialText);
  }, [initialText]);

  // Campo cresce com o texto (até ~6 linhas).
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [text]);

  useEffect(() => {
    if (autoFocus && !coarse()) input.current?.focus();
  }, [autoFocus]);

  /** Item do menu do clipe: fecha o menu e abre a galeria ou a câmera. */
  const choose = (el: { current: HTMLInputElement | null }) => {
    setPanel(null);
    el.current?.click();
  };

  // Menu, emojis ou respostas prontas abertos: tocar na conversa (fora do campo) fecha.
  useEffect(() => {
    if (!panel) return;
    const onDown = (e: PointerEvent) => {
      if (!compose.current?.contains(e.target as Node)) setPanel(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [panel]);

  // Libera as prévias locais quando saem da tela.
  useEffect(
    () => () => {
      if (file) URL.revokeObjectURL(file.previewUrl);
    },
    [file],
  );

  const pick = useCallback(
    async (f: File | undefined) => {
      if (!f) return;
      setPanel(null);
      setPreparing(true);
      try {
        setFile(await prepareFile(f));
      } catch (e) {
        onError?.((e as Error).message);
      } finally {
        setPreparing(false);
      }
    },
    [onError],
  );

  async function deliver(id: string, inputData: SendInput, prepared?: Prepared) {
    setPending((p) => p.map((m) => (m.id === id ? { ...m, pending: 'sending' } : m)));
    const turn = order.current;
    let done = () => {};
    order.current = new Promise<void>((r) => (done = r));
    try {
      let fileId = inputData.fileId ?? null;
      if (prepared && !fileId) {
        const up = await uploadFile(uploadPath, prepared, (f) =>
          setProgress((p) => ({ ...p, [id]: f })),
        );
        fileId = up.id;
        // Se o envio da mensagem falhar, tenta de novo sem subir o arquivo outra vez.
        setPending((p) =>
          p.map((m) => (m.id === id ? { ...m, input: { ...m.input, fileId } } : m)),
        );
      }
      await turn;
      const saved = await send({ ...inputData, fileId });
      sentKeys.current.set(saved.id, id);
      setPending((p) => p.filter((m) => m.id !== id));
      if (prepared) setTimeout(() => URL.revokeObjectURL(prepared.previewUrl), 30_000);
      onSent?.(saved);
    } catch (e) {
      setPending((p) => p.map((m) => (m.id === id ? { ...m, pending: 'failed' } : m)));
      onError?.((e as Error).message);
    } finally {
      done();
      setProgress((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
    }
  }

  function submit() {
    const typingNow = document.activeElement === input.current;
    const body = text.trim();
    if (disabled || (!body && !file && !orderNumber && !ticket)) return;
    const id = `local-${++localSeq}`;
    const inputData: SendInput = {
      body,
      orderNumber: orderNumber ?? null,
      ticketId: ticket?.id ?? null,
    };
    const prepared = file ?? undefined;
    setPending((p) => [
      ...p,
      {
        id,
        sender: thread.side,
        authorName: null,
        body,
        file: null,
        fileGone: prepared ? prepared.kind : null,
        localUrl: prepared?.previewUrl,
        orderNumber: orderNumber ?? null,
        orderId: null,
        ticket,
        createdAt: new Date().toISOString(),
        pending: 'sending',
        input: inputData,
        prepared,
      },
    ]);
    setText('');
    setFile(null);
    setTicket(null);
    setPanel(null);
    setFlights((n) => n + 1);
    onClearOrder?.();
    void deliver(id, inputData, prepared);
    // Quem estava digitando continua digitando (no celular, o teclado não fecha).
    if (!coarse() || typingNow) input.current?.focus({ preventScroll: true });
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Computador: Enter envia, Shift+Enter quebra a linha. Celular: Enter quebra a linha.
    if (e.key === 'Enter' && !e.shiftKey && !coarse() && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function changed(v: string) {
    setText(v);
    const now = Date.now();
    if (v && onTyping && now - lastTyping.current > 2500) {
      lastTyping.current = now;
      onTyping();
    }
  }

  function insert(s: string) {
    const el = input.current;
    if (!el) return setText((t) => t + s);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + s + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + s.length;
      if (!coarse()) el.focus();
    });
  }

  function onPaste(e: ClipboardEvent) {
    const files = mediaFiles(e.clipboardData?.items);
    if (files.length) {
      e.preventDefault();
      void pick(files[0]);
    }
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (disabled) return;
    void pick(mediaFiles(e.dataTransfer?.files)[0]);
  }

  const shown: ChatMessage[] = [
    ...thread.messages,
    ...pending.map((p) => ({ ...p, body: p.body })),
  ];
  const canSend = !disabled && !preparing && (!!text.trim() || !!file || !!orderNumber || !!ticket);

  return (
    <div
      className="scx"
      data-drag={drag || undefined}
      onDragOver={(e) => {
        if (disabled || !Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDrag(false);
      }}
      onDrop={onDrop}
    >
      <Thread
        {...thread}
        messages={shown}
        keyOf={(m) => sentKeys.current.get(m.id) ?? m.id}
        onRetry={(m) => {
          const p = pending.find((x) => x.id === m.id);
          if (p) void deliver(p.id, p.input, p.prepared);
        }}
      />
      {Object.keys(progress).length > 0 && (
        <div className="scx-progress" role="progressbar" aria-label="Enviando arquivo">
          <span
            style={{
              width: `${Math.round(
                (Object.values(progress).reduce((a, b) => a + b, 0) /
                  Object.values(progress).length) *
                  100,
              )}%`,
            }}
          />
        </div>
      )}
      {drag && <div className="scx-drop">Solte a foto ou o vídeo para enviar</div>}

      <div className="scx-compose" ref={compose}>
        {disabled && disabledHint ? (
          <div className="scx-compose__off">{disabledHint}</div>
        ) : (
          <>
            {(file || preparing || orderNumber || ticket) && (
              <div className="scx-attach">
                {preparing && <span className="scx-attach__busy">Preparando arquivo…</span>}
                {file && (
                  <div className="scx-attach__file">
                    {file.kind === 'image' ? (
                      <img src={file.previewUrl} alt="Prévia" />
                    ) : (
                      <video src={file.previewUrl} muted playsInline preload="metadata" />
                    )}
                    <span>
                      {file.kind === 'image' ? 'Foto' : 'Vídeo'} ·{' '}
                      {(file.blob.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB
                      <small>Escreva uma legenda, se quiser</small>
                    </span>
                    <button type="button" aria-label="Tirar arquivo" onClick={() => setFile(null)}>
                      <X size={16} />
                    </button>
                  </div>
                )}
                {orderNumber && (
                  <div className="scx-attach__order">
                    <ReceiptText size={15} /> Sobre o pedido #{orderNumber}
                    {onClearOrder && (
                      <button type="button" aria-label="Não citar o pedido" onClick={onClearOrder}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                )}
                {ticket && (
                  <div className="scx-attach__order">
                    <LifeBuoy size={15} />
                    <span className="scx-attach__label">Sobre o chamado {ticket.code}</span>
                    <span className="scx-attach__title">{ticket.title}</span>
                    <button
                      type="button"
                      aria-label="Não citar o chamado"
                      onClick={() => setTicket(null)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
            {panel === 'emoji' && <EmojiPanel onPick={insert} />}
            {panel === 'quick' && quickReplies && (
              <div className="scx-quick" role="menu">
                {quickReplies.map((q) => (
                  <button
                    key={q}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setText(q);
                      setPanel(null);
                      requestAnimationFrame(() => input.current?.focus());
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div className="scx-compose__row">
              {/* O menu do clipe flutua acima dele, sem empurrar a conversa para cima. */}
              <div className="scx-anchor">
                <button
                  type="button"
                  className="scx-icon"
                  data-on={panel === 'attach' || undefined}
                  aria-label="Enviar foto ou vídeo"
                  aria-haspopup="menu"
                  aria-expanded={panel === 'attach'}
                  title="Foto ou vídeo"
                  onClick={() => setPanel((p) => (p === 'attach' ? null : 'attach'))}
                >
                  <Paperclip size={20} />
                </button>
                {panel === 'attach' && (
                  <div className="scx-menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => choose(gallery)}>
                      <Paperclip size={18} /> Foto ou vídeo da galeria
                    </button>
                    <button type="button" role="menuitem" onClick={() => choose(photo)}>
                      <Camera size={18} /> Tirar foto
                    </button>
                    <button type="button" role="menuitem" onClick={() => choose(video)}>
                      <Video size={18} /> Gravar vídeo
                    </button>
                    {tickets && (
                      <button type="button" role="menuitem" onClick={() => setPanel('ticket')}>
                        <LifeBuoy size={18} /> Um chamado
                      </button>
                    )}
                  </div>
                )}
                {panel === 'ticket' && tickets && (
                  <div className="scx-menu scx-menu--tickets" role="menu" aria-label="Chamados">
                    {tickets.length === 0 ? (
                      <p className="scx-menu__empty">
                        Nenhum chamado ainda. Abra um em Sistema › Chamados.
                      </p>
                    ) : (
                      tickets.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setTicket(t);
                            setPanel(null);
                            requestAnimationFrame(() => input.current?.focus());
                          }}
                        >
                          <LifeBuoy size={18} />
                          <span className="scx-menu__ticket">
                            <strong>{t.title}</strong>
                            <small>
                              {t.code}
                              {t.statusLabel ? ` · ${t.statusLabel}` : ''}
                            </small>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {quickReplies && quickReplies.length > 0 && (
                <button
                  type="button"
                  className="scx-icon"
                  data-on={panel === 'quick' || undefined}
                  aria-label="Respostas prontas"
                  title="Respostas prontas"
                  onClick={() => setPanel((p) => (p === 'quick' ? null : 'quick'))}
                >
                  <Zap size={19} />
                </button>
              )}
              <div className="scx-field">
                <textarea
                  ref={input}
                  rows={1}
                  value={text}
                  maxLength={2000}
                  placeholder={placeholder}
                  aria-label="Mensagem"
                  enterKeyHint={coarse() ? 'enter' : 'send'}
                  onChange={(e) => changed(e.target.value)}
                  onKeyDown={onKey}
                  onPaste={onPaste}
                  onFocus={() => panel === 'emoji' && coarse() && setPanel(null)}
                />
                <button
                  type="button"
                  className="scx-icon scx-icon--in"
                  data-on={panel === 'emoji' || undefined}
                  aria-label="Emojis"
                  title="Emojis"
                  onClick={() => {
                    setPanel((p) => (p === 'emoji' ? null : 'emoji'));
                    if (coarse()) input.current?.blur();
                  }}
                >
                  <Smile size={20} />
                </button>
              </div>
              <button
                type="button"
                className="scx-send"
                aria-label="Enviar"
                title="Enviar (Enter)"
                disabled={!canSend}
                // Tocar em Enviar não tira o foco do campo: o teclado do celular fica aberto
                // (antes ele fechava a cada envio e a conversa pulava para cima e voltava).
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={submit}
              >
                <SendHorizontal
                  key={flights}
                  size={20}
                  className="scx-send__icon"
                  data-fly={flights > 0 || undefined}
                  aria-hidden
                />
              </button>
            </div>
            <input
              ref={gallery}
              type="file"
              hidden
              accept="image/*,video/mp4,video/quicktime,video/webm,.mov,.mp4"
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <input
              ref={photo}
              type="file"
              hidden
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <input
              ref={video}
              type="file"
              hidden
              accept="video/*"
              capture="environment"
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** Junta mensagens novas às que já estão na tela (sem repetir) e mantém a ordem. */
export function mergeMessages(list: ChatMessage[], add: ChatMessage[]): ChatMessage[] {
  const map = new Map(list.map((m) => [m.id, m]));
  for (const m of add) map.set(m.id, m);
  return [...map.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
  );
}

export type { ChatMessage, Sender };
