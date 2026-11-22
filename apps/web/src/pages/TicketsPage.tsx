import { CLIENT_STEPS, kindLabel, levelLabel, TICKET_KINDS, TICKET_LEVELS } from '@comandou/shared';
import {
  ArrowLeft,
  Bug,
  Check,
  CircleHelp,
  Headset,
  LifeBuoy,
  Lightbulb,
  MessageSquare,
  Plus,
} from 'lucide-react';
import { CSSProperties, FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Alert,
  Button,
  EmptyState,
  Modal,
  Select,
  TextField,
  useToast,
  Skeleton,
} from '../design-system';
import type { Prepared } from '../features/store-chat/chat-media';
import { ago, TicketHistory } from '../features/tickets/TicketHistory';
import { talkAboutTicket } from '../features/chat/TeamChat';
import { AttachPicker, FileGrid } from '../features/tickets/TicketParts';
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
  const unread = list?.reduce((n, t) => n + t.unread, 0) ?? 0;
  return (
    <div className="tk-page tk-page--wide">
      <div className="tk-page__head">
        <h1 className="page-title cm-sr-only">Chamados</h1>
        <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
          Abrir chamado
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {list && list.length > 0 && (
        <div className="tk-summary" aria-label="Resumo">
          <span className="tk-summary__item">
            <b>{board.filter((t) => !t.done).length}</b> em andamento
          </span>
          <span className="tk-summary__item" data-hot={unread > 0}>
            <b>{unread}</b> {unread === 1 ? 'resposta nova' : 'respostas novas'}
          </span>
          <span className="tk-summary__item">
            <b>{list.filter((t) => t.statusLabel === 'Resolvido').length}</b>{' '}
            {list.filter((t) => t.statusLabel === 'Resolvido').length === 1
              ? 'resolvido'
              : 'resolvidos'}
          </span>
        </div>
      )}
      {!list && !error && <Skeleton />}
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
                  <button
                    key={t.id}
                    type="button"
                    className="tk-card"
                    data-unread={t.unread > 0}
                    onClick={() => onOpen(t)}
                  >
                    <span className="tk-card__kind">
                      <KindIcon kind={t.kind} />
                      {kindLabel(t.kind)}
                    </span>
                    <span className="tk-card__title">{t.title}</span>
                    {t.statusLabel !== step && (
                      <span className="tk-card__row">
                        <StatusPill label={t.statusLabel} step={t.step} done={t.done} />
                      </span>
                    )}
                    <span className="tk-card__foot">
                      {t.unread > 0 ? (
                        <span className="tk-card__new">
                          {t.unread === 1 ? '1 resposta nova' : `${t.unread} respostas novas`}
                        </span>
                      ) : (
                        <span className="tk-code">{t.code}</span>
                      )}
                      <span title={when(t.updatedAt)}>{ago(t.updatedAt)}</span>
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

function KindIcon({ kind }: { kind: string }) {
  const Icon =
    kind === 'bug'
      ? Bug
      : kind === 'improvement'
        ? Lightbulb
        : kind === 'question'
          ? CircleHelp
          : MessageSquare;
  return <Icon size={13} aria-hidden />;
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

/** O que cada passo quer dizer, em palavras de quem abriu o chamado. */
const STEP_HINTS = [
  'Chegou para a equipe do Comandou.',
  'Estamos entendendo o que você precisa.',
  'Aprovado e na fila para ser feito.',
  'A equipe está mexendo nisso agora.',
  'Conferindo se ficou tudo certo.',
  'Pronto! Já está no sistema.',
];

function TicketView({ id }: { id: string }) {
  const nav = useNavigate();
  const toast = useToast();
  const [t, setT] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  if (!t) return <Skeleton variant="detail" />;
  const opening = t.files.filter((f) => f.eventId === null);
  const off = t.statusLabel === 'Não será feito' || t.statusLabel === 'Cancelado';
  const cancelled = t.statusLabel === 'Cancelado';
  const canCancel = t.step <= 2 && !t.done;
  const last = CLIENT_STEPS.length - 1;
  const finished = !off && (t.step >= last || t.statusLabel === 'Resolvido');
  const tone = off ? 'off' : finished ? 'ok' : 'run';
  const talk = () =>
    talkAboutTicket({
      id: t.id,
      code: t.code,
      title: t.title,
      statusLabel: t.statusLabel,
      done: t.done,
    });

  return (
    <div className="tkv">
      <header className="tkv__head">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeft size={16} />}
          onClick={() => nav('/chamados')}
        >
          Chamados
        </Button>
        <div className="tkv__title">
          <span className="tkv__eyebrow">
            <KindIcon kind={t.kind} /> {kindLabel(t.kind)} ·{' '}
            <span className="tk-code">{t.code}</span>
          </span>
          <h1>{t.title}</h1>
        </div>
      </header>

      <div className="tkv__body">
        <div className="tkv__main">
          {/* Onde o chamado está agora, em uma olhada. */}
          <section className="tkv__card tkv__now" data-tone={tone} aria-label="Situação">
            <div className="tkv__now-head">
              <span className="tkv__now-dot" aria-hidden />
              <div>
                <b>{t.statusLabel}</b>
                <span>
                  {off
                    ? cancelled
                      ? 'Este chamado foi cancelado. Se precisar, abra outro na lista.'
                      : 'A equipe decidiu não fazer este pedido.'
                    : STEP_HINTS[Math.min(t.step, last)]}
                </span>
              </div>
              {!off && (
                <span className="tkv__now-count">
                  Etapa {Math.min(t.step, last) + 1} de {CLIENT_STEPS.length}
                </span>
              )}
            </div>
            <ol className="tk-hsteps" data-off={off} aria-label="Andamento">
              {CLIENT_STEPS.map((s, i) => {
                const state =
                  i < t.step || (finished && i === last) ? 'done' : i === t.step ? 'now' : 'todo';
                return (
                  <li
                    key={s}
                    data-state={state}
                    aria-current={state === 'now' ? 'step' : undefined}
                  >
                    <span className="tk-hsteps__bar" />
                    <span className="tk-hsteps__label">
                      {state === 'done' && !off && <Check size={12} strokeWidth={3} />}
                      {s}
                    </span>
                  </li>
                );
              })}
            </ol>
            {t.decisionNote && (
              <p className="tkv__reason">
                <b>Motivo:</b> {t.decisionNote}
              </p>
            )}
          </section>

          <section className="tkv__card">
            <h2>O que você contou</h2>
            {t.description ? (
              <p className="tkv__desc">{t.description}</p>
            ) : (
              <p className="tkv__muted">Sem descrição.</p>
            )}
            {opening.length > 0 && (
              <div className="tkv__files">
                <h3>
                  {opening.length === 1 ? '1 anexo' : `${opening.length} anexos`}
                  <span>Abra para ver maior</span>
                </h3>
                <FileGrid files={opening} />
              </div>
            )}
          </section>

          <section className="tkv__card">
            <h2>Histórico</h2>
            <TicketHistory
              description={t.description}
              openedBy={t.openedBy}
              createdAt={t.createdAt}
              events={t.events}
              files={t.files}
            />
          </section>
        </div>

        <aside className="tkv__side">
          {!cancelled && (
            // A conversa sobre o chamado é pelo chat (aba Suporte), com o chamado já anexado.
            <section className="tkv__card tkv__talk">
              <div className="tkv__talk-icon" aria-hidden>
                <Headset size={20} />
              </div>
              <b>Quer falar sobre este chamado?</b>
              <span>
                Abre o chat com a Comandou com o chamado {t.code} já anexado. É só escrever.
              </span>
              <Button variant="primary" icon={<MessageSquare size={16} />} onClick={talk}>
                Falar no chat
              </Button>
            </section>
          )}
          <section className="tkv__card">
            <h2>Detalhes</h2>
            <dl className="tk-facts">
              <div>
                <dt>Número</dt>
                <dd className="tk-code">{t.code}</dd>
              </div>
              <div>
                <dt>Assunto</dt>
                <dd>{kindLabel(t.kind)}</dd>
              </div>
              <div>
                <dt>Quanto atrapalha</dt>
                <dd>{levelLabel(t.urgency)}</dd>
              </div>
              {t.openedBy && (
                <div>
                  <dt>Aberto por</dt>
                  <dd>{t.openedBy}</dd>
                </div>
              )}
              <div>
                <dt>Aberto em</dt>
                <dd>{when(t.createdAt)}</dd>
              </div>
              <div>
                <dt>Última novidade</dt>
                <dd title={when(t.updatedAt)}>{ago(t.updatedAt)}</dd>
              </div>
            </dl>
            {canCancel && (
              <Button variant="secondary" size="sm" onClick={() => void cancel()}>
                Cancelar chamado
              </Button>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
