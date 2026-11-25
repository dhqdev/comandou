import {
  Image as ImageIcon,
  Loader2,
  Megaphone,
  MessageCircle,
  Pin,
  PinOff,
  SendHorizontal,
  Smile,
  SmilePlus,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bone, useToast } from '../../design-system';
import { mediaUrl } from '../../lib/media';
import { useRealtimeEvents } from '../../lib/realtime';
import { EmojiPanel, MediaViewer } from '../store-chat/ChatKit';
import { chatApi, Post, PostComment, REACTIONS, uploadChatImage } from './chat-api';
import { Avatar, keepFocus, timeAgo } from './util';

let localSeq = 0;

/** Links clicáveis no texto do recado, sem HTML cru. */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer noopener">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}

/** Campo que cresce com o texto (até ~6 linhas). */
function useGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, max = 150) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [ref, value, max]);
}

/** Liga/desliga a reação de quem vê (igual ao servidor). */
function flipReaction(p: Post, emoji: string, me: string): Post {
  const users = p.reactions[emoji] ?? [];
  const next = users.includes(me) ? users.filter((u) => u !== me) : [...users, me];
  const reactions = { ...p.reactions, [emoji]: next };
  if (!next.length) delete reactions[emoji];
  return { ...p, reactions };
}

/**
 * Mural da equipe no jeito de rede social: quem vê escreve no topo, cada recado vem como uma
 * publicação (autor, texto, foto), com reações e comentários. Tudo aparece na hora (publicar,
 * reagir, comentar) e o servidor confirma por trás; fixados ficam em cima.
 */
export function MuralTab({
  me,
  myName,
  canPin,
  pollMs,
}: {
  me: string;
  myName: string | null;
  canPin: boolean;
  pollMs: number;
}) {
  const toast = useToast();
  const [posts, setPosts] = useState<Post[] | null>(null);
  // Comentários completos dos recados abertos (sem isso, só os 2 últimos que vêm com o recado).
  const [threads, setThreads] = useState<Record<string, PostComment[]>>({});
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [viewer, setViewer] = useState<string | null>(null);
  const open = useRef(new Set<string>());

  const load = useCallback(async () => {
    const list = await chatApi.posts().catch(() => null);
    if (!list) return setPosts((p) => p ?? []);
    setPosts((cur) => [...(cur ?? []).filter((p) => p.pending), ...list]);
    const ids = [...open.current].filter((id) => list.some((p) => p.id === id));
    const more = await Promise.all(ids.map((id) => chatApi.comments(id).catch(() => null)));
    setThreads((t) => {
      const next = { ...t };
      ids.forEach((id, i) => {
        const got = more[i];
        if (got) next[id] = [...got, ...(t[id] ?? []).filter((c) => c.pending)];
      });
      return next;
    });
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => !document.hidden && load(), pollMs * 2);
    return () => clearInterval(t);
  }, [load, pollMs]);
  useRealtimeEvents((e) => {
    if (e.type === 'chat.mural') void load();
  }, false);

  const mark = (id: string) => setFresh((f) => new Set(f).add(id));
  const patch = (id: string, fn: (p: Post) => Post) =>
    setPosts((cur) => cur?.map((p) => (p.id === id ? fn(p) : p)) ?? cur);

  const publish = async (body: string, imageId: string | null) => {
    const tempId = `local-${++localSeq}`;
    const temp: Post = {
      id: tempId,
      authorId: me,
      authorName: myName,
      authorRole: null,
      body,
      imageId,
      pinned: false,
      reactions: {},
      createdAt: new Date().toISOString(),
      commentCount: 0,
      comments: [],
      pending: true,
    };
    mark(tempId);
    setPosts((cur) => {
      const list = cur ?? [];
      const pinned = list.filter((p) => p.pinned);
      return [...pinned, temp, ...list.filter((p) => !p.pinned)];
    });
    try {
      const saved = await chatApi.newPost(body, imageId);
      mark(saved.id);
      setPosts(
        (cur) =>
          cur
            ?.map((p) => (p.id === tempId ? saved : p))
            .filter((p, i, a) => a.findIndex((x) => x.id === p.id) === i) ?? cur,
      );
      return true;
    } catch (e) {
      setPosts((cur) => cur?.filter((p) => p.id !== tempId) ?? cur);
      toast((e as Error).message, 'danger');
      return false;
    }
  };

  const react = async (p: Post, emoji: string) => {
    patch(p.id, (x) => flipReaction(x, emoji, me));
    try {
      await chatApi.reactPost(p.id, emoji);
    } catch (e) {
      patch(p.id, (x) => flipReaction(x, emoji, me));
      toast((e as Error).message, 'danger');
    }
  };

  const pin = async (p: Post) => {
    const pinned = !p.pinned;
    patch(p.id, (x) => ({ ...x, pinned }));
    try {
      await chatApi.pinPost(p.id, pinned);
      void load();
    } catch (e) {
      patch(p.id, (x) => ({ ...x, pinned: !pinned }));
      toast((e as Error).message, 'danger');
    }
  };

  const remove = async (p: Post) => {
    if (!confirm('Apagar este recado?')) return;
    const before = posts;
    setPosts((cur) => cur?.filter((x) => x.id !== p.id) ?? cur);
    try {
      await chatApi.removePost(p.id);
    } catch (e) {
      setPosts(before);
      toast((e as Error).message, 'danger');
    }
  };

  const showAll = async (p: Post) => {
    open.current.add(p.id);
    if (threads[p.id] || p.commentCount <= p.comments.length) {
      setThreads((t) => (t[p.id] ? t : { ...t, [p.id]: p.comments }));
      return;
    }
    try {
      const all = await chatApi.comments(p.id);
      setThreads((t) => ({ ...t, [p.id]: all }));
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  const comment = async (p: Post, body: string) => {
    const temp: PostComment = {
      id: `local-${++localSeq}`,
      postId: p.id,
      authorId: me,
      authorName: myName,
      body,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    mark(temp.id);
    const add = (list: PostComment[], c: PostComment) => [...list, c];
    patch(p.id, (x) => ({
      ...x,
      commentCount: x.commentCount + 1,
      comments: add(x.comments, temp),
    }));
    setThreads((t) => (t[p.id] ? { ...t, [p.id]: add(t[p.id]!, temp) } : t));
    const swap = (list: PostComment[], c: PostComment | null) =>
      c ? list.map((x) => (x.id === temp.id ? c : x)) : list.filter((x) => x.id !== temp.id);
    try {
      const saved = await chatApi.comment(p.id, body);
      mark(saved.id);
      patch(p.id, (x) => ({ ...x, comments: swap(x.comments, saved) }));
      setThreads((t) => (t[p.id] ? { ...t, [p.id]: swap(t[p.id]!, saved) } : t));
      return true;
    } catch (e) {
      patch(p.id, (x) => ({
        ...x,
        commentCount: x.commentCount - 1,
        comments: swap(x.comments, null),
      }));
      setThreads((t) => (t[p.id] ? { ...t, [p.id]: swap(t[p.id]!, null) } : t));
      toast((e as Error).message, 'danger');
      return false;
    }
  };

  const removeComment = async (p: Post, c: PostComment) => {
    if (!confirm('Apagar este comentário?')) return;
    const drop = (list: PostComment[]) => list.filter((x) => x.id !== c.id);
    patch(p.id, (x) => ({ ...x, commentCount: x.commentCount - 1, comments: drop(x.comments) }));
    setThreads((t) => (t[p.id] ? { ...t, [p.id]: drop(t[p.id]!) } : t));
    try {
      await chatApi.removeComment(c.id);
      void load();
    } catch (e) {
      toast((e as Error).message, 'danger');
      void load();
    }
  };

  return (
    <div className="tc-page tm">
      <header className="tc-page__head">
        <Megaphone size={18} />
        <div>
          <strong>Mural da equipe</strong>
          <small>Recados, fotos e novidades para todo mundo. Reaja e comente.</small>
        </div>
      </header>
      <div className="tm__scroll">
        <div className="tm__feed">
          <Composer me={me} myName={myName} onPublish={publish} />
          {posts === null &&
            [0, 1].map((i) => (
              <div key={i} className="tm-post tm-post--ghost" aria-hidden>
                <span className="tm-post__head">
                  <Bone w={42} h={42} r="full" />
                  <Bone w={i ? '34%' : '46%'} h={13} />
                </span>
                <Bone w="88%" />
                <Bone w={i ? '52%' : '70%'} />
              </div>
            ))}
          {posts?.length === 0 && (
            <div className="tm__empty">
              <Megaphone size={28} aria-hidden />
              <strong>Nenhum recado ainda</strong>
              <p>Escreva o primeiro: um aviso, uma foto do prato novo ou um parabéns.</p>
            </div>
          )}
          {posts?.map((p) => (
            <PostCard
              key={p.id}
              p={p}
              me={me}
              myName={myName}
              canPin={canPin}
              fresh={fresh}
              thread={threads[p.id] ?? null}
              onReact={(e) => void react(p, e)}
              onPin={() => void pin(p)}
              onRemove={() => void remove(p)}
              onShowAll={() => void showAll(p)}
              onComment={(body) => comment(p, body)}
              onRemoveComment={(c) => void removeComment(p, c)}
              onOpen={setViewer}
            />
          ))}
        </div>
      </div>
      <MediaViewer
        item={viewer ? { kind: 'image', url: viewer } : null}
        onClose={() => setViewer(null)}
      />
    </div>
  );
}

/** Escrever um recado: o campo cresce, foto e emojis embaixo, "Publicar" à direita. */
function Composer({
  me,
  myName,
  onPublish,
}: {
  me: string;
  myName: string | null;
  onPublish: (body: string, imageId: string | null) => Promise<boolean>;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useGrow(area, text, 220);
  useEffect(() => {
    if (!emoji) return;
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setEmoji(false);
    };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [emoji]);
  const ready = !!text.trim() && !uploading;
  const submit = async () => {
    if (!ready) return;
    const body = text.trim();
    const img = image;
    setText('');
    setImage(null);
    setEmoji(false);
    if (!(await onPublish(body, img))) {
      setText(body);
      setImage(img);
    }
  };
  const insert = (s: string) => {
    const el = area.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + s + text.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.selectionStart = el.selectionEnd = start + s.length;
    });
  };
  return (
    <div className="tm-new" ref={box} data-open={!!text || !!image || undefined}>
      <div className="tm-new__row">
        <Avatar name={myName} seed={me} size={42} />
        <textarea
          ref={area}
          rows={1}
          placeholder="O que a equipe precisa saber?"
          aria-label="Novo recado"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
          }}
        />
      </div>
      {(image || uploading) && (
        <div className="tm-new__img">
          {image ? <img src={mediaUrl(image)!} alt="Foto do recado" /> : <Loader2 size={20} />}
          {image && (
            <button type="button" onClick={() => setImage(null)} aria-label="Tirar foto">
              <X size={16} />
            </button>
          )}
        </div>
      )}
      {emoji && <EmojiPanel onPick={insert} />}
      <div className="tm-new__bar">
        <button
          type="button"
          className="tm-tool"
          onClick={() => file.current?.click()}
          disabled={uploading}
        >
          <ImageIcon size={19} /> Foto
        </button>
        <button
          type="button"
          className="tm-tool"
          data-on={emoji || undefined}
          aria-expanded={emoji}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => setEmoji((v) => !v)}
        >
          <Smile size={19} /> Emoji
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
            setUploading(true);
            try {
              setImage(await uploadChatImage(f));
            } catch (err) {
              toast((err as Error).message, 'danger');
            } finally {
              setUploading(false);
            }
          }}
        />
        <span className="tc-spacer" />
        <button type="button" className="tm-publish" onClick={submit} disabled={!ready}>
          Publicar
        </button>
      </div>
    </div>
  );
}

function PostCard({
  p,
  me,
  myName,
  canPin,
  fresh,
  thread,
  onReact,
  onPin,
  onRemove,
  onShowAll,
  onComment,
  onRemoveComment,
  onOpen,
}: {
  p: Post;
  me: string;
  myName: string | null;
  canPin: boolean;
  fresh: ReadonlySet<string>;
  /** Todos os comentários (aberto) ou null (só os 2 últimos). */
  thread: PostComment[] | null;
  onReact: (emoji: string) => void;
  onPin: () => void;
  onRemove: () => void;
  onShowAll: () => void;
  onComment: (body: string) => Promise<boolean>;
  onRemoveComment: (c: PostComment) => void;
  onOpen: (url: string) => void;
}) {
  const [picker, setPicker] = useState(false);
  const [writing, setWriting] = useState(false);
  const pickerBox = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!picker) return;
    const off = (e: PointerEvent) => {
      if (!pickerBox.current?.contains(e.target as Node)) setPicker(false);
    };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [picker]);
  const reactions = Object.entries(p.reactions).filter(([, u]) => u.length);
  const mineReacted = reactions.some(([, u]) => u.includes(me));
  const comments = thread ?? p.comments;
  const hidden = p.commentCount - comments.length;
  const img = mediaUrl(p.imageId);
  const canDelete = p.authorId === me || canPin;
  const startComment = () => {
    setWriting(true);
    requestAnimationFrame(() => input.current?.focus());
  };
  return (
    <article
      className="tm-post"
      data-pinned={p.pinned || undefined}
      data-pending={p.pending || undefined}
      data-fresh={fresh.has(p.id) || undefined}
    >
      <header className="tm-post__head">
        <Avatar name={p.authorName} seed={p.authorId ?? p.id} size={42} />
        <div className="tm-post__who">
          <strong>{p.authorName ?? 'Alguém'}</strong>
          <small>
            {p.authorRole && <span>{p.authorRole}</span>}
            <time dateTime={p.createdAt}>{p.pending ? 'publicando…' : timeAgo(p.createdAt)}</time>
          </small>
        </div>
        {p.pinned && (
          <span className="tm-pin">
            <Pin size={13} aria-hidden /> Fixado
          </span>
        )}
        {!p.pending && (
          <span className="tm-post__menu">
            {canPin && (
              <button
                type="button"
                className="tc-icon"
                onClick={onPin}
                aria-label={p.pinned ? 'Desafixar' : 'Fixar no topo'}
                title={p.pinned ? 'Desafixar' : 'Fixar no topo'}
              >
                {p.pinned ? <PinOff size={17} /> : <Pin size={17} />}
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="tc-icon"
                onClick={onRemove}
                aria-label="Apagar recado"
                title="Apagar"
              >
                <Trash2 size={16} />
              </button>
            )}
          </span>
        )}
      </header>
      <p className="tm-post__text">
        <Linked text={p.body} />
      </p>
      {img && (
        <button
          type="button"
          className="tm-post__img"
          onClick={() => onOpen(img)}
          aria-label="Ampliar foto"
        >
          <img src={img} alt="Foto do recado" loading="lazy" decoding="async" />
        </button>
      )}
      {(reactions.length > 0 || p.commentCount > 0) && (
        <div className="tm-post__stats">
          <span className="tm-reacts">
            {reactions.map(([e, users]) => (
              <button
                key={e}
                type="button"
                data-mine={users.includes(me) || undefined}
                aria-pressed={users.includes(me)}
                aria-label={`${e} ${users.length}`}
                onClick={() => onReact(e)}
                disabled={p.pending}
              >
                <span className="tm-reacts__e">{e}</span>
                {users.length}
              </button>
            ))}
          </span>
          {p.commentCount > 0 && (
            <button type="button" className="tm-count" onClick={onShowAll}>
              {p.commentCount} {p.commentCount === 1 ? 'comentário' : 'comentários'}
            </button>
          )}
        </div>
      )}
      <div className="tm-post__actions">
        <div className="tm-react" ref={pickerBox}>
          <button
            type="button"
            className="tm-act"
            data-on={mineReacted || undefined}
            aria-expanded={picker}
            onClick={() => setPicker((v) => !v)}
            disabled={p.pending}
          >
            <SmilePlus size={18} /> Reagir
          </button>
          {picker && (
            <span className="tm-reactbar" role="menu" aria-label="Reações">
              {REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="menuitem"
                  aria-label={e}
                  data-mine={p.reactions[e]?.includes(me) || undefined}
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
        <button type="button" className="tm-act" onClick={startComment} disabled={p.pending}>
          <MessageCircle size={18} /> Comentar
        </button>
      </div>
      {(comments.length > 0 || writing) && (
        <div className="tm-comments">
          {hidden > 0 && (
            <button type="button" className="tm-more" onClick={onShowAll}>
              Ver {hidden === 1 ? 'o comentário anterior' : `os ${hidden} comentários anteriores`}
            </button>
          )}
          {comments.map((c) => (
            <div
              key={c.id}
              className="tm-c"
              data-pending={c.pending || undefined}
              data-fresh={fresh.has(c.id) || undefined}
            >
              <Avatar name={c.authorName} seed={c.authorId ?? c.id} size={32} />
              <div className="tm-c__main">
                <div className="tm-c__bubble">
                  <b>{c.authorName ?? 'Alguém'}</b>
                  <span>
                    <Linked text={c.body} />
                  </span>
                </div>
                <small>
                  <time dateTime={c.createdAt}>
                    {c.pending ? 'enviando…' : timeAgo(c.createdAt)}
                  </time>
                  {!c.pending && (c.authorId === me || canPin) && (
                    <button type="button" onClick={() => onRemoveComment(c)}>
                      Apagar
                    </button>
                  )}
                </small>
              </div>
            </div>
          ))}
          <CommentBox
            me={me}
            myName={myName}
            inputRef={input}
            onSend={onComment}
            autoFocus={writing}
          />
        </div>
      )}
    </article>
  );
}

function CommentBox({
  me,
  myName,
  inputRef,
  onSend,
  autoFocus,
}: {
  me: string;
  myName: string | null;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSend: (body: string) => Promise<boolean>;
  autoFocus: boolean;
}) {
  const [text, setText] = useState('');
  useGrow(inputRef, text, 120);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus, inputRef]);
  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    if (!(await onSend(body))) setText(body);
  };
  return (
    <div className="tm-c tm-c--new">
      <Avatar name={myName} seed={me} size={32} />
      <div className="tm-c__field">
        <textarea
          ref={inputRef}
          rows={1}
          placeholder="Escreva um comentário"
          aria-label="Comentário"
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="button"
          className="tm-c__send"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => void submit()}
          disabled={!text.trim()}
          aria-label="Enviar comentário"
        >
          <SendHorizontal size={17} />
        </button>
      </div>
    </div>
  );
}
