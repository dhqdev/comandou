import { ArrowLeft, ExternalLink, MessageCircle, Plus, Search, SendHorizontal } from 'lucide-react';
import QRCode from 'qrcode';
import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Modal,
  Spinner,
  TextField,
  useToast,
  Skeleton,
} from '../design-system';
import '../features/store-chat/support-inbox.css';
import { api } from '../lib/api';
import { Monogram, PageHead } from './ui';
import './whatsapp-admin.css';

/**
 * Super Admin › WhatsApp: o número do Comandou conectado pelo QR Code (o mesmo gateway Baileys
 * dos restaurantes) e as conversas com quem escreve para ele. Só texto, por enquanto.
 */

interface Session {
  configured: boolean;
  status: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'logged_out';
  qr?: string;
  phone?: string;
  error?: string;
  reconnecting?: boolean;
}

interface Chat {
  jid: string;
  phone: string | null;
  name: string | null;
  lastAt: string;
  lastPreview: string;
  lastDir: 'in' | 'out' | null;
  unread: number;
  tenant: { id: string; name: string; slug: string } | null;
}

interface Message {
  id: string;
  direction: 'in' | 'out';
  kind: string;
  body: string;
  status: 'received' | 'sent' | 'failed';
  error: string | null;
  authorName: string | null;
  createdAt: string;
}

const POLL_MS = 6000;
export const WA_CHANGED_EVENT = 'cm:admin-whatsapp-changed';
const changed = () => window.dispatchEvent(new Event(WA_CHANGED_EVENT));

const SESSION: Record<Session['status'], [string, 'neutral' | 'info' | 'success' | 'warning']> = {
  disconnected: ['Desconectado', 'neutral'],
  connecting: ['Conectando…', 'info'],
  qr: ['Esperando o QR Code', 'warning'],
  connected: ['Conectado', 'success'],
  logged_out: ['Desconectado no celular', 'warning'],
};

const KIND: Record<string, string> = {
  image: 'Foto',
  audio: 'Áudio',
  video: 'Vídeo',
  document: 'Documento',
  sticker: 'Figurinha',
  location: 'Localização',
  contact: 'Contato',
  other: 'Mensagem',
};

/** +55 11 91234-5678 */
export function formatPhone(d: string | null) {
  if (!d) return '';
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${d}`;
}
const titleOf = (c: Chat) =>
  c.name || (c.phone ? formatPhone(c.phone) : c.tenant?.name) || 'Contato';

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const diff = (today.getTime() - d.getTime()) / 86_400_000;
  if (diff < 6) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
const hour = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

function merge(list: Message[], add: Message[]) {
  const map = new Map(list.map((m) => [m.id, m]));
  for (const m of add) map.set(m.id, m);
  return [...map.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
  );
}

/* ------------------------------------------------------------------ conexão */

function useSession() {
  const [s, setS] = useState<Session | null>(null);
  const refresh = useCallback(async () => {
    try {
      setS(await api<Session>('/platform/whatsapp/session'));
    } catch (e) {
      setS({ configured: true, status: 'disconnected', error: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // Esperando o QR ou a conexão: consulta a cada 3 s; conectado, a cada 30 s (cai, aparece).
  useEffect(() => {
    if (!s?.configured) return;
    const fast = s.status === 'qr' || s.status === 'connecting';
    const t = setInterval(() => !document.hidden && void refresh(), fast ? 3000 : 30_000);
    return () => clearInterval(t);
  }, [s?.configured, s?.status, refresh]);
  return [s, setS, refresh] as const;
}

function ConnectPanel({
  s,
  acting,
  onConnect,
}: {
  s: Session;
  acting: boolean;
  onConnect(): void;
}) {
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    if (s.status === 'qr' && s.qr)
      QRCode.toDataURL(s.qr, { margin: 1, width: 240 })
        .then(setImg)
        .catch(() => setImg(null));
    else setImg(null);
  }, [s.status, s.qr]);

  if (!s.configured)
    return (
      <Alert tone="info">
        O serviço de WhatsApp ainda não está ligado neste servidor (WHATSAPP_GATEWAY_URL e
        WHATSAPP_GATEWAY_TOKEN). Ele é o mesmo que os restaurantes usam.
      </Alert>
    );
  return (
    <section className="wadm-connect" aria-label="Conectar o WhatsApp">
      <div className="wadm-connect__text">
        <h2>Conecte o número do Comandou</h2>
        <ol>
          <li>Abra o WhatsApp no celular do número que vai atender.</li>
          <li>
            Toque em <strong>Aparelhos conectados</strong> › <strong>Conectar um aparelho</strong>.
          </li>
          <li>Aponte a câmera para o código ao lado.</li>
        </ol>
        {s.error && s.status !== 'qr' && <Alert tone="warning">{s.error}</Alert>}
        <p className="wadm-connect__note">
          Funciona como o WhatsApp Web, mas não é a API oficial: evite mensagens em massa para não
          ter o número bloqueado. O celular continua recebendo tudo normalmente.
        </p>
        {s.status !== 'qr' && s.status !== 'connecting' && (
          <div>
            <Button loading={acting} onClick={onConnect}>
              Gerar QR Code
            </Button>
          </div>
        )}
      </div>
      <div className="wadm-connect__qr" aria-live="polite">
        {s.status === 'qr' && img ? (
          <img
            src={img}
            alt="QR Code para conectar o WhatsApp do painel"
            width={240}
            height={240}
          />
        ) : s.status === 'qr' || s.status === 'connecting' ? (
          <Skeleton variant="qr" size={264} />
        ) : (
          <MessageCircle size={48} aria-hidden />
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ conversa */

function Conversation({
  jid,
  connected,
  onBack,
}: {
  jid: string;
  connected: boolean;
  onBack(): void;
}) {
  const toast = useToast();
  const [chat, setChat] = useState<Chat | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const path = `/platform/whatsapp/chats/${encodeURIComponent(jid)}`;

  const load = useCallback(async () => {
    try {
      const r = await api<{ chat: Chat; messages: Message[]; hasMore: boolean }>(path);
      setError(null);
      setChat(r.chat);
      setMsgs((x) => merge(x, r.messages));
      setHasMore((h) => h || r.hasMore);
      if (r.chat.unread > 0) {
        await api(`${path}/read`, { method: 'POST' }).catch(() => 0);
        changed();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);

  useEffect(() => {
    setChat(null);
    setMsgs([]);
    setHasMore(false);
    stick.current = true;
    void load();
    const t = setInterval(() => !document.hidden && void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Fica no fim enquanto quem lê está no fim (mensagem nova aparece); subiu para ler, não puxa.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [text]);

  async function older() {
    const first = msgs[0];
    if (!first) return;
    stick.current = false;
    const r = await api<{ messages: Message[]; hasMore: boolean }>(
      `${path}/messages?before=${encodeURIComponent(first.createdAt)}`,
    );
    setMsgs((x) => merge(r.messages, x));
    setHasMore(r.hasMore);
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await api<{ chat: Chat; message: Message }>('/platform/whatsapp/messages', {
        method: 'POST',
        json: { jid, text: body },
      });
      stick.current = true;
      setMsgs((x) => merge(x, [r.message]));
      setChat(r.chat);
      if (r.message.status === 'failed') toast(r.message.error ?? 'Não foi enviada', 'danger');
      else setText('');
      changed();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  if (!chat)
    return (
      <div className="sinbox__empty">{error ? <p>{error}</p> : <Skeleton variant="chat" />}</div>
    );
  const name = titleOf(chat);
  let lastDay = '';
  return (
    <div className="sinbox__conv">
      <header className="sinbox__head">
        <button type="button" className="sinbox__back" aria-label="Voltar" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <Monogram name={name} size={38} />
        <div className="sinbox__who">
          <strong>{name}</strong>
          <small>
            {chat.phone && <span>{formatPhone(chat.phone)}</span>}
            {chat.tenant && <span className="sinbox__plan">{chat.tenant.name}</span>}
          </small>
        </div>
        {chat.tenant && (
          <div className="sinbox__actions">
            <Link
              className="sinbox__btn sinbox__btn--narrow"
              to={`/restaurantes/${chat.tenant.id}`}
              title="Abrir o restaurante com este telefone no cadastro"
            >
              <ExternalLink size={15} />
              <span className="sinbox__btn-text">Restaurante</span>
            </Link>
          </div>
        )}
      </header>
      <div
        className="wadm-thread"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {hasMore && (
          <button type="button" className="wadm-more" onClick={() => void older()}>
            Ver mensagens anteriores
          </button>
        )}
        {msgs.map((m) => {
          const d = day(m.createdAt);
          const sep = d !== lastDay;
          lastDay = d;
          return (
            <div key={m.id} className="wadm-row-wrap">
              {sep && <div className="wadm-day">{d}</div>}
              <div
                className="wadm-msg"
                data-out={m.direction === 'out' || undefined}
                data-failed={m.status === 'failed' || undefined}
              >
                {m.kind !== 'text' && (
                  <span className="wadm-msg__kind">{KIND[m.kind] ?? 'Mensagem'}</span>
                )}
                {m.body && <p>{m.body}</p>}
                <small>
                  {m.direction === 'out' && m.authorName && `${m.authorName} · `}
                  {hour(m.createdAt)}
                  {m.status === 'failed' && ` · não enviada${m.error ? `: ${m.error}` : ''}`}
                </small>
              </div>
            </div>
          );
        })}
        {msgs.length === 0 && (
          <div className="sinbox__empty">
            <p>Nenhuma mensagem ainda.</p>
          </div>
        )}
      </div>
      <form className="wadm-compose" onSubmit={send}>
        <textarea
          ref={input}
          rows={1}
          value={text}
          maxLength={4000}
          placeholder={connected ? 'Escreva uma mensagem' : 'Conecte o WhatsApp para responder'}
          disabled={!connected}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          aria-label="Mensagem"
          autoFocus
        />
        <button
          type="submit"
          className="wadm-send"
          disabled={!connected || !text.trim() || sending}
          aria-label="Enviar"
        >
          {sending ? <Spinner /> : <SendHorizontal size={18} />}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ nova conversa */

function NewChat({ onClose, onSent }: { onClose(): void; onSent(jid: string): void }) {
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ chat: Chat; message: Message }>('/platform/whatsapp/messages', {
        method: 'POST',
        json: { phone, text },
      });
      if (r.message.status === 'failed') toast(r.message.error ?? 'Não foi enviada', 'danger');
      else toast('Mensagem enviada', 'success');
      changed();
      onSent(r.chat.jid);
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="Nova conversa"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="wadm-new" loading={busy} disabled={!phone || !text.trim()}>
            Enviar
          </Button>
        </>
      }
    >
      <form id="wadm-new" className="wadm-new" onSubmit={submit}>
        <TextField
          label="Telefone"
          hint="Com DDD. Ex.: 11 91234-5678"
          inputMode="tel"
          autoComplete="off"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoFocus
        />
        <label className="wadm-new__text">
          <span>Mensagem</span>
          <textarea
            rows={4}
            maxLength={4000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ tela */

export function WhatsAppAdminPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const current = params.get('c');
  const [s, setS] = useSession();
  const [acting, setActing] = useState(false);
  const [list, setList] = useState<Chat[] | null>(null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const qRef = useRef(q);
  qRef.current = q;

  const setCurrent = (jid: string | null) =>
    setParams(jid ? { c: jid } : {}, { replace: !!current && !!jid });

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (qRef.current.trim()) qs.set('q', qRef.current.trim());
    void api<Chat[]>(`/platform/whatsapp/chats?${qs}`)
      .then(setList)
      .catch(() => setList((l) => l ?? []));
  }, []);

  useEffect(() => {
    const t = window.setTimeout(load, q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);
  useEffect(() => {
    const t = setInterval(() => !document.hidden && load(), POLL_MS);
    window.addEventListener(WA_CHANGED_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(WA_CHANGED_EVENT, load);
    };
  }, [load]);

  async function call(action: 'connect' | 'logout') {
    if (action === 'logout' && !window.confirm('Desconectar o WhatsApp do painel?')) return;
    setActing(true);
    try {
      setS(
        await api<Session>(`/platform/whatsapp/session/${action}`, { method: 'POST', json: {} }),
      );
      if (action === 'logout') toast('WhatsApp desconectado', 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setActing(false);
    }
  }

  const connected = s?.status === 'connected';
  const hasChats = !!list && list.length > 0;
  const badge = s?.configured
    ? s.reconnecting
      ? (['Reconectando…', 'info'] as const)
      : SESSION[s.status]
    : null;

  return (
    <div className="adm-support-page wadm-page">
      <PageHead
        page
        title="WhatsApp"
        sub={
          connected && s?.phone ? (
            <span className="wadm-sub">
              <Badge tone="success">Conectado</Badge> {formatPhone(s.phone)}
            </span>
          ) : (
            badge && <Badge tone={badge[1]}>{badge[0]}</Badge>
          )
        }
        actions={
          s?.configured && (
            <>
              {connected && (
                <Button size="sm" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                  Nova conversa
                </Button>
              )}
              {(connected || s.status === 'qr' || s.status === 'connecting') && (
                <Button size="sm" variant="ghost" loading={acting} onClick={() => call('logout')}>
                  Desconectar
                </Button>
              )}
            </>
          )
        }
      />
      {!s ? (
        <div className="sinbox__empty">
          <Skeleton variant="detail" />
        </div>
      ) : (
        !connected && <ConnectPanel s={s} acting={acting} onConnect={() => void call('connect')} />
      )}
      {(connected || hasChats) && (
        <div className="adm-support">
          <div className="sinbox" data-open={current ? '' : undefined}>
            <aside className="sinbox__list" aria-label="Conversas do WhatsApp">
              <div className="sinbox__tools">
                <label className="sinbox__search">
                  <Search size={15} aria-hidden />
                  <input
                    placeholder="Pesquisar"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    aria-label="Buscar nome ou telefone"
                  />
                </label>
              </div>
              {!list ? (
                <div className="sinbox__empty">
                  <Skeleton />
                </div>
              ) : list.length === 0 ? (
                <div className="sinbox__empty">
                  <MessageCircle size={28} />
                  <p>
                    {q
                      ? 'Nada encontrado.'
                      : 'Nenhuma conversa ainda. Quem escrever para o número aparece aqui.'}
                  </p>
                </div>
              ) : (
                <ul>
                  {list.map((c) => (
                    <li key={c.jid}>
                      <button
                        type="button"
                        className="sinbox__item"
                        aria-current={c.jid === current || undefined}
                        data-unread={c.unread > 0 || undefined}
                        onClick={() => setCurrent(c.jid)}
                      >
                        <Monogram name={titleOf(c)} size={38} />
                        <span className="sinbox__item-text">
                          <span className="sinbox__item-top">
                            <strong>{titleOf(c)}</strong>
                            <time>{when(c.lastAt)}</time>
                          </span>
                          <span className="sinbox__item-bottom">
                            <span className="sinbox__preview">
                              {c.lastDir === 'out' && 'Você: '}
                              {c.lastPreview}
                            </span>
                            {c.unread > 0 && <b className="sinbox__count">{c.unread}</b>}
                          </span>
                          {c.tenant && <small className="adm-support__plan">{c.tenant.name}</small>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
            <section className="sinbox__main">
              {current ? (
                <Conversation jid={current} connected={connected} onBack={() => setCurrent(null)} />
              ) : (
                <div className="sinbox__empty sinbox__empty--main">
                  <MessageCircle size={34} />
                  <p>Escolha uma conversa para responder.</p>
                  {connected && (
                    <small>
                      Para escrever para alguém novo, toque em <strong>Nova conversa</strong>.
                    </small>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
      {creating && (
        <NewChat
          onClose={() => setCreating(false)}
          onSent={(jid) => {
            setCreating(false);
            setCurrent(jid);
            load();
          }}
        />
      )}
    </div>
  );
}
