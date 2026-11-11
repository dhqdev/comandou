import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  CornerUpLeft,
  Image as ImageIcon,
  Info,
  LogOut,
  Pencil,
  Pin,
  PinOff,
  SendHorizontal,
  Smile,
  SmilePlus,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  ChangeEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useToast } from '../../design-system';
import { mediaUrl } from '../../lib/media';
import { useRealtimeEvents } from '../../lib/realtime';
import {
  chatApi,
  ConversationDetail,
  Message,
  Person,
  REACTIONS,
  uploadChatImage,
} from './chat-api';
import { Avatar, dayKey, dayLabel, EMOJIS, hhmm } from './util';

const TYPING_MS = 4500;

export function ConversationView({
  id,
  me,
  people,
  onBack,
  onLeft,
  onChanged,
  pollMs,
  focusMessage,
}: {
  id: string;
  me: string;
  people: Person[];
  onBack: () => void;
  onLeft: () => void;
  onChanged: () => void;
  pollMs: number;
  focusMessage?: string | null;
}) {
  const toast = useToast();
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [info, setInfo] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevHeight = useRef<number | null>(null);

  const loadDetail = useCallback(() => {
    chatApi
      .detail(id)
      .then(setConv)
      .catch(() => onLeft());
  }, [id, onLeft]);

  const loadLatest = useCallback(async () => {
    const r = await chatApi.messages(id);
    setMsgs((cur) => {
      const older = cur.filter(
        (m) => !m.pending && r.messages.length && m.createdAt < r.messages[0]!.createdAt,
      );
      const pending = cur.filter((m) => m.pending);
      return [...older, ...r.messages, ...pending];
    });
    setMore((m) => (msgs.length ? m : r.more));
    void chatApi.read(id).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    setConv(null);
    setMsgs([]);
    setLoading(true);
    setReply(null);
    setEditing(null);
    setInfo(false);
    stick.current = true;
    loadDetail();
    chatApi
      .messages(id)
      .then((r) => {
        setMsgs(r.messages);
        setMore(r.more);
        void chatApi.read(id).then(onChanged, () => undefined);
      })
      .catch(() => onLeft())
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) {
        void loadLatest().catch(() => undefined);
        loadDetail();
      }
    }, pollMs);
    return () => clearInterval(t);
  }, [loadLatest, loadDetail, pollMs]);

  useRealtimeEvents((e) => {
    if (e.type === 'chat.message' && e.conversationId === id) void loadLatest();
    if (e.type === 'chat.read' && e.conversationId === id && e.userId !== me) loadDetail();
    if (e.type === 'chat.changed' && e.conversationId === id) loadDetail();
    if (e.type === 'chat.typing' && e.conversationId === id)
      setTyping((t) => ({ ...t, [e.userId]: { name: e.name, at: Date.now() } }));
  }, false);
  // Quem parou de digitar some da linha "digitando".
  useEffect(() => {
    if (!Object.keys(typing).length) return;
    const t = setTimeout(() => {
      const now = Date.now();
      setTyping((cur) =>
        Object.fromEntries(Object.entries(cur).filter(([, v]) => now - v.at < TYPING_MS)),
      );
    }, 1000);
    return () => clearTimeout(t);
  }, [typing]);
  // Mensagem nova de quem estava digitando: tira da linha.
  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (last?.authorId && typing[last.authorId])
      setTyping(({ [last.authorId!]: _gone, ...rest }) => rest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs]);

  // Rolagem: fica no fim se já estava; ao carregar as antigas, mantém o lugar.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop = el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs, typing]);

  useEffect(() => {
    if (!focusMessage || loading) return;
    const el = scroller.current?.querySelector(`[data-msg="${focusMessage}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.classList.add('is-flash');
      stick.current = false;
    }
  }, [focusMessage, loading]);

  const loadOlder = async () => {
    const first = msgs.find((m) => !m.pending);
    if (!first) return;
    prevHeight.current = scroller.current?.scrollHeight ?? null;
    const r = await chatApi.messages(id, first.createdAt);
    setMsgs((cur) => [...r.messages, ...cur]);
    setMore(r.more);
  };

  const others = conv?.members.filter((m) => m.id !== me) ?? [];
  /** ✓✓ quando todos os outros leram (lastReadAt depois da mensagem). */
  const readBy = (m: Message) =>
    others.length > 0 && others.every((o) => o.lastReadAt && o.lastReadAt >= m.createdAt);

  const send = async (body: string, mentions: string[], imageId?: string | null) => {
    if (editing) {
      const saved = await chatApi.edit(editing.id, body);
      setMsgs((cur) => cur.map((m) => (m.id === saved.id ? saved : m)));
      setEditing(null);
      return;
    }
    const temp: Message = {
      id: `tmp-${Date.now()}`,
      conversationId: id,
      authorId: me,
      authorName: null,
      body,
      imageId: imageId ?? null,
      reply: reply ? { id: reply.id, body: reply.body, authorName: reply.authorName } : null,
      reactions: {},
      system: false,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deleted: false,
      pending: true,
    };
    stick.current = true;
    setMsgs((cur) => [...cur, temp]);
    const replyTo = reply?.id ?? null;
    setReply(null);
    try {
      const saved = await chatApi.send(id, { body, imageId, replyTo, mentions });
      setMsgs((cur) => {
        const rest = cur.filter((m) => m.id !== temp.id && m.id !== saved.id);
        return [...rest, saved].sort((a, b) =>
          a.pending === b.pending ? a.createdAt.localeCompare(b.createdAt) : a.pending ? 1 : -1,
        );
      });
      onChanged();
    } catch (e) {
      setMsgs((cur) => cur.filter((m) => m.id !== temp.id));
      toast((e as Error).message, 'danger');
      throw e;
    }
  };

  const react = async (m: Message, emoji: string) => {
    try {
      const saved = await chatApi.react(m.id, emoji);
      setMsgs((cur) => cur.map((x) => (x.id === saved.id ? saved : x)));
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  const remove = async (m: Message) => {
    if (!confirm('Apagar esta mensagem para todos?')) return;
    try {
      await chatApi.remove(m.id);
      setMsgs((cur) =>
        cur.map((x) => (x.id === m.id ? { ...x, deleted: true, body: '', imageId: null } : x)),
      );
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  const toggle = async (patch: { muted?: boolean; pinned?: boolean }) => {
    try {
      const c = await chatApi.update(id, patch);
      setConv((cur) => (cur ? { ...cur, ...c, members: cur.members } : cur));
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  const typingNames = Object.values(typing).map((t) => t.name.split(' ')[0]);
  const sub = typingNames.length
    ? `${typingNames.join(', ')} ${typingNames.length > 1 ? 'estão' : 'está'} digitando…`
    : conv?.kind === 'direct'
      ? conv.peer?.online
        ? 'online agora'
        : (conv.peer?.roleLabel ?? 'mensagem direta')
      : conv
        ? `${conv.kind === 'channel' ? 'canal' : 'grupo'} · ${conv.memberCount} ${conv.memberCount === 1 ? 'pessoa' : 'pessoas'}`
        : '';

  const mentionable = useMemo(
    () =>
      conv ? people.filter((p) => p.id !== me && conv.members.some((m) => m.id === p.id)) : [],
    [conv, people, me],
  );

  let lastDay = '';
  let lastAuthor: string | null = null;
  let lastAt = 0;
  const lastMineId = msgs.findLast((m) => m.authorId === me && !m.system && !m.deleted)?.id;

  return (
    <section className="tc-conv" aria-label={conv?.name ?? 'Conversa'}>
      <header className="tc-conv__head">
        <button className="tc-icon tc-back" onClick={onBack} aria-label="Voltar">
          <ArrowLeft size={20} />
        </button>
        <button className="tc-conv__who" onClick={() => setInfo((v) => !v)}>
          <Avatar
            name={conv?.name}
            seed={conv?.peer?.id ?? id}
            kind={conv?.kind}
            size={38}
            online={conv?.kind === 'direct' ? conv.peer?.online : undefined}
          />
          <span className="tc-conv__title">
            <strong>{conv?.name ?? '…'}</strong>
            <small className={typingNames.length ? 'is-typing' : ''}>{sub}</small>
          </span>
        </button>
        <span className="tc-spacer" />
        {conv && (
          <>
            <button
              className="tc-icon"
              onClick={() => toggle({ pinned: !conv.pinned })}
              aria-label={conv.pinned ? 'Desafixar' : 'Fixar no topo'}
              title={conv.pinned ? 'Desafixar' : 'Fixar no topo'}
            >
              {conv.pinned ? <PinOff size={18} /> : <Pin size={18} />}
            </button>
            <button
              className="tc-icon"
              onClick={() => toggle({ muted: !conv.muted })}
              aria-label={conv.muted ? 'Ativar avisos' : 'Silenciar'}
              title={conv.muted ? 'Ativar avisos' : 'Silenciar'}
            >
              {conv.muted ? <BellOff size={18} /> : <Bell size={18} />}
            </button>
            <button
              className={`tc-icon ${info ? 'is-on' : ''}`}
              onClick={() => setInfo((v) => !v)}
              aria-label="Detalhes"
              title="Detalhes"
            >
              <Info size={18} />
            </button>
          </>
        )}
      </header>

      <div className="tc-conv__body">
        <div
          className="tc-msgs"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {more && (
            <button className="tc-more" onClick={loadOlder}>
              Carregar mensagens anteriores
            </button>
          )}
          {!loading && msgs.length === 0 && (
            <div className="tc-msgs__empty">Nenhuma mensagem ainda.</div>
          )}
          {msgs.map((m) => {
            const day = dayKey(m.createdAt);
            const sep = day !== lastDay;
            lastDay = day;
            const mine = m.authorId === me && !m.system;
            // Mensagens seguidas da mesma pessoa (em até 5 min) ficam juntas, sem repetir o nome.
            const firstOfRun =
              sep ||
              m.system ||
              !!m.reply ||
              lastAuthor !== m.authorId ||
              new Date(m.createdAt).getTime() - lastAt > 300_000;
            lastAuthor = m.system ? null : m.authorId;
            lastAt = new Date(m.createdAt).getTime();
            return (
              <div key={m.id} className="tc-msg-wrap">
                {sep && <div className="tc-day">{dayLabel(m.createdAt)}</div>}
                {m.system ? (
                  <div className="tc-system">{m.body}</div>
                ) : (
                  <Bubble
                    m={m}
                    mine={mine}
                    grouped={!firstOfRun}
                    status={
                      m.id !== lastMineId
                        ? null
                        : m.pending
                          ? 'sending'
                          : readBy(m)
                            ? 'read'
                            : 'sent'
                    }
                    me={me}
                    onReply={() => {
                      setEditing(null);
                      setReply(m);
                    }}
                    onEdit={() => {
                      setReply(null);
                      setEditing(m);
                    }}
                    onDelete={() => remove(m)}
                    onReact={(e) => react(m, e)}
                    canDelete={mine || conv?.myRole === 'admin'}
                  />
                )}
              </div>
            );
          })}
          {typingNames.length > 0 && (
            <div className="tc-typing" aria-live="polite">
              <i />
              <i />
              <i />
            </div>
          )}
        </div>
        {info && conv && (
          <ConversationInfo
            conv={conv}
            me={me}
            people={people}
            onClose={() => setInfo(false)}
            onChanged={() => {
              loadDetail();
              onChanged();
            }}
            onLeft={onLeft}
          />
        )}
      </div>

      <Composer
        key={id}
        conversationId={id}
        mentionable={mentionable}
        reply={reply}
        editing={editing}
        onCancel={() => {
          setReply(null);
          setEditing(null);
        }}
        onSend={send}
      />
    </section>
  );
}

function Bubble({
  m,
  mine,
  grouped,
  status,
  me,
  onReply,
  onEdit,
  onDelete,
  onReact,
  canDelete,
}: {
  m: Message;
  mine: boolean;
  /** Continuação da mensagem anterior da mesma pessoa: sem avatar nem nome. */
  grouped: boolean;
  /** Só na última mensagem de quem vê: enviando, enviada ou lida. */
  status: 'sending' | 'sent' | 'read' | null;
  me: string;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  canDelete: boolean;
}) {
  const [picker, setPicker] = useState(false);
  const reactions = Object.entries(m.reactions).filter(([, u]) => u.length);
  const img = mediaUrl(m.imageId);
  return (
    <div
      className={`tc-msg ${mine ? 'is-mine' : ''} ${m.pending ? 'is-pending' : ''} ${grouped ? 'is-grouped' : ''}`}
      data-msg={m.id}
    >
      <div className="tc-msg__side">
        {grouped ? (
          <time className="tc-msg__at">{hhmm(m.createdAt)}</time>
        ) : (
          <Avatar name={m.authorName} seed={m.authorId ?? undefined} size={36} />
        )}
      </div>
      <div className="tc-msg__main">
        {m.reply && (
          <span className="tc-msg__reply">
            <CornerUpLeft size={12} aria-hidden />
            <b>{m.reply.authorName ?? 'Mensagem'}</b>
            <span>{m.reply.body ?? 'Mensagem apagada'}</span>
          </span>
        )}
        {!grouped && (
          <div className="tc-msg__head">
            <span className="tc-msg__who">{m.authorName ?? 'Sem nome'}</span>
            <time className="tc-msg__time">{hhmm(m.createdAt)}</time>
          </div>
        )}
        {m.deleted ? (
          <span className="tc-msg__deleted">Mensagem apagada</span>
        ) : (
          <>
            {img && (
              <a href={img} target="_blank" rel="noreferrer" className="tc-msg__img">
                <img src={img} alt="Foto enviada" loading="lazy" />
              </a>
            )}
            {m.body && (
              <span className="tc-msg__text">
                {linkify(m.body)}
                {m.editedAt && <em className="tc-msg__edited"> (editada)</em>}
              </span>
            )}
          </>
        )}
        {reactions.length > 0 && (
          <span className="tc-reacts">
            {reactions.map(([e, users]) => (
              <button
                key={e}
                className={users.includes(me) ? 'is-mine' : ''}
                onClick={() => onReact(e)}
                title={`${users.length}`}
              >
                {e} {users.length > 1 && users.length}
              </button>
            ))}
          </span>
        )}
        {status && (
          <span className={`tc-msg__status ${status === 'read' ? 'is-read' : ''}`}>
            {status === 'sending' ? <Check size={13} /> : <CheckCheck size={14} />}
            {status === 'sending' ? 'Enviando' : status === 'read' ? 'Lida' : 'Enviada'}
          </span>
        )}
      </div>
      {!m.deleted && !m.pending && (
        <div className="tc-msg__actions">
          <button onClick={() => setPicker((v) => !v)} aria-label="Reagir" title="Reagir">
            <SmilePlus size={15} />
          </button>
          <button onClick={onReply} aria-label="Responder" title="Responder">
            <CornerUpLeft size={15} />
          </button>
          {mine && m.body && (
            <button onClick={onEdit} aria-label="Editar" title="Editar">
              <Pencil size={14} />
            </button>
          )}
          {canDelete && (
            <button onClick={onDelete} aria-label="Apagar" title="Apagar">
              <Trash2 size={14} />
            </button>
          )}
          {picker && (
            <span className="tc-reactbar" onMouseLeave={() => setPicker(false)}>
              {REACTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    setPicker(false);
                    onReact(e);
                  }}
                >
                  {e}
                </button>
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Links clicáveis e @menções em destaque, sem HTML cru. */
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+|@[\p{L}][\p{L}\p{N}]*(?: [\p{Lu}][\p{L}]*)?)/u);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer noopener">
        {p}
      </a>
    ) : p.startsWith('@') ? (
      <b key={i} className="tc-mention">
        {p}
      </b>
    ) : (
      p
    ),
  );
}

function Composer({
  conversationId,
  mentionable,
  reply,
  editing,
  onCancel,
  onSend,
}: {
  conversationId: string;
  mentionable: Person[];
  reply: Message | null;
  editing: Message | null;
  onCancel: () => void;
  onSend: (body: string, mentions: string[], imageId?: string | null) => Promise<void>;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mentions, setMentions] = useState<Person[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  useEffect(() => {
    if (editing) {
      setText(editing.body);
      area.current?.focus();
    }
  }, [editing]);
  useEffect(() => {
    if (reply) area.current?.focus();
  }, [reply]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const matches =
    query === null
      ? []
      : mentionable.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setText(v);
    const caret = e.target.selectionStart ?? v.length;
    const m = /(?:^|\s)@([\p{L}\p{N}]*)$/u.exec(v.slice(0, caret));
    setQuery(m ? m[1]! : null);
    setSel(0);
    if (Date.now() - lastTyping.current > 3000 && v.trim()) {
      lastTyping.current = Date.now();
      void chatApi.typing(conversationId).catch(() => undefined);
    }
  };

  const pickMention = (p: Person) => {
    const el = area.current!;
    const caret = el.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@[\p{L}\p{N}]*$/u, `@${p.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setMentions((cur) => (cur.some((x) => x.id === p.id) ? cur : [...cur, p]));
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  const submit = async (imageId?: string) => {
    const body = text.trim();
    if ((!body && !imageId) || busy) return;
    setBusy(true);
    const ids = mentions.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    const keep = text;
    setText('');
    setMentions([]);
    setEmoji(false);
    try {
      await onSend(body, ids, imageId);
    } catch {
      setText(keep);
    } finally {
      setBusy(false);
      area.current?.focus();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => (s + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => (s - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(matches[sel]!);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (query !== null) setQuery(null);
      else if (reply || editing) {
        onCancel();
        if (editing) setText('');
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const imageId = await uploadChatImage(f);
      setBusy(false);
      await submit(imageId);
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <footer className="tc-composer">
      {(reply || editing) && (
        <div className="tc-composer__ctx">
          {editing ? <Pencil size={14} /> : <CornerUpLeft size={14} />}
          <span>
            <b>{editing ? 'Editando mensagem' : `Respondendo ${reply!.authorName ?? ''}`}</b>
            <small>{(editing ?? reply)!.body || 'Foto'}</small>
          </span>
          <button
            className="tc-icon"
            onClick={() => {
              onCancel();
              if (editing) setText('');
            }}
            aria-label="Cancelar"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {matches.length > 0 && (
        <ul className="tc-mentions" role="listbox">
          {matches.map((p, i) => (
            <li key={p.id}>
              <button
                className={i === sel ? 'is-sel' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(p);
                }}
              >
                <Avatar name={p.name} seed={p.id} size={24} />
                {p.name}
                <small>{p.roleLabel}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {emoji && (
        <div className="tc-emojis">
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => {
                setText((t) => t + e);
                area.current?.focus();
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="tc-composer__row">
        <button
          className={`tc-icon ${emoji ? 'is-on' : ''}`}
          onClick={() => setEmoji((v) => !v)}
          aria-label="Emojis"
          title="Emojis"
        >
          <Smile size={20} />
        </button>
        {!editing && (
          <button
            className="tc-icon"
            onClick={() => file.current?.click()}
            aria-label="Enviar foto"
            title="Enviar foto"
            disabled={busy}
          >
            <ImageIcon size={20} />
          </button>
        )}
        <input ref={file} type="file" accept="image/*" hidden onChange={onFile} />
        <textarea
          ref={area}
          className="tc-input"
          rows={1}
          placeholder="Mensagem"
          value={text}
          onChange={onChange}
          onKeyDown={onKey}
          maxLength={4000}
          aria-label="Mensagem"
        />
        <button
          className="tc-send"
          onClick={() => submit()}
          disabled={busy || !text.trim()}
          aria-label={editing ? 'Salvar' : 'Enviar'}
        >
          {editing ? <Check size={20} /> : <SendHorizontal size={19} />}
        </button>
      </div>
    </footer>
  );
}

function ConversationInfo({
  conv,
  me,
  people,
  onClose,
  onChanged,
  onLeft,
}: {
  conv: ConversationDetail;
  me: string;
  people: Person[];
  onClose: () => void;
  onChanged: () => void;
  onLeft: () => void;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const [name, setName] = useState(conv.name);
  const admin = conv.myRole === 'admin';
  const outside = people.filter((p) => !conv.members.some((m) => m.id === p.id));
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'success');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };
  return (
    <aside className="tc-info">
      <div className="tc-info__head">
        <strong>Detalhes</strong>
        <button className="tc-icon" onClick={onClose} aria-label="Fechar detalhes">
          <X size={16} />
        </button>
      </div>
      <div className="tc-info__hero">
        <Avatar name={conv.name} seed={conv.peer?.id ?? conv.id} kind={conv.kind} size={64} />
        {conv.kind !== 'direct' && admin ? (
          <input
            className="tc-info__name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onBlur={() =>
              name.trim() &&
              name.trim() !== conv.name &&
              run(() => chatApi.update(conv.id, { name: name.trim() }))
            }
            aria-label="Nome"
          />
        ) : (
          <strong>{conv.name}</strong>
        )}
        <small>
          {conv.kind === 'direct'
            ? conv.peer?.roleLabel
            : conv.kind === 'channel'
              ? 'Canal aberto: qualquer pessoa da equipe pode entrar'
              : 'Grupo: só quem foi adicionado'}
        </small>
      </div>
      {conv.kind !== 'direct' && (
        <>
          <div className="tc-info__section">
            {conv.members.length} {conv.members.length === 1 ? 'pessoa' : 'pessoas'}
            {(admin || conv.kind === 'channel') && outside.length > 0 && (
              <button className="tc-link" onClick={() => setAdding((v) => !v)}>
                <UserPlus size={14} /> Adicionar
              </button>
            )}
          </div>
          {adding && (
            <div className="tc-info__add">
              {outside.map((p) => (
                <label key={p.id} className="tc-check">
                  <input
                    type="checkbox"
                    checked={pick.includes(p.id)}
                    onChange={(e) =>
                      setPick((cur) =>
                        e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id),
                      )
                    }
                  />
                  <Avatar name={p.name} seed={p.id} size={26} />
                  {p.name}
                </label>
              ))}
              <button
                className="tc-btn"
                disabled={!pick.length}
                onClick={() =>
                  run(async () => {
                    await chatApi.addMembers(conv.id, pick);
                    setPick([]);
                    setAdding(false);
                  }, 'Pessoas adicionadas')
                }
              >
                Adicionar {pick.length || ''}
              </button>
            </div>
          )}
          <ul className="tc-info__members">
            {conv.members.map((m) => (
              <li key={m.id}>
                <Avatar name={m.name} seed={m.id} size={30} online={m.online} />
                <span>
                  {m.name}
                  {m.id === me && ' (você)'}
                  <small>
                    {m.roleLabel}
                    {m.admin && ' · administrador'}
                  </small>
                </span>
                {admin && m.id !== me && conv.kind === 'group' && (
                  <button
                    className="tc-icon"
                    title="Remover"
                    aria-label={`Remover ${m.name}`}
                    onClick={() => run(() => chatApi.removeMember(conv.id, m.id))}
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            className="tc-danger"
            onClick={async () => {
              if (!confirm(`Sair de "${conv.name}"?`)) return;
              try {
                await chatApi.leave(conv.id);
                onLeft();
              } catch (e) {
                toast((e as Error).message, 'danger');
              }
            }}
          >
            <LogOut size={15} /> Sair {conv.kind === 'channel' ? 'do canal' : 'do grupo'}
          </button>
        </>
      )}
    </aside>
  );
}
