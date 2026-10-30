import { ChevronLeft, MessageCircle } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Mascot, Spinner, useToast } from '../../design-system';
import { ChatMessage, ChatPane, mergeMessages } from '../../features/store-chat/ChatKit';
import { api, ApiError } from '../../lib/api';
import { useStoreChat } from './chat';
import { useStore } from './context';
import { maskPhone } from './store';
import { Field, Photo } from './ui';
import './chat.css';

interface ChatState {
  enabled: boolean;
  greeting: string | null;
  storeOpen: boolean;
  chat: { id: string; name: string; status: 'open' | 'closed'; staffReadAt: string } | null;
  messages: ChatMessage[];
  hasMore: boolean;
  unread: number;
}

/** Visitante sem conta: nome e celular para a loja saber com quem fala. */
function GuestStart({ onStarted }: { onStarted(s: ChatState): void }) {
  const { menu, customer } = useStore();
  const [name, setName] = useState(customer.customerName);
  const [phone, setPhone] = useState(customer.customerPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onStarted(
        await api<ChatState>('/store/chat/start', {
          method: 'POST',
          json: { name: name.trim(), phone },
        }),
      );
    } catch (err) {
      const ex = err as ApiError;
      setError(
        ex.status === 0
          ? 'Sem conexão. Tente de novo.'
          : ex.status === 400
            ? 'Confira o nome e o celular com DDD.'
            : ex.message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="sfchat__start" onSubmit={submit}>
      <Mascot size={56} mood="happy" />
      <h2>Fale com {menu.restaurant.name}</h2>
      <p>Tire dúvidas, combine detalhes do pedido e mande fotos ou vídeos, tudo por aqui.</p>
      <Field label="Seu nome">
        <input
          required
          maxLength={80}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Celular">
        <input
          required
          inputMode="tel"
          autoComplete="tel"
          placeholder="(11) 98888-7777"
          value={phone}
          onChange={(e) => setPhone(maskPhone(e.target.value))}
        />
      </Field>
      {error && <p className="form-error">{error}</p>}
      <button className="cta" disabled={busy}>
        {busy ? 'Abrindo…' : 'Começar conversa'}
      </button>
      {menu.appearance.accountsEnabled && (
        <p className="sfchat__alt">
          Tem conta? <Link to="/pedir/conta">Entre</Link> e a conversa fica salva nela.
        </p>
      )}
    </form>
  );
}

/** Conversa do cliente com a loja (/pedir/conversa), no lugar de levar ao WhatsApp. */
export function ChatScreen() {
  const { menu, account } = useStore();
  const live = useStoreChat();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<ChatState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const typingTimer = useRef<number | undefined>(undefined);
  const orderNumber = Number(params.get('pedido')) || null;
  const r = menu.restaurant;
  const loggedIn = !!account?.customer;

  const load = useCallback(async () => {
    try {
      const s = await api<ChatState>('/store/chat');
      setState((old) =>
        old && old.chat?.id === s.chat?.id
          ? { ...s, messages: mergeMessages(old.messages, s.messages), hasMore: old.hasMore }
          : s,
      );
      setError(null);
      if (s.chat && s.unread > 0) void api('/store/chat/read', { method: 'POST' }).catch(() => 0);
    } catch (e) {
      setError((e as ApiError).status === 0 ? 'Sem conexão agora.' : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (account === null) return;
    void load();
  }, [load, account === null, account?.customer?.id]);

  // Tela aberta: não conta como não lida.
  useEffect(() => {
    live.setOpen(true);
    return () => live.setOpen(false);
  }, [live.setOpen]);

  useEffect(
    () =>
      live.listen((e) => {
        if (e.type === 'ready' || (e.type === 'support.message' && e.sender !== 'customer')) {
          if (e.type === 'support.message') setTyping(null);
          void load();
        } else if (e.type === 'support.read' && e.by === 'staff') void load();
        else if (e.type === 'support.typing' && e.by === 'staff') {
          setTyping(`${e.name ?? 'A loja'} está digitando…`);
          window.clearTimeout(typingTimer.current);
          typingTimer.current = window.setTimeout(() => setTyping(null), 5000);
        }
      }),
    [live.listen, load],
  );

  // Ao voltar para a aba, marca como lida o que chegou.
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  useEffect(() => {
    document.title = `Conversa · ${r.name}`;
  }, [r.name]);

  const clearOrder = () => {
    const p = new URLSearchParams(params);
    p.delete('pedido');
    setParams(p, { replace: true });
  };

  const head = (
    <header className="sfchat__head">
      <button
        type="button"
        className="iconbtn"
        aria-label="Voltar"
        onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/pedir'))}
      >
        <ChevronLeft size={20} />
      </button>
      <Photo src={r.logoUrl} alt={r.name} className="sfchat__logo" eager />
      <div className="sfchat__who">
        <strong>{r.name}</strong>
        <small data-open={state?.storeOpen ?? menu.store.isOpen}>
          {typing
            ? 'digitando…'
            : (state?.storeOpen ?? menu.store.isOpen)
              ? 'Loja aberta · responde por aqui'
              : 'Loja fechada · responde quando abrir'}
        </small>
      </div>
    </header>
  );

  let body;
  if (!state) {
    body = error ? (
      <div className="sfchat__center">
        <p>{error}</p>
        <button className="btn-line" onClick={() => void load()}>
          Tentar de novo
        </button>
      </div>
    ) : (
      <div className="sfchat__center">
        <Spinner label="Abrindo a conversa" />
      </div>
    );
  } else if (!state.enabled) {
    const wa = r.whatsapp?.replace(/\D/g, '');
    body = (
      <div className="sfchat__center">
        <MessageCircle size={36} />
        <p>Esta loja não está atendendo por mensagem no cardápio.</p>
        {wa && (
          <a
            className="btn-line"
            href={`https://wa.me/${wa.length <= 11 ? `55${wa}` : wa}`}
            target="_blank"
            rel="noreferrer"
          >
            Chamar no WhatsApp
          </a>
        )}
      </div>
    );
  } else if (!state.chat && !loggedIn) {
    body = (
      <div className="sfchat__scroll">
        <GuestStart
          onStarted={(s) => {
            setState(s);
            live.started();
          }}
        />
      </div>
    );
  } else {
    const first = account?.customer?.name.split(' ')[0] ?? state.chat?.name.split(' ')[0];
    body = (
      <ChatPane
        side="customer"
        messages={state.messages}
        hasMore={state.hasMore}
        otherReadAt={state.chat?.staffReadAt}
        typing={typing}
        autoFocus
        greeting={
          <>
            <strong>Olá{first ? `, ${first}` : ''}! 👋</strong>
            {state.greeting ??
              `Mande sua mensagem para ${r.name}. Pode enviar fotos, vídeos e emojis; a equipe responde aqui mesmo.`}
          </>
        }
        onLoadMore={async () => {
          const first = state.messages[0];
          if (!first) return;
          const older = await api<{ messages: ChatMessage[]; hasMore: boolean }>(
            `/store/chat/messages?before=${encodeURIComponent(first.createdAt)}`,
          );
          setState((s) =>
            s
              ? {
                  ...s,
                  messages: mergeMessages(older.messages, s.messages),
                  hasMore: older.hasMore,
                }
              : s,
          );
        }}
        orderNumber={orderNumber}
        onClearOrder={clearOrder}
        initialText={orderNumber ? 'Olá! Sobre o meu pedido: ' : ''}
        uploadPath="/store/chat/files"
        send={(input) => api<ChatMessage>('/store/chat/messages', { method: 'POST', json: input })}
        onSent={(m) => {
          setState((s) => (s ? { ...s, messages: mergeMessages(s.messages, [m]) } : s));
          if (!state.chat) {
            live.started();
            void load();
          }
        }}
        onTyping={() => void api('/store/chat/typing', { method: 'POST' }).catch(() => 0)}
        onError={(m) => toast(m, 'danger')}
        placeholder="Escreva para a loja"
      />
    );
  }

  return (
    <div className="sfchat">
      {head}
      <div className="sfchat__body">{body}</div>
    </div>
  );
}
