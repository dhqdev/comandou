import { CLIENT_STEPS, kindLabel, TICKET_KINDS, TICKET_LEVELS } from '@comandou/shared';
import { ArrowLeft, LifeBuoy, Plus, Send } from 'lucide-react';
import { CSSProperties, FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Alert,
  Button,
  EmptyState,
  Modal,
  Select,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import type { Prepared } from '../features/store-chat/chat-media';
import { AttachPicker, EventLine, FileGrid } from '../features/tickets/TicketParts';
import {
  type TicketEvent,
  type TicketFile,
  uploadTicketFile,
  when,
} from '../features/tickets/ticket-api';
import { api } from '../lib/api';

interface Item {
  id: string;
  number: number;
  code: string;
  title: string;
  kind: string;
  urgency: string;
  step: number;
  statusLabel: string;
  done: boolean;
  unread: number;
  openedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Detail extends Item {
  description: string;
  page: string | null;
  decisionNote: string | null;
  events: TicketEvent[];
  files: TicketFile[];
}

const BASE = '/support/tickets';

/**
 * Chamados do restaurante: conta para a equipe do Comandou o que não funciona ou o que falta, com
 * fotos e vídeos, e acompanha cada passo até ficar resolvido.
 */
export function TicketsPage() {
  const { id } = useParams();
  return id ? <TicketView id={id} /> : <TicketList />;
}

function TicketList() {
  const nav = useNavigate();
  const [list, setList] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => {
    api<Item[]>(BASE)
      .then((l) => (setList(l), setError(null)))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 20_000);
    return () => clearInterval(t);
  }, [load]);
  // Cancelados e recusados saem do quadro; o resolvido fica na última coluna.
  const off = (t: Item) => t.done && t.statusLabel !== 'Resolvido';
  const board = list?.filter((t) => !off(t)) ?? [];
  const closed = list?.filter(off) ?? [];
  return (
    <div className="tk-page tk-page--wide">
      <div className="tk-page__head">
        <div>
          <h1 className="page-title">Chamados</h1>
          <p className="page-sub">
            Achou um problema ou quer uma melhoria? Conte para a gente, com foto ou vídeo, e
            acompanhe aqui.
          </p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
          Abrir chamado
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {!list && !error && <Spinner />}
      {list && list.length === 0 && (
        <EmptyState
          icon={<LifeBuoy />}
          title="Nenhum chamado ainda"
          description="Quando algo não funcionar como deveria, abra um chamado. Você acompanha cada etapa até ficar resolvido."
          action={
            <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              Abrir chamado
            </Button>
          }
        />
      )}
      {board.length > 0 && <ClientBoard items={board} onOpen={(t) => nav(`/chamados/${t.id}`)} />}
      {closed.length > 0 && (
        <>
          <h2 className="tk-block__label" style={{ margin: '8px 0 0' }}>
            Cancelados e recusados
          </h2>
          <TicketItems items={closed} onOpen={(t) => nav(`/chamados/${t.id}`)} />
        </>
      )}
      <NewTicket
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(tid) => {
          setCreating(false);
          nav(`/chamados/${tid}`);
        }}
      />
    </div>
  );
}

/** Cor de cada coluna do cliente (mesma família das etapas da esteira). */
const STEP_COLORS = ['#9aa3ae', '#6b8afd', '#f0a020', '#a78bfa', '#5b7cfa', '#2fbf71'];

/** Quadro em colunas: cada chamado aparece na etapa em que está, do Recebido ao Resolvido. */
function ClientBoard({ items, onOpen }: { items: Item[]; onOpen: (t: Item) => void }) {
  return (
    <div className="tk-board tk-board--client" role="list" aria-label="Andamento dos chamados">
      {CLIENT_STEPS.map((step, i) => {
        const col = items
          .filter((t) => t.step === i)
          .sort((a, z) => z.unread - a.unread || z.updatedAt.localeCompare(a.updatedAt));
        return (
          <section
            key={step}
            className="tk-col"
            role="listitem"
            aria-label={`${step}: ${col.length}`}
            style={{ '--tk-c': STEP_COLORS[i] } as CSSProperties}
          >
            <header className="tk-col__head">
              <div className="tk-col__title">
                {step}
                <span className="tk-col__n">{col.length}</span>
              </div>
            </header>
            <div className="tk-col__body">
              {col.length === 0 ? (
                <div className="tk-col__empty">Nenhum chamado</div>
              ) : (
                col.map((t) => (
                  <button key={t.id} type="button" className="tk-card" onClick={() => onOpen(t)}>
                    <span className="tk-card__title">{t.title}</span>
                    <span className="tk-card__client">{kindLabel(t.kind)}</span>
                    {t.statusLabel !== step && (
                      <span className="tk-card__row">
                        <StatusPill label={t.statusLabel} step={t.step} done={t.done} />
                      </span>
                    )}
                    <span className="tk-card__foot">
                      <span className="tk-code">{t.code}</span>
                      {t.unread > 0 ? (
                        <span className="tk-unread" title="Mensagens novas">
                          {t.unread}
                        </span>
                      ) : (
                        <span>{when(t.updatedAt)}</span>
                      )}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TicketItems({ items, onOpen }: { items: Item[]; onOpen: (t: Item) => void }) {
  return (
    <ul className="tk-list">
      {items.map((t) => (
        <li key={t.id}>
          <button type="button" className="tk-item" onClick={() => onOpen(t)}>
            <span className="tk-item__title">{t.title}</span>
            <span className="tk-item__meta">
              {t.code} · {kindLabel(t.kind)} · aberto em {when(t.createdAt)}
              {t.openedBy ? ` por ${t.openedBy}` : ''}
            </span>
            <span className="tk-item__side">
              {t.unread > 0 && <span className="tk-unread">{t.unread}</span>}
              <StatusPill label={t.statusLabel} step={t.step} done={t.done} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ label, step, done }: { label: string; step: number; done: boolean }) {
  const cls =
    label === 'Resolvido'
      ? 'tk-pill--ok'
      : done
        ? ''
        : step >= 2
          ? 'tk-pill--run'
          : 'tk-pill--wait';
  return <span className={`tk-pill ${cls}`}>{label}</span>;
}

function NewTicket({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState('bug');
  const [urgency, setUrgency] = useState('medium');
  const [files, setFiles] = useState<Prepared[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setKind('bug');
    setUrgency('medium');
    setFiles([]);
  }, [open]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy('Abrindo…');
    try {
      const r = await api<{ id: string }>(BASE, {
        method: 'POST',
        json: { title, description, kind, urgency },
      });
      let failed = 0;
      for (let i = 0; i < files.length; i++) {
        setBusy(`Enviando anexo ${i + 1} de ${files.length}…`);
        await uploadTicketFile(BASE, r.id, files[i]!).catch(() => failed++);
      }
      toast(
        failed ? `Chamado aberto, mas ${failed} anexo(s) não subiram` : 'Chamado aberto',
        failed ? 'danger' : 'success',
      );
      onCreated(r.id);
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Abrir chamado"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={!!busy}>
            Cancelar
          </Button>
          <Button type="submit" form="tk-new" loading={!!busy} disabled={title.trim().length < 3}>
            {busy ?? 'Enviar chamado'}
          </Button>
        </>
      }
    >
      <form id="tk-new" className="tk-form" onSubmit={submit}>
        <TextField
          label="Resumo"
          placeholder="Ex.: o caixa não fecha quando tem sangria"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
        />
        <div className="tk-form__two">
          <div className="cm-field">
            <label className="cm-label" htmlFor="tk-kind">
              Assunto
            </label>
            <Select id="tk-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {TICKET_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="cm-field">
            <label className="cm-label" htmlFor="tk-urgency">
              Quanto atrapalha
            </label>
            <Select id="tk-urgency" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              {TICKET_LEVELS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.id === 'critical' ? 'Crítica (parou a operação)' : l.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="cm-field">
          <label className="cm-label" htmlFor="tk-desc">
            O que aconteceu
          </label>
          <textarea
            id="tk-desc"
            className="cm-input"
            rows={6}
            maxLength={8000}
            placeholder="Conte o passo a passo: em qual tela, o que você fez, o que esperava e o que apareceu."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <AttachPicker files={files} onChange={setFiles} />
      </form>
    </Modal>
  );
}

function TicketView({ id }: { id: string }) {
  const nav = useNavigate();
  const toast = useToast();
  const [t, setT] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Prepared[]>([]);
  const [sending, setSending] = useState(false);
  const load = useCallback(() => {
    api<Detail>(`${BASE}/${id}`)
      .then((d) => (setT(d), setError(null)))
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() && !files.length) return;
    setSending(true);
    try {
      const ids: string[] = [];
      for (const f of files) ids.push((await uploadTicketFile(BASE, id, f)).id);
      await api(`${BASE}/${id}/messages`, { method: 'POST', json: { body: text, fileIds: ids } });
      setText('');
      setFiles([]);
      load();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setSending(false);
    }
  }

  async function cancel() {
    if (!confirm('Cancelar este chamado?')) return;
    try {
      await api(`${BASE}/${id}/cancel`, { method: 'POST' });
      load();
    } catch (err) {
      toast((err as Error).message, 'danger');
    }
  }

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!t) return <Spinner />;
  const opening = t.files.filter((f) => f.eventId === null);
  const off = t.statusLabel === 'Não será feito' || t.statusLabel === 'Cancelado';
  return (
    <div className="tk-page">
      <div className="tk-page__head">
        <div>
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft size={16} />}
            onClick={() => nav('/chamados')}
          >
            Chamados
          </Button>
          <h1 className="page-title" style={{ marginTop: 6 }}>
            {t.title}
          </h1>
          <p className="page-sub">
            {t.code} · {kindLabel(t.kind)} · aberto em {when(t.createdAt)}
            {t.openedBy ? ` por ${t.openedBy}` : ''}
          </p>
        </div>
        <StatusPill label={t.statusLabel} step={t.step} done={t.done} />
      </div>
      <ol className="tk-steps" data-off={off} aria-label="Andamento">
        {CLIENT_STEPS.map((s, i) => (
          <li key={s} data-on={i <= t.step}>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      {t.decisionNote && <Alert tone="info">Motivo: {t.decisionNote}</Alert>}
      <div className="tk-detail">
        {t.description && <p className="tk-desc">{t.description}</p>}
        <FileGrid files={opening} />
        <ul className="tk-thread">
          {t.events.map((e) => (
            <EventLine
              key={e.id}
              e={e}
              files={t.files.filter((f) => f.eventId === e.id)}
              mine={e.actor === 'client'}
            />
          ))}
        </ul>
        <form className="tk-compose" onSubmit={send}>
          <textarea
            className="cm-input"
            rows={3}
            maxLength={4000}
            aria-label="Mensagem"
            placeholder="Escreva para a equipe do Comandou…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="tk-compose__row">
            <AttachPicker files={files} onChange={setFiles} label="Foto ou vídeo" />
            <div style={{ display: 'flex', gap: 8 }}>
              {t.step <= 2 && !t.done && (
                <Button variant="ghost" onClick={() => void cancel()}>
                  Cancelar chamado
                </Button>
              )}
              <Button
                type="submit"
                icon={<Send size={15} />}
                loading={sending}
                disabled={!text.trim() && !files.length}
              >
                Enviar
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
