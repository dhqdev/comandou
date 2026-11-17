import {
  Archive,
  ArrowLeft,
  Forward,
  Inbox as InboxIcon,
  Mail,
  Paperclip,
  PenSquare,
  Reply,
  ReplyAll,
  RotateCcw,
  Search,
  ShieldAlert,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../../design-system';
import { api } from '../../lib/api';
import { useLoad } from '../OverviewPages';
import { Tag } from '../ui';
import {
  Contact,
  Draft,
  FOLDER_LABEL,
  FolderView,
  fmtSize,
  longDate,
  Mailbox,
  Message,
  Overview,
  shortDate,
  Thread,
  ThreadRow,
  who,
} from './types';

const VIEWS: FolderView[] = ['inbox', 'starred', 'sent', 'drafts', 'archive', 'spam', 'trash'];

interface ComposeSeed {
  mailboxId: string;
  draftId?: string;
  to?: string;
  cc?: string;
  subject?: string;
  text?: string;
  replyTo?: string;
  forwardOf?: string;
}

/** Caixas: pastas à esquerda, conversas no meio, a conversa aberta à direita. */
export function InboxTab({ overview, onChanged }: { overview: Overview; onChanged(): void }) {
  const boxes = overview.mailboxes.filter((m) => !m.archived);
  const [boxId, setBoxId] = useState<string | null>(boxes[0]?.id ?? null);
  const [view, setView] = useState<FolderView>('inbox');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeSeed | null>(null);
  const box = boxes.find((b) => b.id === boxId) ?? null;
  const list = useLoad<{ threads: ThreadRow[]; more: boolean }>(
    box
      ? `/platform/mail/mailboxes/${box.id}/threads?folder=${view}&page=${page}${search ? `&q=${encodeURIComponent(search)}` : ''}`
      : null,
  );
  // Caixa nova aparece: abre a primeira.
  useEffect(() => {
    if (!boxId && boxes[0]) setBoxId(boxes[0].id);
  }, [boxId, boxes]);

  /** Sobe a cada envio/rascunho: a conversa aberta recarrega junto. */
  const [version, setVersion] = useState(0);
  /** Lista e contagens (ao abrir, marcar, mover). */
  const refreshList = () => {
    list.reload();
    onChanged();
  };
  /** Depois de escrever ou responder: a conversa aberta também recarrega. */
  const refresh = () => {
    refreshList();
    setVersion((v) => v + 1);
  };

  if (!boxes.length)
    return (
      <EmptyState
        title="Nenhuma caixa de e-mail"
        description="Crie o domínio e a primeira caixa (contato@, vendas@...) em Configurar."
      />
    );

  const pick = (v: FolderView) => {
    setView(v);
    setPage(0);
    setOpen(null);
  };

  return (
    <div className={`mail ${open ? 'mail--reading' : ''}`}>
      <aside className="mail__side">
        <Button
          block
          icon={<PenSquare size={16} />}
          onClick={() => box && setCompose({ mailboxId: box.id })}
        >
          Escrever
        </Button>
        {boxes.length > 1 && (
          <select
            className="cm-input mail__box"
            aria-label="Caixa"
            value={boxId ?? ''}
            onChange={(e) => {
              setBoxId(e.target.value);
              pick('inbox');
            }}
          >
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.address}
              </option>
            ))}
          </select>
        )}
        {boxes.length === 1 && <div className="mail__address">{box?.address}</div>}
        <nav className="mail__folders" aria-label="Pastas">
          {VIEWS.map((v) => {
            const n = v === 'starred' ? null : box?.folders[v];
            const count = v === 'inbox' || v === 'spam' ? n?.unread : v === 'drafts' ? n?.total : 0;
            return (
              <button
                key={v}
                type="button"
                className="mail__folder"
                aria-current={view === v || undefined}
                onClick={() => pick(v)}
              >
                <span>{FOLDER_LABEL[v]}</span>
                {!!count && <span className="mail__count">{count}</span>}
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="mail__list" aria-label="Conversas">
        <form
          className="mail__search"
          role="search"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setSearch(q.trim());
            setPage(0);
          }}
        >
          <Search size={16} aria-hidden />
          <input
            className="mail__search-input"
            placeholder={`Buscar em ${FOLDER_LABEL[view]}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar"
          />
          {search && (
            <button
              type="button"
              className="mail__icon"
              aria-label="Limpar busca"
              onClick={() => {
                setQ('');
                setSearch('');
              }}
            >
              <X size={15} />
            </button>
          )}
        </form>
        {list.error && <Alert tone="danger">{list.error}</Alert>}
        {!list.data ? (
          <div className="mail__pad">
            <Spinner />
          </div>
        ) : !list.data.threads.length ? (
          <EmptyState
            title={search ? 'Nada encontrado' : `${FOLDER_LABEL[view]} vazia`}
            description={search ? 'Tente outras palavras.' : undefined}
          />
        ) : (
          <ul className="mail__rows">
            {list.data.threads.map((t) => (
              <li key={t.threadId}>
                <button
                  type="button"
                  className="mail__row"
                  data-unread={t.unread || undefined}
                  aria-current={open === t.threadId || undefined}
                  onClick={() =>
                    view === 'drafts'
                      ? setCompose({ mailboxId: box!.id, draftId: t.id })
                      : setOpen(t.threadId)
                  }
                >
                  <span className="mail__who">
                    {t.direction === 'out'
                      ? `Para: ${t.to.map(who).join(', ') || '(sem destinatário)'}`
                      : who(t.from)}
                    {t.count > 1 && <span className="mail__n">{t.count}</span>}
                  </span>
                  <span className="mail__when">{shortDate(t.at)}</span>
                  <span className="mail__subject">
                    {t.starred && (
                      <Star size={13} className="mail__star" aria-label="Com estrela" />
                    )}
                    {t.attachments && <Paperclip size={13} aria-label="Com anexo" />}
                    {t.subject || '(sem assunto)'}
                    {t.sendStatus === 'queued' && <Tag level="warn">Na fila</Tag>}
                    {t.sendStatus === 'failed' && <Tag level="bad">Falhou</Tag>}
                  </span>
                  <span className="mail__snippet">{t.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.data && (page > 0 || list.data.more) && (
          <div className="mail__pager">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Mais novos
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!list.data.more}
              onClick={() => setPage(page + 1)}
            >
              Mais antigos
            </Button>
          </div>
        )}
      </section>

      <section className="mail__read" aria-label="Conversa">
        {open && box ? (
          <ThreadView
            key={`${open}:${version}`}
            box={box}
            threadId={open}
            trash={view === 'trash'}
            onBack={() => setOpen(null)}
            onReply={setCompose}
            onChanged={refreshList}
            onGone={() => {
              setOpen(null);
              refreshList();
            }}
          />
        ) : (
          <div className="mail__blank">
            <InboxIcon size={28} aria-hidden />
            <span>Escolha uma conversa</span>
          </div>
        )}
      </section>

      {compose && (
        <Compose
          seed={compose}
          boxes={boxes}
          onClose={() => {
            setCompose(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ThreadView({
  box,
  threadId,
  trash,
  onBack,
  onReply,
  onChanged,
  onGone,
}: {
  box: Mailbox;
  threadId: string;
  trash: boolean;
  onBack(): void;
  onReply(s: ComposeSeed): void;
  onChanged(): void;
  onGone(): void;
}) {
  const toast = useToast();
  const t = useLoad<Thread>(
    `/platform/mail/mailboxes/${box.id}/threads/${threadId}${trash ? '?trash=1' : ''}`,
  );
  // Abrir marca como lido no servidor: atualiza as contagens.
  useEffect(() => {
    if (t.data) onChanged();
  }, [!!t.data]);
  if (t.error) return <Alert tone="danger">{t.error}</Alert>;
  if (!t.data) return <Spinner />;
  const msgs = t.data.messages;
  const last = msgs[msgs.length - 1]!;
  const ids = [last.id];
  const starred = msgs.some((m) => m.starred);

  const act = async (body: Record<string, unknown>, done: string, gone = false) => {
    try {
      await api('/platform/mail/messages/flags', { method: 'POST', json: { ids, ...body } });
      toast(done, 'success');
      if (gone) onGone();
      else {
        t.reload();
        onChanged();
      }
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };
  const destroy = async () => {
    if (!window.confirm('Apagar de vez? Não dá para desfazer.')) return;
    try {
      await api('/platform/mail/messages/delete', {
        method: 'POST',
        json: { ids: msgs.map((m) => m.id) },
      });
      toast('Apagada', 'success');
      onGone();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };
  const lastIn = [...msgs].reverse().find((m) => m.direction === 'in') ?? last;
  const replySubject = (s: string) => (/^re:/i.test(s) ? s : `Re: ${s}`);
  const reply = (all: boolean) => {
    const to =
      lastIn.direction === 'in'
        ? lastIn.replyTo || lastIn.from.email
        : lastIn.to.map((a) => a.email).join(', ');
    const cc = all
      ? [...lastIn.to, ...lastIn.cc]
          .map((a) => a.email)
          .filter((e) => e !== box.address && !to.includes(e))
          .join(', ')
      : '';
    onReply({
      mailboxId: box.id,
      to,
      cc,
      subject: replySubject(lastIn.subject),
      text: `\n\n${box.signature ? `${box.signature}\n\n` : ''}Em ${longDate(lastIn.at)}, ${who(lastIn.from)} escreveu:\n${lastIn.text
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')}`,
      replyTo: lastIn.id,
    });
  };

  return (
    <div className="mail__thread">
      <div className="mail__toolbar">
        <button
          type="button"
          className="mail__icon mail__back"
          aria-label="Voltar"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <span className="mail__spacer" />
        <button
          type="button"
          className="mail__icon"
          aria-label="Responder"
          title="Responder"
          onClick={() => reply(false)}
        >
          <Reply size={17} />
        </button>
        <button
          type="button"
          className="mail__icon"
          aria-label="Responder a todos"
          title="Responder a todos"
          onClick={() => reply(true)}
        >
          <ReplyAll size={17} />
        </button>
        <button
          type="button"
          className="mail__icon"
          aria-label="Encaminhar"
          title="Encaminhar"
          onClick={() =>
            onReply({
              mailboxId: box.id,
              subject: /^fwd?:/i.test(last.subject) ? last.subject : `Fwd: ${last.subject}`,
              text: `\n\n---------- Mensagem encaminhada ----------\nDe: ${who(last.from)} <${last.from.email}>\nData: ${longDate(last.at)}\nAssunto: ${last.subject}\n\n${last.text}`,
              forwardOf: last.id,
            })
          }
        >
          <Forward size={17} />
        </button>
        <button
          type="button"
          className="mail__icon"
          aria-label={starred ? 'Tirar a estrela' : 'Pôr estrela'}
          aria-pressed={starred}
          onClick={() => act({ starred: !starred }, starred ? 'Estrela tirada' : 'Com estrela')}
        >
          <Star size={17} className={starred ? 'mail__star' : undefined} />
        </button>
        <button
          type="button"
          className="mail__icon"
          aria-label="Marcar como não lida"
          title="Marcar como não lida"
          onClick={() => act({ read: false }, 'Marcada como não lida', true)}
        >
          <Mail size={17} />
        </button>
        {last.folder === 'inbox' || last.folder === 'sent' ? (
          <button
            type="button"
            className="mail__icon"
            aria-label="Arquivar"
            title="Arquivar"
            onClick={() => act({ folder: 'archive' }, 'Arquivada', true)}
          >
            <Archive size={17} />
          </button>
        ) : (
          <button
            type="button"
            className="mail__icon"
            aria-label="Voltar para a entrada"
            title="Voltar para a entrada"
            onClick={() => act({ folder: 'inbox' }, 'De volta à entrada', true)}
          >
            <RotateCcw size={17} />
          </button>
        )}
        {last.folder !== 'spam' && last.direction === 'in' && (
          <button
            type="button"
            className="mail__icon"
            aria-label="Marcar como spam"
            title="Spam"
            onClick={() => act({ folder: 'spam' }, 'Movida para o spam', true)}
          >
            <ShieldAlert size={17} />
          </button>
        )}
        {last.folder === 'trash' ? (
          <button
            type="button"
            className="mail__icon mail__icon--danger"
            aria-label="Apagar de vez"
            title="Apagar de vez"
            onClick={destroy}
          >
            <Trash2 size={17} />
          </button>
        ) : (
          <button
            type="button"
            className="mail__icon"
            aria-label="Lixeira"
            title="Lixeira"
            onClick={() => act({ folder: 'trash' }, 'Na lixeira', true)}
          >
            <Trash2 size={17} />
          </button>
        )}
      </div>
      <h2 className="mail__title">{t.data.subject || '(sem assunto)'}</h2>
      {msgs.map((m, i) => (
        <MessageCard
          key={m.id}
          m={m}
          open={i === msgs.length - 1 || !!m.sendError}
          onRetry={t.reload}
        />
      ))}
    </div>
  );
}

function MessageCard({
  m,
  open: initial,
  onRetry,
}: {
  m: Message;
  open: boolean;
  onRetry(): void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(initial);
  const [images, setImages] = useState(false);
  const [busy, setBusy] = useState(false);
  const authBad =
    m.auth && (m.auth.dmarc === 'fail' || (m.auth.spf === 'fail' && m.auth.dkim === 'fail'));
  const retry = async () => {
    setBusy(true);
    try {
      const r = await api<{ sent: boolean; error: string | null }>(
        `/platform/mail/messages/${m.id}/retry`,
        {
          method: 'POST',
        },
      );
      toast(r.sent ? 'Enviado' : `Ainda não saiu: ${r.error}`, r.sent ? 'success' : 'danger');
      onRetry();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="mail__msg" data-open={open || undefined}>
      <button
        type="button"
        className="mail__msg-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="mail__avatar" aria-hidden>
          {who(m.from).slice(0, 1).toUpperCase()}
        </span>
        <span className="mail__msg-who">
          <strong>{who(m.from)}</strong>
          <span className="mail__msg-addr">&lt;{m.from.email}&gt;</span>
          <span className="mail__msg-to">
            {open
              ? `para ${[...m.to, ...m.cc].map((a) => a.email).join(', ') || '—'}`
              : m.text.slice(0, 120)}
          </span>
        </span>
        <span className="mail__when">{longDate(m.at)}</span>
      </button>
      {open && (
        <div className="mail__msg-body">
          {m.sendStatus === 'queued' && (
            <Alert tone="warning">
              Na fila: o provedor não respondeu e o envio vai ser tentado de novo sozinho.
              {m.sendError ? ` (${m.sendError})` : ''}
            </Alert>
          )}
          {m.sendStatus === 'failed' && (
            <Alert tone="danger">
              Não saiu: {m.sendError}{' '}
              <Button size="sm" variant="secondary" loading={busy} onClick={retry}>
                Tentar de novo
              </Button>
            </Alert>
          )}
          {authBad && (
            <Alert tone="warning">
              O remetente não passou na conferência de autenticidade (SPF/DKIM/DMARC). Cuidado com
              links e pedidos de pagamento.
            </Alert>
          )}
          {m.hasHtml ? (
            <>
              {m.remoteImages && !images && (
                <div className="mail__images">
                  <span>
                    As imagens de fora estão escondidas (o remetente saberia que você abriu).
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setImages(true)}>
                    Mostrar imagens
                  </Button>
                </div>
              )}
              <HtmlFrame id={m.id} images={images} />
            </>
          ) : (
            <pre className="mail__text">{m.text}</pre>
          )}
          {m.attachments.filter((a) => !a.inline).length > 0 && (
            <ul className="mail__files">
              {m.attachments
                .filter((a) => !a.inline)
                .map((a) => (
                  <li key={a.id}>
                    <a
                      href={`/api/v1/platform/mail/attachments/${a.id}?download=1`}
                      download={a.filename}
                    >
                      <Paperclip size={14} aria-hidden /> {a.filename}
                      <span className="mail__file-size">{fmtSize(a.size)}</span>
                    </a>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Corpo HTML numa moldura isolada: sem scripts (nem `allow-scripts`), com a política de
 * conteúdo que o servidor põe no documento. A altura acompanha o conteúdo.
 */
function HtmlFrame({ id, images }: { id: string; images: boolean }) {
  const { data } = useLoad<{ html: string }>(
    `/platform/mail/messages/${id}/html${images ? '?images=1' : ''}`,
  );
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const fit = () => {
    const doc = ref.current?.contentDocument;
    if (doc?.body) setHeight(Math.min(Math.max(doc.documentElement.scrollHeight, 80), 20000));
  };
  if (!data) return <Spinner />;
  return (
    <iframe
      ref={ref}
      title="Conteúdo do e-mail"
      className="mail__frame"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={data.html}
      style={{ height }}
      onLoad={() => {
        fit();
        // Imagens que terminam de carregar depois mudam a altura.
        setTimeout(fit, 400);
        setTimeout(fit, 1500);
      }}
    />
  );
}

function Compose({
  seed,
  boxes,
  onClose,
}: {
  seed: ComposeSeed;
  boxes: Mailbox[];
  onClose(): void;
}) {
  const toast = useToast();
  const [draftId, setDraftId] = useState<string | null>(seed.draftId ?? null);
  const [f, setF] = useState({
    mailboxId: seed.mailboxId,
    to: seed.to ?? '',
    cc: seed.cc ?? '',
    bcc: '',
    subject: seed.subject ?? '',
    text: seed.text ?? '',
  });
  const [showCc, setShowCc] = useState(!!seed.cc);
  const [files, setFiles] = useState<Draft['attachments']>([]);
  const [busy, setBusy] = useState<'send' | 'save' | 'file' | null>(null);
  const [loaded, setLoaded] = useState(!seed.draftId);
  const contacts = useLoad<Contact[]>('/platform/mail/contacts?limit=300');
  const fileInput = useRef<HTMLInputElement>(null);

  // Rascunho existente: carrega o que estava salvo.
  useEffect(() => {
    if (!seed.draftId) return;
    api<Draft>(`/platform/mail/drafts/${seed.draftId}`)
      .then((d) => {
        setF({
          mailboxId: d.mailboxId,
          to: d.to,
          cc: d.cc,
          bcc: d.bcc,
          subject: d.subject,
          text: d.text,
        });
        setShowCc(!!(d.cc || d.bcc));
        setFiles(d.attachments);
        setLoaded(true);
      })
      .catch((e: Error) => toast(e.message, 'danger'));
  }, [seed.draftId, toast]);

  /** Salva (cria na primeira vez) e devolve o id do rascunho. */
  const save = async (): Promise<string> => {
    const body = {
      ...f,
      ...(draftId ? {} : { replyTo: seed.replyTo, forwardOf: seed.forwardOf }),
    };
    const d = draftId
      ? await api<Draft>(`/platform/mail/drafts/${draftId}`, { method: 'PUT', json: body })
      : await api<Draft>('/platform/mail/drafts', { method: 'POST', json: body });
    if (!draftId) {
      setDraftId(d.id);
      setFiles(d.attachments);
    }
    return d.id;
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('send');
    try {
      const id = await save();
      const r = await api<{ sent: boolean; queued: boolean; error: string | null }>(
        `/platform/mail/drafts/${id}/send`,
        {
          method: 'POST',
        },
      );
      toast(
        r.sent
          ? 'Enviado'
          : r.queued
            ? `Na fila (vai ser tentado de novo): ${r.error ?? ''}`
            : `Não saiu: ${r.error ?? 'erro no envio'}`,
        r.sent ? 'success' : 'danger',
      );
      onClose();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  const keep = async () => {
    setBusy('save');
    try {
      await save();
      toast('Rascunho salvo', 'success');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  const attach = async (e: ChangeEvent<HTMLInputElement>) => {
    const list = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!list.length) return;
    setBusy('file');
    try {
      const id = await save();
      for (const file of list) {
        if (file.size > 15 * 1024 * 1024) {
          toast(`${file.name} passa de 15 MB`, 'danger');
          continue;
        }
        const a = await api<{ id: string; filename: string; size: number }>(
          `/platform/mail/drafts/${id}/attachments`,
          {
            method: 'POST',
            body: file,
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-File-Name': encodeURIComponent(file.name),
              'X-File-Type': file.type || 'application/octet-stream',
            },
          },
        );
        setFiles((cur) => [...cur, a]);
      }
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  const unattach = async (aid: string) => {
    if (!draftId) return;
    try {
      await api(`/platform/mail/drafts/${draftId}/attachments/${aid}`, { method: 'DELETE' });
      setFiles((cur) => cur.filter((x) => x.id !== aid));
    } catch (err) {
      toast((err as Error).message, 'danger');
    }
  };

  const discard = async () => {
    if (draftId)
      await api('/platform/mail/messages/delete', {
        method: 'POST',
        json: { ids: [draftId] },
      }).catch(() => undefined);
    onClose();
  };

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <Modal
      open
      size="lg"
      title={seed.replyTo ? 'Responder' : seed.forwardOf ? 'Encaminhar' : 'Novo e-mail'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={discard} disabled={!!busy}>
            Descartar
          </Button>
          <Button
            variant="secondary"
            onClick={keep}
            loading={busy === 'save'}
            disabled={!loaded || !!busy}
          >
            Salvar rascunho
          </Button>
          <Button
            type="submit"
            form="mail-compose"
            loading={busy === 'send'}
            disabled={!loaded || !!busy || !f.to.trim()}
          >
            Enviar
          </Button>
        </>
      }
    >
      {!loaded ? (
        <Spinner />
      ) : (
        <form id="mail-compose" className="mail__compose" onSubmit={send}>
          {boxes.length > 1 && (
            <label className="cm-field">
              <span className="cm-label">De</span>
              <select
                className="cm-input"
                value={f.mailboxId}
                onChange={set('mailboxId')}
                disabled={!!draftId}
              >
                {boxes.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.displayName ? `${b.displayName} <${b.address}>` : b.address}
                  </option>
                ))}
              </select>
            </label>
          )}
          <datalist id="mail-contacts">
            {contacts.data?.map((c) => (
              <option key={c.id} value={c.name ? `${c.name} <${c.email}>` : c.email} />
            ))}
          </datalist>
          <TextField
            label="Para"
            list="mail-contacts"
            autoFocus={!f.to}
            placeholder="nome@empresa.com, outro@empresa.com"
            value={f.to}
            onChange={set('to')}
          />
          {showCc ? (
            <>
              <TextField
                label="Cópia (Cc)"
                list="mail-contacts"
                value={f.cc}
                onChange={set('cc')}
              />
              <TextField
                label="Cópia oculta (Cco)"
                list="mail-contacts"
                hint="Quem está aqui recebe sem os outros saberem."
                value={f.bcc}
                onChange={set('bcc')}
              />
            </>
          ) : (
            <button type="button" className="mail-link" onClick={() => setShowCc(true)}>
              Adicionar Cc e Cco
            </button>
          )}
          <TextField label="Assunto" value={f.subject} onChange={set('subject')} maxLength={300} />
          <label className="cm-field">
            <span className="cm-label">Mensagem</span>
            <textarea
              className="cm-input mail__body"
              rows={12}
              value={f.text}
              autoFocus={!!f.to}
              onChange={set('text')}
            />
          </label>
          <div className="mail__attach">
            <input ref={fileInput} type="file" multiple hidden onChange={attach} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<Paperclip size={15} />}
              loading={busy === 'file'}
              onClick={() => fileInput.current?.click()}
            >
              Anexar
            </Button>
            {files.map((a) => (
              <span key={a.id} className="mail__chip">
                {a.filename} <span className="mail__file-size">{fmtSize(a.size)}</span>
                <button
                  type="button"
                  aria-label={`Tirar ${a.filename}`}
                  onClick={() => unattach(a.id)}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        </form>
      )}
    </Modal>
  );
}
