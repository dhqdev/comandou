import {
  AtSign,
  Bell,
  CheckCheck,
  Image as ImageIcon,
  Megaphone,
  MessageSquarePlus,
  Pin,
  PinOff,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Square,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LivePanda, PandaMood, useToast } from '../../design-system';
import { ApiError } from '../../lib/api';
import { mediaUrl } from '../../lib/media';
import { useRealtimeEvents } from '../../lib/realtime';
import {
  AiMessage,
  AiStatus,
  AiUsage,
  askAi,
  chatApi,
  Notice,
  Post,
  REACTIONS,
  uploadChatImage,
} from './chat-api';
import { Markdown } from './markdown';
import { Avatar, fmtInt, shortWhen } from './util';

// ------------------------------------------------------------------ Mural

export function MuralTab({ me, canPin, pollMs }: { me: string; canPin: boolean; pollMs: number }) {
  const toast = useToast();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(() => chatApi.posts().then(setPosts, () => setPosts([])), []);
  useEffect(() => {
    void load();
    const t = setInterval(() => !document.hidden && load(), pollMs * 2);
    return () => clearInterval(t);
  }, [load, pollMs]);
  useRealtimeEvents((e) => {
    if (e.type === 'chat.mural') void load();
  }, false);

  const publish = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await chatApi.newPost(text.trim(), image);
      setText('');
      setImage(null);
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  return (
    <div className="tc-page">
      <header className="tc-page__head">
        <Megaphone size={18} />
        <div>
          <strong>Mural da equipe</strong>
          <small>Recados para todo mundo. O gestor pode fixar os importantes.</small>
        </div>
      </header>
      <div className="tc-page__scroll">
        <div className="tc-post-new">
          <textarea
            className="tc-field"
            rows={2}
            placeholder="Escreva um recado para a equipe…"
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void publish();
            }}
          />
          {image && (
            <span className="tc-post-new__img">
              <img src={mediaUrl(image)!} alt="" />
              <button onClick={() => setImage(null)} aria-label="Tirar foto">
                <X size={14} />
              </button>
            </span>
          )}
          <div className="tc-post-new__row">
            <button
              className="tc-icon"
              onClick={() => file.current?.click()}
              aria-label="Foto"
              title="Foto"
            >
              <ImageIcon size={18} />
            </button>
            <input
              ref={file}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  setImage(await uploadChatImage(f));
                } catch (err) {
                  toast((err as Error).message, 'danger');
                }
              }}
            />
            <span className="tc-spacer" />
            <button className="tc-btn" onClick={publish} disabled={!text.trim() || busy}>
              Publicar
            </button>
          </div>
        </div>
        {posts?.length === 0 && (
          <div className="tc-page__empty">
            <LivePanda size={72} mood="sleep" />
            <p>Nenhum recado no mural ainda.</p>
          </div>
        )}
        {posts?.map((p) => {
          const reactions = Object.entries(p.reactions).filter(([, u]) => u.length);
          return (
            <article key={p.id} className={`tc-post ${p.pinned ? 'is-pinned' : ''}`}>
              <header>
                <Avatar name={p.authorName} seed={p.authorId ?? p.id} size={36} />
                <span>
                  <strong>{p.authorName ?? 'Alguém'}</strong>
                  <small>
                    {p.authorRole ? `${p.authorRole} · ` : ''}
                    {shortWhen(p.createdAt)}
                  </small>
                </span>
                {p.pinned && (
                  <span className="tc-pill">
                    <Pin size={12} /> Fixado
                  </span>
                )}
                <span className="tc-spacer" />
                {canPin && (
                  <button
                    className="tc-icon"
                    onClick={() => act(() => chatApi.pinPost(p.id, !p.pinned))}
                    aria-label={p.pinned ? 'Desafixar' : 'Fixar'}
                    title={p.pinned ? 'Desafixar' : 'Fixar'}
                  >
                    {p.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                  </button>
                )}
                {(p.authorId === me || canPin) && (
                  <button
                    className="tc-icon"
                    onClick={() =>
                      confirm('Apagar este recado?') && act(() => chatApi.removePost(p.id))
                    }
                    aria-label="Apagar"
                    title="Apagar"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </header>
              <p>{p.body}</p>
              {p.imageId && (
                <img className="tc-post__img" src={mediaUrl(p.imageId)!} alt="" loading="lazy" />
              )}
              <footer>
                {REACTIONS.slice(0, 5).map((e) => {
                  const users = p.reactions[e] ?? [];
                  return (
                    <button
                      key={e}
                      className={`tc-chip ${users.includes(me) ? 'is-mine' : ''} ${users.length ? 'has' : ''}`}
                      onClick={() => act(() => chatApi.reactPost(p.id, e))}
                    >
                      {e} {users.length > 0 && users.length}
                    </button>
                  );
                })}
                {reactions
                  .filter(([e]) => !REACTIONS.slice(0, 5).includes(e as never))
                  .map(([e, u]) => (
                    <span key={e} className="tc-chip has">
                      {e} {u.length}
                    </span>
                  ))}
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Avisos

const NOTICE_ICON = {
  mention: <AtSign size={16} />,
  group: <Users size={16} />,
  post: <Megaphone size={16} />,
  ai: <Sparkles size={16} />,
  system: <Bell size={16} />,
};

export function NoticesTab({
  onOpenConversation,
  onOpenMural,
  onChanged,
}: {
  onOpenConversation: (id: string) => void;
  onOpenMural: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Notice[] | null>(null);
  const load = useCallback(() => chatApi.notices().then(setItems, () => setItems([])), []);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtimeEvents((e) => {
    if (e.type === 'chat.notice') void load();
  }, false);
  const unread = items?.filter((n) => !n.readAt).length ?? 0;
  const readAll = async () => {
    await chatApi.readNotices().catch(() => undefined);
    await load();
    onChanged();
  };
  const open = async (n: Notice) => {
    if (!n.readAt) {
      await chatApi.readNotices([n.id]).catch(() => undefined);
      onChanged();
    }
    if (n.conversationId) onOpenConversation(n.conversationId);
    else if (n.postId) onOpenMural();
    else void load();
  };
  return (
    <div className="tc-page">
      <header className="tc-page__head">
        <Bell size={18} />
        <div>
          <strong>Avisos</strong>
          <small>{unread ? `${unread} ${unread === 1 ? 'novo' : 'novos'}` : 'Tudo em dia'}</small>
        </div>
        <span className="tc-spacer" />
        {unread > 0 && (
          <button className="tc-link" onClick={readAll}>
            <CheckCheck size={15} /> Marcar todos como lidos
          </button>
        )}
      </header>
      <div className="tc-page__scroll">
        {items?.length === 0 && (
          <div className="tc-page__empty">
            <LivePanda size={72} mood="happy" />
            <p>Nenhum aviso por aqui.</p>
            <small>Menções, grupos novos e recados do mural aparecem aqui.</small>
          </div>
        )}
        {items?.map((n) => (
          <button
            key={n.id}
            className={`tc-notice ${n.readAt ? '' : 'is-new'}`}
            onClick={() => open(n)}
          >
            <span className={`tc-notice__icon tc-notice__icon--${n.kind}`}>
              {NOTICE_ICON[n.kind]}
            </span>
            <span className="tc-notice__main">
              <strong>{n.title}</strong>
              {n.body && <span>{n.body}</span>}
              <time>{shortWhen(n.createdAt)}</time>
            </span>
            {!n.readAt && <i className="tc-notice__dot" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Assistente (IA)

const SUGGESTIONS: Record<string, string[]> = {
  default: [
    'Tem algo travando a loja agora?',
    'Como abro e fecho o caixa?',
    'Como cadastro um produto com foto?',
    'Como conecto a impressora da cozinha?',
    'Como emito a nota fiscal (NFC-e)?',
  ],
  '/caixa': [
    'Como faço uma sangria?',
    'Como fecho o caixa do dia?',
    'O caixa não bate, o que conferir?',
  ],
  '/cardapio': [
    'Como crio um grupo de complementos?',
    'Como deixo um item esgotado?',
    'Como monto a ficha técnica?',
  ],
  '/estoque': [
    'Como lanço a nota do fornecedor?',
    'Como faço o inventário?',
    'O que é fator de conversão?',
  ],
  '/fiscal': [
    'O que preciso para emitir NFC-e?',
    'Como envio o certificado A1?',
    'Nota rejeitada: o que fazer?',
  ],
  '/impressao': [
    'Como instalo o agente de impressão?',
    'Como separo cozinha e bar?',
    'A impressora não imprime',
  ],
  '/entregas': [
    'Como desenho as áreas de entrega?',
    'Como o entregador conclui a entrega?',
    'Como pago os entregadores?',
  ],
  '/mesas': [
    'Não consigo fechar a comanda',
    'Como transfiro itens de mesa?',
    'Como divido a conta?',
    'Como edito o desenho do salão?',
  ],
  '/pedidos': [
    'Como cancelo um pedido?',
    'O que significa cada status?',
    'Como imprimo um pedido de novo?',
  ],
  '/loja-online': [
    'Como divulgo o cardápio online?',
    'Como ligo a fidelidade?',
    'Como mudo as cores da loja?',
  ],
};

function suggestionsFor(path: string) {
  const key = Object.keys(SUGGESTIONS).find((k) => k !== 'default' && path.startsWith(k));
  return SUGGESTIONS[key ?? 'default']!;
}

const REASON: Record<string, string> = {
  platform:
    'O assistente ainda não foi ligado. Assim que o suporte do Comandou ligar, ele aparece aqui.',
  tenant: 'O assistente está desligado para este restaurante. Fale com o suporte do Comandou.',
  limit:
    'O limite de uso do assistente neste mês acabou. Ele volta no próximo mês, ou fale com o suporte do Comandou para aumentar.',
};

export function UsageBar({
  used,
  limit,
  percent,
  bonus = 0,
  compact,
}: {
  used: number;
  limit: number;
  percent: number | null;
  bonus?: number;
  compact?: boolean;
}) {
  if (!limit)
    return compact ? null : (
      <div className="tc-usage">
        <small>Uso do mês: {fmtInt(used)} tokens · sem limite</small>
      </div>
    );
  const p = Math.min(100, percent ?? 0);
  const level = p >= 100 ? 'bad' : p >= 80 ? 'warn' : 'ok';
  return (
    <div
      className={`tc-usage tc-usage--${level}`}
      title={`${fmtInt(used)} de ${fmtInt(limit)} tokens`}
    >
      <div className="tc-usage__bar">
        <i style={{ width: `${Math.max(p, 2)}%` }} />
      </div>
      {!compact && (
        <small>
          Uso do mês: <b>{p.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</b> ·{' '}
          {fmtInt(used)} de {fmtInt(limit)} tokens
          {bonus > 0 && <> · +{fmtInt(bonus)} extras</>}
        </small>
      )}
    </div>
  );
}

/** Acabou o limite do mês e os tokens extras. */
function aiBlocked(u: AiUsage) {
  if (u.available !== undefined) return u.available !== null && u.available <= 0;
  return !!u.limit && u.used >= u.limit;
}

export function AiTab({ screen, onNavigate }: { screen: string; onNavigate?: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [msgs, setMsgs] = useState<AiMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState<PandaMood>('idle');
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const s = await chatApi.ai();
      setStatus(s);
      setMsgs(s.messages);
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }, [toast]);
  useEffect(() => {
    void load();
    return () => abort.current?.abort();
  }, [load]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const ask = async (q: string) => {
    const content = q.trim();
    if (!content || busy || !status?.enabled) return;
    setText('');
    setBusy(true);
    setMood('thinking');
    const now = new Date().toISOString();
    const tmpId = `ai-${Date.now()}`;
    setMsgs((m) => [
      ...m,
      { id: `u-${tmpId}`, role: 'user', content, createdAt: now },
      { id: tmpId, role: 'assistant', content: '', createdAt: now, streaming: true },
    ]);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const done = await askAi(
        content,
        screen,
        (d) => {
          setMood('talking');
          setMsgs((m) => m.map((x) => (x.id === tmpId ? { ...x, content: x.content + d } : x)));
        },
        ctrl.signal,
      );
      setMsgs((m) =>
        m.map((x) =>
          x.id === tmpId ? { ...x, id: done.id, content: done.content, streaming: false } : x,
        ),
      );
      setStatus((s) =>
        s
          ? {
              ...s,
              usage: done.usage,
              enabled: !aiBlocked(done.usage),
              reason: aiBlocked(done.usage) ? 'limit' : s.reason,
            }
          : s,
      );
      setMood('happy');
      setTimeout(() => setMood('idle'), 1600);
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setMsgs((m) =>
          m.map((x) =>
            x.id === tmpId ? { ...x, streaming: false, content: x.content || '(parei aqui)' } : x,
          ),
        );
        setMood('idle');
      } else {
        const msg = e instanceof ApiError ? e.message : 'Não consegui responder agora.';
        setMsgs((m) =>
          m.map((x) =>
            x.id === tmpId ? { ...x, streaming: false, error: true, content: msg } : x,
          ),
        );
        setMood('sad');
        setTimeout(() => setMood('idle'), 2500);
        if (e instanceof ApiError && (e.status === 429 || e.status === 503)) void load();
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(text);
    }
  };

  const name = status?.name ?? 'Comandinho';
  const off = status && !status.enabled;

  return (
    <div className="tc-page tc-ai">
      <header className="tc-ai__head">
        <LivePanda size={46} mood={off ? 'sleep' : mood} title={name} />
        <div className="tc-ai__who">
          <strong>{name}</strong>
          <small>
            {busy ? (mood === 'thinking' ? 'pensando…' : 'escrevendo…') : 'seu guia no Comandou'}
          </small>
        </div>
        <span className="tc-spacer" />
        {msgs.length > 0 && !busy && (
          <button
            className="tc-icon"
            title="Nova conversa"
            aria-label="Nova conversa"
            onClick={async () => {
              if (!confirm('Começar uma conversa nova? A atual será apagada.')) return;
              await chatApi.aiClear().catch(() => undefined);
              setMsgs([]);
            }}
          >
            <MessageSquarePlus size={18} />
          </button>
        )}
      </header>
      {status && <UsageBar {...status.usage} />}
      <div className="tc-ai__scroll" ref={scroller}>
        {off ? (
          <div className="tc-page__empty">
            <LivePanda size={96} mood="sleep" />
            <p>{name} está descansando</p>
            <small>{REASON[status.reason ?? 'platform']}</small>
          </div>
        ) : msgs.length === 0 ? (
          <div className="tc-ai__hello">
            <LivePanda size={104} mood={mood === 'idle' ? 'happy' : mood} />
            <p>
              Oi! Eu sou o <b>{name}</b>. Pergunte qualquer coisa sobre o Comandou que eu te guio
              passo a passo.
            </p>
            <div className="tc-ai__chips">
              {suggestionsFor(screen).map((s) => (
                <button key={s} className="tc-chip has" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          msgs.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="tc-msg is-mine">
                <div className="tc-bubble">
                  <span className="tc-bubble__text">{m.content}</span>
                </div>
              </div>
            ) : (
              <div key={m.id} className={`tc-ai__answer ${m.error ? 'is-error' : ''}`}>
                <LivePanda size={28} mood={m.streaming ? 'talking' : 'idle'} still={!m.streaming} />
                <div className="tc-ai__text">
                  {m.content ? (
                    <Markdown text={m.content} onNavigate={onNavigate} />
                  ) : (
                    <span className="tc-typing tc-typing--inline">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                  {m.streaming && m.content && <span className="tc-caret" />}
                  {m.error && (
                    <button
                      className="tc-link"
                      onClick={() => {
                        const prev = msgs[msgs.findIndex((x) => x.id === m.id) - 1];
                        setMsgs((cur) => cur.filter((x) => x.id !== m.id && x.id !== prev?.id));
                        if (prev) void ask(prev.content);
                      }}
                    >
                      <RotateCcw size={13} /> Tentar de novo
                    </button>
                  )}
                </div>
              </div>
            ),
          )
        )}
      </div>
      <footer className="tc-composer">
        <div className="tc-composer__row">
          <textarea
            ref={area}
            className="tc-input"
            rows={1}
            placeholder={off ? 'Assistente indisponível' : `Pergunte ao ${name}…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            maxLength={2000}
            disabled={!!off}
            aria-label="Pergunta para o assistente"
          />
          {busy ? (
            <button
              className="tc-send tc-send--stop"
              onClick={() => abort.current?.abort()}
              aria-label="Parar"
            >
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              className="tc-send"
              onClick={() => ask(text)}
              disabled={!text.trim() || !!off}
              aria-label="Perguntar"
            >
              <SendHorizontal size={19} />
            </button>
          )}
        </div>
        <small className="tc-ai__note">
          O assistente pode errar. Confira antes de mudar algo importante.
        </small>
      </footer>
    </div>
  );
}
