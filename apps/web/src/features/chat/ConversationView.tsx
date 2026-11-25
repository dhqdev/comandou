import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Bell,
  BellOff,
  Check,
  ChevronDown,
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
  CSSProperties,
  Fragment,
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
import { EmojiPanel, MediaViewer, Ticks } from '../store-chat/ChatKit';
import { emojiCount } from '../store-chat/emoji';
import { runInfo, useFreshKeys } from './bubbles';
import {
  chatApi,
  ConversationDetail,
  Message,
  Person,
  REACTIONS,
  uploadChatImage,
} from './chat-api';
import { Avatar, avatarColors, dayLabel, hhmm, keepFocus } from './util';

const TYPING_MS = 4500;

/** O que mandar de novo no "Tentar de novo" (a foto que já subiu não sobe outra vez). */
interface Outgoing {
  body: string;
  mentions: string[];
  replyTo: string | null;
  file?: File;
  imageId?: string | null;
  preview?: string;
}

type Status = 'sending' | 'failed' | 'sent' | 'read';

let localSeq = 0;

const coarse = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/** As que ainda estão indo ficam no fim; as outras na ordem do servidor. */
const inOrder = (list: Message[]) =>
  [...list].sort((a, b) =>
    !!a.pending === !!b.pending ? a.createdAt.localeCompare(b.createdAt) : a.pending ? 1 : -1,
  );

/**
 * Conversa da equipe em balões, no jeito do WhatsApp: as suas à direita (na cor da loja), as dos
 * outros à esquerda, com nome e avatar só em grupo e canal. Mandar não trava o campo: a mensagem
 * aparece na hora, vai para o servidor na ordem em que foi escrita e, se falhar, fica com
 * "Tentar de novo". Usa os mesmos balões do ChatKit (store-chat.css).
 */
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
  const [viewer, setViewer] = useState<string | null>(null);
  const [away, setAway] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevHeight = useRef<number | null>(null);
  // A mensagem enviada mantém a chave de quando estava indo: o balão fica no lugar quando o
  // servidor responde, sem piscar nem repetir o efeito de envio.
  const keys = useRef(new Map<string, string>());
  const outbox = useRef(new Map<string, Outgoing>());
  // Foto que acabou de ir: segue mostrando a do aparelho (sem baixar de novo nem piscar).
  const previews = useRef(new Map<string, string>());
  // Mandadas em seguida chegam na ordem em que foram escritas: cada uma espera a de antes.
  const order = useRef<Promise<void>>(Promise.resolve());
  const seenLast = useRef('');
  const keyOf = (m: Message) => keys.current.get(m.id) ?? m.id;

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
    setAway(false);
    setUnseen(0);
    stick.current = true;
    seenLast.current = '';
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

  // Fotos do aparelho liberadas ao sair da conversa.
  useEffect(() => {
    const map = previews.current;
    return () => map.forEach((url) => URL.revokeObjectURL(url));
  }, []);

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

  // Rolagem: fica no fim se já estava; ao carregar as antigas, mantém o lugar. Lendo mais acima,
  // o que chega conta no botão de descer.
  const lastKey = msgs.length ? keyOf(msgs[msgs.length - 1]!) : '';
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop = el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (stick.current) el.scrollTop = el.scrollHeight;
    else if (lastKey && seenLast.current && lastKey !== seenLast.current) setUnseen((n) => n + 1);
    seenLast.current = lastKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, typing]);

  /** Leva até a mensagem e dá um brilho rápido nela. Falso se ela não está carregada. */
  const flash = (msgId: string, smooth = false) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-msg="${msgId}"]`);
    if (!el) return false;
    stick.current = false;
    el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
    window.setTimeout(() => el.classList.remove('is-flash'), 1700);
    return true;
  };

  useEffect(() => {
    if (!focusMessage || loading) return;
    flash(focusMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  /** ✓✓ azul quando todos os outros leram (lastReadAt depois da mensagem). */
  const readBy = (m: Message) =>
    others.length > 0 && others.every((o) => o.lastReadAt && o.lastReadAt >= m.createdAt);

  /** Manda (ou manda de novo) uma mensagem que já está na tela. */
  const deliver = (tempId: string) => {
    const out = outbox.current.get(tempId);
    if (!out) return;
    setMsgs((cur) => cur.map((m) => (m.id === tempId ? { ...m, failed: false } : m)));
    const turn = order.current;
    let done = () => {};
    order.current = new Promise<void>((r) => (done = r));
    void (async () => {
      try {
        if (out.file && !out.imageId) out.imageId = await uploadChatImage(out.file);
        await turn;
        const saved = await chatApi.send(id, {
          body: out.body,
          imageId: out.imageId ?? null,
          replyTo: out.replyTo,
          mentions: out.mentions,
        });
        keys.current.set(saved.id, tempId);
        if (out.preview) previews.current.set(saved.id, out.preview);
        outbox.current.delete(tempId);
        setMsgs((cur) =>
          inOrder([...cur.filter((m) => m.id !== tempId && m.id !== saved.id), saved]),
        );
        onChanged();
      } catch (e) {
        setMsgs((cur) => cur.map((m) => (m.id === tempId ? { ...m, failed: true } : m)));
        toast((e as Error).message, 'danger');
      } finally {
        done();
      }
    })();
  };

  const send = (body: string, mentions: string[], file?: File) => {
    if (editing) {
      const before = editing;
      setEditing(null);
      setMsgs((cur) =>
        cur.map((m) =>
          m.id === before.id ? { ...m, body, editedAt: new Date().toISOString() } : m,
        ),
      );
      chatApi.edit(before.id, body).then(
        (saved) => setMsgs((cur) => cur.map((m) => (m.id === saved.id ? saved : m))),
        (e) => {
          setMsgs((cur) =>
            cur.map((m) =>
              m.id === before.id ? { ...m, body: before.body, editedAt: before.editedAt } : m,
            ),
          );
          toast((e as Error).message, 'danger');
        },
      );
      return;
    }
    const tempId = `local-${++localSeq}`;
    const preview = file ? URL.createObjectURL(file) : undefined;
    outbox.current.set(tempId, { body, mentions, replyTo: reply?.id ?? null, file, preview });
    const temp: Message = {
      id: tempId,
      conversationId: id,
      authorId: me,
      authorName: null,
      body,
      imageId: null,
      localUrl: preview,
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
    setReply(null);
    deliver(tempId);
  };

  /** Reação aparece (ou sai) na hora; se o servidor recusar, volta como estava. */
  const react = async (m: Message, emoji: string) => {
    const flip = (x: Message): Message => {
      const users = x.reactions[emoji] ?? [];
      return {
        ...x,
        reactions: {
          ...x.reactions,
          [emoji]: users.includes(me) ? users.filter((u) => u !== me) : [...users, me],
        },
      };
    };
    setMsgs((cur) => cur.map((x) => (x.id === m.id ? flip(x) : x)));
    try {
      const saved = await chatApi.react(m.id, emoji);
      setMsgs((cur) => cur.map((x) => (x.id === saved.id ? saved : x)));
    } catch (e) {
      setMsgs((cur) => cur.map((x) => (x.id === m.id ? flip(x) : x)));
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

  const group = !!conv && conv.kind !== 'direct';
  const fresh = useFreshKeys(msgs.map(keyOf), !loading, id);
  const runs = runInfo(
    msgs.map((m) => ({ author: m.authorId, at: m.createdAt, system: m.system })),
  );

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
            size={40}
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
            const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
            stick.current = gap < 80;
            setAway(gap > 240);
            if (stick.current) setUnseen(0);
          }}
        >
          <div className="tc-msgs__inner">
            {more && (
              <button className="tc-more" onClick={loadOlder}>
                Carregar mensagens anteriores
              </button>
            )}
            {!loading && msgs.length === 0 && (
              <div className="tc-msgs__empty">Nenhuma mensagem ainda.</div>
            )}
            {msgs.map((m, i) => {
              const run = runs[i]!;
              const k = keyOf(m);
              const mine = m.authorId === me && !m.system;
              return (
                <Fragment key={k}>
                  {run.newDay && <div className="scx-day">{dayLabel(m.createdAt)}</div>}
                  {m.system ? (
                    <div className="scx-system" data-fresh={fresh.has(k) || undefined}>
                      {m.body}
                    </div>
                  ) : (
                    <Bubble
                      m={m}
                      src={m.localUrl ?? previews.current.get(m.id) ?? mediaUrl(m.imageId)}
                      mine={mine}
                      first={run.first}
                      group={group}
                      fresh={fresh.has(k)}
                      status={
                        !mine || m.deleted
                          ? null
                          : m.failed
                            ? 'failed'
                            : m.pending
                              ? 'sending'
                              : readBy(m)
                                ? 'read'
                                : 'sent'
                      }
                      me={me}
                      canDelete={mine || conv?.myRole === 'admin'}
                      onReply={() => {
                        setEditing(null);
                        setReply(m);
                      }}
                      onEdit={() => {
                        setReply(null);
                        setEditing(m);
                      }}
                      onDelete={() => void remove(m)}
                      onReact={(e) => void react(m, e)}
                      onRetry={() => deliver(m.id)}
                      onOpen={setViewer}
                      onJump={(target) => {
                        if (!flash(target, true))
                          toast('A mensagem respondida é mais antiga: carregue as anteriores.');
                      }}
                    />
                  )}
                </Fragment>
              );
            })}
            {typingNames.length > 0 && (
              <div className="scx-msg scx-typing" data-first aria-live="polite">
                <div className="scx-bubble">
                  <span className="scx-typing__dots" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
                <span className="scx-typing__label">
                  {typingNames.join(', ')} {typingNames.length > 1 ? 'estão' : 'está'} digitando
                </span>
              </div>
            )}
          </div>
          {away && (
            <button
              type="button"
              className="scx-down"
              aria-label={unseen ? `${unseen} mensagens novas: ir para o fim` : 'Ir para o fim'}
              onClick={() => {
                const el = scroller.current;
                if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
                setUnseen(0);
              }}
            >
              <ChevronDown size={20} />
              {unseen > 0 && <span className="scx-down__n">{unseen > 99 ? '99+' : unseen}</span>}
            </button>
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
      <MediaViewer
        item={viewer ? { kind: 'image', url: viewer } : null}
        onClose={() => setViewer(null)}
      />
    </section>
  );
}

function Bubble({
  m,
  src,
  mine,
  first,
  group,
  fresh,
  status,
  me,
  canDelete,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onRetry,
  onOpen,
  onJump,
}: {
  m: Message;
  /** Foto da mensagem (a do aparelho enquanto sobe). */
  src: string | null;
  mine: boolean;
  /** Primeira da sequência da pessoa: canto do balão e, em grupo, nome e avatar. */
  first: boolean;
  /** Grupo ou canal: mostra quem escreveu. */
  group: boolean;
  /** Acabou de chegar: entra com o efeito. */
  fresh: boolean;
  status: Status | null;
  me: string;
  canDelete: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  onRetry: () => void;
  onOpen: (url: string) => void;
  onJump: (id: string) => void;
}) {
  const [picker, setPicker] = useState(false);
  // No toque não há "passar o mouse": tocar no balão mostra as ações ao lado dele.
  const [active, setActive] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  // Reações ou ações abertas: tocar fora fecha.
  useEffect(() => {
    if (!picker && !active) return;
    const off = (e: PointerEvent) => {
      if (row.current?.contains(e.target as Node)) return;
      setPicker(false);
      setActive(false);
    };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [picker, active]);
  const reactions = Object.entries(m.reactions).filter(([, u]) => u.length);
  const img = m.deleted ? null : src;
  const big = !m.deleted && !img && !m.reply ? emojiCount(m.body) : 0;
  const other = group && !mine;
  const [bg, fg] = avatarColors(m.authorId ?? m.authorName ?? '?');
  return (
    <div
      ref={row}
      className="scx-msg tcm"
      data-msg={m.id}
      data-active={active || undefined}
      data-mine={mine || undefined}
      data-first={first || undefined}
      data-emoji={big || undefined}
      data-fresh={fresh || undefined}
      data-edited={(m.editedAt && !m.deleted) || undefined}
      data-pending={(m.pending && !m.failed) || undefined}
    >
      {other && (
        <span className="tcm__av">
          {first && <Avatar name={m.authorName} seed={m.authorId ?? undefined} size={30} />}
        </span>
      )}
      <div className="tcm__col">
        <div
          className="scx-bubble"
          data-media={img ? (m.body ? 'caption' : 'solo') : undefined}
          onClick={(e) => {
            if (!coarse() || m.deleted || m.pending) return;
            if ((e.target as HTMLElement).closest('a, button')) return;
            setActive((v) => !v);
          }}
        >
          {other && first && (
            <span className="scx-who" style={{ '--who-fg': fg, '--who-bg': bg } as CSSProperties}>
              {m.authorName ?? 'Sem nome'}
            </span>
          )}
          {m.reply && !m.deleted && (
            <button type="button" className="tcm__quote" onClick={() => onJump(m.reply!.id)}>
              <b>{m.reply.authorName ?? 'Mensagem'}</b>
              <span>{m.reply.body === null ? 'Mensagem apagada' : m.reply.body || 'Foto'}</span>
            </button>
          )}
          {img && (
            <button
              type="button"
              className="scx-media"
              onClick={() => onOpen(img)}
              aria-label="Ampliar foto"
            >
              <img src={img} alt="Foto enviada" loading="lazy" decoding="async" />
            </button>
          )}
          {m.deleted ? (
            <p className="scx-text tcm__gone">
              <Ban size={14} aria-hidden /> Mensagem apagada
              <span className="scx-meta-gap" aria-hidden />
            </p>
          ) : (
            m.body && (
              <p className="scx-text">
                {linkify(m.body)}
                {!big && <span className="scx-meta-gap" aria-hidden />}
              </p>
            )
          )}
          <span className="scx-meta">
            {m.editedAt && !m.deleted && <span className="tcm__edited">editada</span>}
            <time dateTime={m.createdAt}>{hhmm(m.createdAt)}</time>
            {status && <Ticks status={status} />}
          </span>
        </div>
        {reactions.length > 0 && (
          <div className="tcm__reacts">
            {reactions.map(([e, users]) => (
              <button
                key={e}
                type="button"
                data-mine={users.includes(me) || undefined}
                aria-pressed={users.includes(me)}
                aria-label={`${e} ${users.length}`}
                onClick={() => onReact(e)}
              >
                <span className="tcm__remoji">{e}</span>
                {users.length > 1 && <span>{users.length}</span>}
              </button>
            ))}
          </div>
        )}
        {m.failed && (
          <button type="button" className="scx-retry" onClick={onRetry}>
            <AlertCircle size={13} aria-hidden /> Não enviada. Tentar de novo
          </button>
        )}
      </div>
      {!m.deleted && !m.pending && (
        <div className="tcm__tools" data-open={picker || undefined}>
          <button
            type="button"
            onClick={() => setPicker((v) => !v)}
            aria-label="Reagir"
            aria-expanded={picker}
            title="Reagir"
          >
            <SmilePlus size={17} />
          </button>
          <button type="button" onClick={onReply} aria-label="Responder" title="Responder">
            <CornerUpLeft size={17} />
          </button>
          {mine && m.body && (
            <button type="button" onClick={onEdit} aria-label="Editar" title="Editar">
              <Pencil size={15} />
            </button>
          )}
          {canDelete && (
            <button type="button" onClick={onDelete} aria-label="Apagar" title="Apagar">
              <Trash2 size={15} />
            </button>
          )}
          {picker && (
            <span className="tcm__reactbar" role="menu" aria-label="Reações">
              {REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="menuitem"
                  aria-label={e}
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
  onSend: (body: string, mentions: string[], file?: File) => void;
}) {
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [mentions, setMentions] = useState<Person[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  // Cada envio faz o aviãozinho do botão sair e voltar (o ícone nasce de novo).
  const [flights, setFlights] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLElement>(null);
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
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [text]);
  // Emojis abertos: tocar fora do campo fecha.
  useEffect(() => {
    if (!emoji) return;
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setEmoji(false);
    };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [emoji]);

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

  const insert = (s: string) => {
    const el = area.current;
    if (!el) return setText((t) => t + s);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    setText(text.slice(0, start) + s + text.slice(end));
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + s.length;
      if (!coarse()) el.focus();
    });
  };

  /** Manda na hora e libera o campo: dá para escrever a próxima sem esperar o servidor. */
  const submit = (photo?: File) => {
    const body = text.trim();
    if (!body && !photo) return;
    const ids = mentions.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    // Com foto, o que estava escrito vai junto como legenda.
    setText('');
    setMentions([]);
    setQuery(null);
    setEmoji(false);
    if (!editing) setFlights((n) => n + 1);
    onSend(body, ids, photo);
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
      if (emoji) setEmoji(false);
      else if (query !== null) setQuery(null);
      else if (reply || editing) {
        onCancel();
        if (editing) setText('');
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) submit(f);
  };

  return (
    <footer className="scx-compose tcm-compose" ref={box}>
      {(reply || editing) && (
        <div className="tcm-ctx">
          {editing ? <Pencil size={15} aria-hidden /> : <CornerUpLeft size={15} aria-hidden />}
          <span>
            <b>{editing ? 'Editando mensagem' : `Respondendo ${reply!.authorName ?? ''}`}</b>
            <small>{(editing ?? reply)!.body || 'Foto'}</small>
          </span>
          <button
            type="button"
            className="scx-icon"
            onClick={() => {
              onCancel();
              if (editing) setText('');
            }}
            aria-label="Cancelar"
          >
            <X size={17} />
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
      {emoji && <EmojiPanel onPick={insert} />}
      <div className="scx-compose__row">
        {!editing && (
          <button
            type="button"
            className="scx-icon"
            onClick={() => file.current?.click()}
            aria-label="Enviar foto"
            title="Enviar foto"
          >
            <ImageIcon size={21} />
          </button>
        )}
        <input ref={file} type="file" accept="image/*" hidden onChange={onFile} />
        <div className="scx-field">
          <textarea
            ref={area}
            rows={1}
            placeholder="Mensagem"
            value={text}
            onChange={onChange}
            onKeyDown={onKey}
            maxLength={4000}
            aria-label="Mensagem"
          />
          <button
            type="button"
            className="scx-icon scx-icon--in"
            data-on={emoji || undefined}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => setEmoji((v) => !v)}
            aria-label="Emojis"
            aria-expanded={emoji}
            title="Emojis"
          >
            <Smile size={21} />
          </button>
        </div>
        <button
          type="button"
          className="scx-send"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => submit()}
          disabled={!text.trim()}
          aria-label={editing ? 'Salvar' : 'Enviar'}
        >
          {editing ? (
            <Check size={20} />
          ) : (
            <SendHorizontal
              key={flights}
              size={20}
              className="scx-send__icon"
              data-fly={flights > 0 || undefined}
              aria-hidden
            />
          )}
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
