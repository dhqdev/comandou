import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  MessageCircle,
  Phone,
  ReceiptText,
  RotateCcw,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useCan } from '../../app/auth';
import { cachedBranding, useToast, Skeleton } from '../../design-system';
import { api } from '../../lib/api';
import { useRealtime } from '../../lib/realtime';
import { playSound } from '../../lib/sounds';
import { OrderDetailModal } from '../OrderDetailModal';
import { SidePanel } from '../SidePanel';
import { SlideTabs } from '../SlideTabs';
import { ChatMessage, ChatPane, mergeMessages } from './ChatKit';
import './support-inbox.css';

/* ------------------------------------------------------------------ estado global */

export interface SupportUnread {
  /** Já buscou do servidor (antes disso nada toca). */
  loaded: boolean;
  chats: number;
  messages: number;
  latest: { id: string; name: string; preview: string | null; unread: number; at: string }[];
}

const EMPTY: SupportUnread = { loaded: false, chats: 0, messages: 0, latest: [] };
let unread: SupportUnread = EMPTY;
const subs = new Set<() => void>();
function setUnread(u: SupportUnread) {
  unread = u;
  subs.forEach((f) => f());
}

/** Conversas de clientes esperando resposta (selo do PDV, do topo e do "Mais"). */
export function useSupportUnread(): SupportUnread {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => unread,
    () => EMPTY,
  );
}

export const OPEN_SUPPORT_EVENT = 'cm:open-support';
/** Abre as mensagens dos clientes (numa conversa, se informada) de qualquer tela. */
export function openSupportInbox(chatId?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_SUPPORT_EVENT, { detail: { chatId } }));
}

/** Respostas prontas: um toque e a frase vai para o campo (dá para editar antes de enviar). */
const QUICK_REPLIES = [
  'Olá! Como podemos ajudar? 😊',
  'Seu pedido já está sendo preparado! 👨‍🍳',
  'Seu pedido saiu para entrega! 🛵',
  'Pode retirar, seu pedido está pronto! ✅',
  'Um momento, vou verificar para você.',
  'Temos sim! Quer que eu separe para você?',
  'Infelizmente esse item acabou hoje. 😕',
  'Obrigado pela preferência! Volte sempre! ❤️',
];

/* ------------------------------------------------------------------ tipos */

interface ChatSummary {
  id: string;
  name: string;
  phone: string | null;
  customerId: string | null;
  status: 'open' | 'closed';
  lastMessageAt: string | null;
  lastPreview: string | null;
  lastSender: 'customer' | 'staff' | 'system' | null;
  unread: number;
  customerReadAt: string;
  staffReadAt: string;
}
interface Detail {
  chat: ChatSummary;
  messages: ChatMessage[];
  hasMore: boolean;
  customer: { orders: number; lastOrderId: string | null; lastOrderNumber: number | null } | null;
}

const when = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const diff = (today.getTime() - d.getTime()) / 86_400_000;
  if (diff < 6) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
const fmtPhone = (p: string | null) => {
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  return d.length === 11
    ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
    : d.length === 10
      ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
      : p;
};
const initial = (n: string) => (n.trim()[0] ?? '?').toUpperCase();

/* ------------------------------------------------------------------ conversa aberta */

function Conversation({
  id,
  onBack,
  onChanged,
}: {
  id: string;
  onBack(): void;
  onChanged(): void;
}) {
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // onChanged pode mudar a cada desenho de quem está em volta. Guardado num ref, ele não refaz o
  // "load" abaixo: antes, cada aviso de não lida trocava a função, a conversa voltava ao
  // carregando e o texto que a equipe estava digitando sumia (botão Enviar apagado).
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  const markRead = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    void api(`/support/chats/${id}/read`, { method: 'POST' })
      .then(() => changedRef.current())
      .catch(() => undefined);
  }, [id]);

  const load = useCallback(async () => {
    try {
      const n = await api<Detail>(`/support/chats/${id}`);
      setD((old) =>
        old && old.chat.id === n.chat.id
          ? { ...n, messages: mergeMessages(old.messages, n.messages), hasMore: old.hasMore }
          : n,
      );
      if (n.chat.unread > 0) markRead();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }, [id, markRead, toast]);

  // Só outra conversa volta ao carregando; recarregar a mesma mantém o que está na tela.
  useEffect(() => {
    setD(null);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  useRealtime(
    (e) => {
      if (!('chatId' in e) || e.chatId !== id) return;
      if (e.type === 'support.message' && e.sender === 'customer') {
        setTyping(null);
        void load();
      } else if (e.type === 'support.read' && e.by === 'customer') void load();
      else if (e.type === 'support.typing' && e.by === 'customer') {
        setTyping('Cliente digitando…');
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setTyping(null), 5000);
      }
    },
    () => void load(),
  );

  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  async function setStatus(status: 'open' | 'closed') {
    try {
      await api(`/support/chats/${id}`, { method: 'PATCH', json: { status } });
      toast(status === 'closed' ? 'Conversa encerrada' : 'Conversa reaberta', 'success');
      onChanged();
      void load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  if (!d)
    return (
      <div className="sinbox__empty">
        <Skeleton variant="chat" />
      </div>
    );
  const c = d.chat;
  const wa = c.phone ? `https://wa.me/55${c.phone.replace(/\D/g, '')}` : null;
  return (
    <div className="sinbox__conv">
      <header className="sinbox__head">
        <button type="button" className="sinbox__back" aria-label="Voltar" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <span className="sinbox__avatar" aria-hidden>
          {initial(c.name)}
        </span>
        <div className="sinbox__who">
          <strong>{c.name}</strong>
          <small>
            {typing ?? (
              <>
                {c.phone && (
                  <a href={`tel:${c.phone}`} title="Ligar">
                    <Phone size={12} /> {fmtPhone(c.phone)}
                  </a>
                )}
                {d.customer ? (
                  <span>
                    <UserRound size={12} /> Conta · {d.customer.orders} pedido(s)
                  </span>
                ) : (
                  <span>Visitante</span>
                )}
              </>
            )}
          </small>
        </div>
        <div className="sinbox__actions">
          {d.customer?.lastOrderId && (
            <button
              type="button"
              className="sinbox__btn"
              onClick={() => setOrderId(d.customer!.lastOrderId)}
              title="Abrir o último pedido"
            >
              <ReceiptText size={15} />
              <span>#{d.customer.lastOrderNumber}</span>
            </button>
          )}
          {wa && (
            <a className="sinbox__btn" href={wa} target="_blank" rel="noreferrer" title="WhatsApp">
              <MessageCircle size={15} />
              <span className="sinbox__btn-text">WhatsApp</span>
            </a>
          )}
          {c.status === 'open' ? (
            <button
              type="button"
              className="sinbox__btn"
              onClick={() => setStatus('closed')}
              title="Encerrar conversa (volta a abrir se o cliente escrever)"
            >
              <CheckCircle2 size={15} />
              <span className="sinbox__btn-text">Encerrar</span>
            </button>
          ) : (
            <button type="button" className="sinbox__btn" onClick={() => setStatus('open')}>
              <RotateCcw size={15} />
              <span className="sinbox__btn-text">Reabrir</span>
            </button>
          )}
        </div>
      </header>
      <ChatPane
        key={id}
        side="staff"
        names={{ customer: c.name }}
        messages={d.messages}
        hasMore={d.hasMore}
        otherReadAt={c.customerReadAt}
        typing={typing}
        autoFocus
        quickReplies={QUICK_REPLIES}
        onOrder={(m) => m.orderId && setOrderId(m.orderId)}
        onLoadMore={async () => {
          const first = d.messages[0];
          if (!first) return;
          const older = await api<{ messages: ChatMessage[]; hasMore: boolean }>(
            `/support/chats/${id}/messages?before=${encodeURIComponent(first.createdAt)}`,
          );
          setD((x) =>
            x
              ? {
                  ...x,
                  messages: mergeMessages(older.messages, x.messages),
                  hasMore: older.hasMore,
                }
              : x,
          );
        }}
        uploadPath={`/support/chats/${id}/files`}
        send={(input) =>
          api<ChatMessage>(`/support/chats/${id}/messages`, { method: 'POST', json: input })
        }
        onSent={(m) => {
          setD((x) => (x ? { ...x, messages: mergeMessages(x.messages, [m]) } : x));
          onChanged();
        }}
        onTyping={() => void api(`/support/chats/${id}/typing`, { method: 'POST' }).catch(() => 0)}
        onError={(m) => toast(m, 'danger')}
        placeholder={`Responder ${c.name.split(' ')[0]}`}
        empty={<p className="sinbox__hint">Nenhuma mensagem ainda.</p>}
      />
      <OrderDetailModal variant="modal" orderId={orderId} onClose={() => setOrderId(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ caixa de entrada */

function Inbox({
  initial: start,
  onRefreshUnread,
  autoOpen = false,
}: {
  initial: string | null;
  onRefreshUnread(): void;
  /** No computador já entra na conversa mais recente (no chat do topo). */
  autoOpen?: boolean;
}) {
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open');
  const [q, setQ] = useState('');
  const [list, setList] = useState<ChatSummary[] | null>(null);
  const [current, setCurrent] = useState<string | null>(start);

  useEffect(() => setCurrent(start), [start]);
  const entered = useRef(false);
  useEffect(() => {
    if (!autoOpen || entered.current || !list?.length) return;
    entered.current = true;
    if (window.matchMedia?.('(min-width: 761px)').matches)
      setCurrent((c) => c ?? (list.find((x) => x.unread > 0) ?? list[0]).id);
  }, [autoOpen, list]);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ status });
    if (q.trim()) qs.set('q', q.trim());
    void api<ChatSummary[]>(`/support/chats?${qs}`)
      .then(setList)
      .catch(() => setList((l) => l ?? []));
  }, [status, q]);

  useEffect(() => {
    const t = window.setTimeout(load, q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);

  useRealtime((e) => {
    if (e.type === 'support.message' || e.type === 'support.read') load();
  }, load);

  const changed = useCallback(() => {
    load();
    onRefreshUnread();
  }, [load, onRefreshUnread]);

  return (
    <div className="sinbox" data-open={current ? '' : undefined}>
      <aside className="sinbox__list" aria-label="Conversas">
        <div className="sinbox__tools">
          <label className="sinbox__search">
            <Search size={15} aria-hidden />
            <input
              placeholder="Pesquisar"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Buscar conversa"
            />
          </label>
          <SlideTabs
            size="sm"
            label="Filtrar conversas"
            value={status}
            onChange={(v) => setStatus(v as 'open' | 'closed' | 'all')}
            tabs={[
              { value: 'open', label: 'Abertas' },
              { value: 'closed', label: 'Encerradas' },
              { value: 'all', label: 'Todas' },
            ]}
          />
        </div>
        {!list ? (
          <div className="sinbox__empty">
            <Skeleton />
          </div>
        ) : list.length === 0 ? (
          <div className="sinbox__empty">
            <MessageCircle size={28} />
            <p>
              {status === 'open'
                ? 'Nenhuma conversa aberta. Quando um cliente escrever pelo cardápio, ela aparece aqui.'
                : 'Nada por aqui.'}
            </p>
          </div>
        ) : (
          <ul>
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="sinbox__item"
                  aria-current={c.id === current || undefined}
                  data-unread={c.unread > 0 || undefined}
                  onClick={() => setCurrent(c.id)}
                >
                  <span className="sinbox__avatar" aria-hidden>
                    {initial(c.name)}
                  </span>
                  <span className="sinbox__item-text">
                    <span className="sinbox__item-top">
                      <strong>{c.name}</strong>
                      <time>{when(c.lastMessageAt)}</time>
                    </span>
                    <span className="sinbox__item-bottom">
                      <span className="sinbox__preview">
                        {c.lastSender === 'staff' && 'Você: '}
                        {c.lastPreview}
                      </span>
                      {c.unread > 0 && <b className="sinbox__count">{c.unread}</b>}
                      {c.status === 'closed' && <small className="sinbox__closed">encerrada</small>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="sinbox__main">
        {current ? (
          <Conversation id={current} onBack={() => setCurrent(null)} onChanged={changed} />
        ) : (
          <div className="sinbox__empty sinbox__empty--main">
            <MessageCircle size={34} />
            <p>Escolha uma conversa para responder.</p>
            <small>
              Os clientes escrevem pela aba <strong>Conversa</strong> do cardápio online e podem
              mandar fotos, vídeos e emojis.
            </small>
          </div>
        )}
      </section>
    </div>
  );
}

const REFRESH_SUPPORT_EVENT = 'cm:support-refresh';

/** Mensagens dos clientes dentro do chat do topo (aba "Clientes"). */
export function CustomersInbox() {
  const refresh = useCallback(
    () => window.dispatchEvent(new CustomEvent(REFRESH_SUPPORT_EVENT)),
    [],
  );
  return <Inbox initial={null} onRefreshUnread={refresh} autoOpen />;
}

/* ------------------------------------------------------------------ aviso + painel */

interface Peek {
  id: string;
  name: string;
  preview: string | null;
  key: number;
}

/**
 * Fica em todas as telas de quem cuida dos pedidos: busca as conversas esperando resposta,
 * toca o som, mostra o aviso no canto (e a notificação do computador, se a aba estiver em
 * segundo plano) e abre o painel das mensagens.
 */
export function SupportChatHost() {
  const can = useCan('orders:manage');
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const known = useRef<Map<string, string> | null>(null);
  const openRef = useRef(false);
  openRef.current = open;
  const baseTitle = useRef(document.title);

  const refresh = useCallback(async () => {
    if (!can) return;
    const r = await api<Omit<SupportUnread, 'loaded'>>('/support/chats/unread').catch(() => null);
    if (!r) return;
    const u: SupportUnread = { ...r, loaded: true };
    // Chegou mensagem nova (não só na primeira carga): som, aviso e notificação.
    const prev = known.current;
    const fresh = u.latest.find((l) => prev && prev.get(l.id) !== l.at);
    known.current = new Map(u.latest.map((l) => [l.id, l.at]));
    setUnread(u);
    if (fresh) {
      playSound('message');
      if (!openRef.current) setPeek({ ...fresh, key: Date.now() });
      if (document.visibilityState !== 'visible' && 'Notification' in window)
        try {
          if (Notification.permission === 'granted') {
            const n = new Notification(`Mensagem de ${fresh.name}`, {
              body: fresh.preview ?? '',
              tag: `cm-support-${fresh.id}`,
              // Ícone do restaurante (o mesmo da aba); sem nenhum, o do Comandou.
              icon: cachedBranding()?.faviconUrl || cachedBranding()?.logoUrl || '/favicon.svg',
            });
            n.onclick = () => {
              window.focus();
              openSupportInbox(fresh.id);
              n.close();
            };
          }
        } catch {
          /* navegador sem notificações: o aviso na tela basta */
        }
    }
  }, [can]);
  const refreshUnread = useCallback(() => void refresh(), [refresh]);

  useEffect(() => {
    void refresh();
    const on = () => void refresh();
    window.addEventListener(REFRESH_SUPPORT_EVENT, on);
    return () => window.removeEventListener(REFRESH_SUPPORT_EVENT, on);
  }, [refresh]);
  useRealtime(
    (e) => {
      if (e.type === 'support.message' || e.type === 'support.read') void refresh();
    },
    () => void refresh(),
  );

  // Sem tempo real (queda), confere de tempos em tempos.
  useEffect(() => {
    if (!can) return;
    const t = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(t);
  }, [can, refresh]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      setStart((e as CustomEvent<{ chatId?: string }>).detail?.chatId ?? null);
      setOpen(true);
      setPeek(null);
    };
    window.addEventListener(OPEN_SUPPORT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SUPPORT_EVENT, onOpen);
  }, []);

  // Some sozinho depois de alguns segundos.
  useEffect(() => {
    if (!peek) return;
    const t = window.setTimeout(() => setPeek(null), 9000);
    return () => window.clearTimeout(t);
  }, [peek]);

  // Título da aba com o número de conversas esperando: dá para ver de outra aba.
  const { chats } = useSupportUnread();
  useEffect(() => {
    const clean = document.title.replace(/^\(\d+\) /, '');
    baseTitle.current = clean;
    document.title = chats > 0 ? `(${chats}) ${clean}` : clean;
  }, [chats]);

  if (!can) return null;
  return (
    <>
      {peek && (
        <div className="speek" role="status" key={peek.key}>
          <button
            type="button"
            className="speek__body"
            onClick={() => openSupportInbox(peek.id)}
            aria-label={`Responder ${peek.name}`}
          >
            <span className="speek__icon">
              <MessageCircle size={18} />
            </span>
            <span className="speek__text">
              <strong>{peek.name}</strong>
              <span>{peek.preview}</span>
            </span>
            <span className="speek__cta">Responder</span>
          </button>
          <button
            type="button"
            className="speek__close"
            aria-label="Fechar aviso"
            onClick={() => setPeek(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <SidePanel
        open={open}
        size="xl"
        className="sinbox-panel"
        title={
          <span className="sinbox__title">
            <MessageCircle size={18} /> Mensagens dos clientes
          </span>
        }
        actions={<NotifyButton />}
        onClose={() => {
          setOpen(false);
          void refresh();
        }}
      >
        <Inbox initial={start} onRefreshUnread={refreshUnread} />
      </SidePanel>
    </>
  );
}

/** Pede para avisar no computador mesmo com a aba em segundo plano. */
function NotifyButton() {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [perm, setPerm] = useState(supported ? Notification.permission : 'denied');
  if (!supported || perm !== 'default') return null;
  return (
    <button
      type="button"
      className="side-panel__close"
      onClick={() => void Notification.requestPermission().then(setPerm)}
      title="Receber aviso do navegador quando um cliente escrever, mesmo em outra aba"
    >
      <Bell size={15} /> <span className="side-panel__close-text">Avisar no computador</span>
    </button>
  );
}

/** Botão com selo para abrir as mensagens (PDV e topo). */
export function SupportButton({ className = '', label }: { className?: string; label?: string }) {
  const can = useCan('orders:manage');
  const { chats } = useSupportUnread();
  if (!can) return null;
  return (
    <button
      type="button"
      className={`sbtn ${className}`}
      data-waiting={chats > 0 || undefined}
      onClick={() => openSupportInbox()}
      aria-label={chats ? `Mensagens de clientes: ${chats} esperando` : 'Mensagens de clientes'}
      title="Mensagens dos clientes"
    >
      <MessageCircle size={17} />
      {label && <span className="sbtn__label">{label}</span>}
      {chats > 0 && <b className="sbtn__count">{chats > 9 ? '9+' : chats}</b>}
    </button>
  );
}
