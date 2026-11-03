import {
  kindLabel,
  levelLabel,
  stageIndex,
  stageInfo,
  TICKET_KINDS,
  TICKET_LEVELS,
  TICKET_STAGES,
} from '@comandou/shared';
import {
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Loader2,
  Paperclip,
  Play,
  Plus,
  Search,
  Send,
  Settings2,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Modal, Select, Spinner, TextField, useToast } from '../design-system';
import type { Prepared } from '../features/store-chat/chat-media';
import { AgentAvatar, AttachPicker, EventLine, FileGrid } from '../features/tickets/TicketParts';
import {
  type TicketEvent,
  type TicketFile,
  uploadTicketFile,
  when,
} from '../features/tickets/ticket-api';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import type { TenantRow } from './types';
import { ago, PageHead, Tabs, useInterval } from './ui';

type State = 'running' | 'approval' | 'waiting' | 'done' | 'rejected' | 'cancelled';

interface Card {
  id: string;
  number: number;
  code: string;
  title: string;
  kind: string;
  urgency: string;
  stage: string;
  state: State;
  waitingReason: string | null;
  priority: string | null;
  priorityScore: number | null;
  pain: string | null;
  autoAdvance: boolean;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  lastError: string | null;
  unread: number;
  files: number;
  source: 'client' | 'admin';
  tenant: { id: string; name: string; slug: string; plan: string | null };
  openedBy: string;
  createdAt: string;
  updatedAt: string;
  stageStartedAt: string;
}

export interface PipelineSettings {
  enabled: boolean;
  model: string;
  effectiveModel: string;
  aiReady: boolean;
  githubRepo: string;
  githubBase: string;
  hasGithubToken: boolean;
  tokenReadable: boolean;
  keyConfigured: boolean;
  branchPrefix: string;
  allowCodeChanges: boolean;
  autoAdvance: boolean;
}

interface Board {
  tickets: Card[];
  waiting: number;
  running: number;
  settings: PipelineSettings;
}

interface Detail extends Omit<Card, 'files'> {
  description: string;
  page: string | null;
  openedByEmail: string;
  analysis: Record<string, Record<string, unknown>>;
  pending: string[];
  decisionNote: string | null;
  headSha: string | null;
  aiTokens: number;
  aiCostUsd: number;
  attempts: number;
  closedAt: string | null;
  clientStatus: { step: number; label: string };
  otherOpen: number;
  repo: string;
  base: string;
  events: TicketEvent[];
  files: TicketFile[];
}

const BASE = '/platform/tickets';
const LEVEL_N: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

function StatePill({ c }: { c: Pick<Card, 'state' | 'stage'> }) {
  switch (c.state) {
    case 'running':
      return (
        <span className="tk-pill tk-pill--run">
          <Loader2 size={11} /> Rodando
        </span>
      );
    case 'approval':
      return (
        <span className="tk-pill tk-pill--wait">
          <Clock size={11} /> Sua decisão
        </span>
      );
    case 'waiting':
      return (
        <span className="tk-pill tk-pill--wait">
          <Clock size={11} /> Esperando você
        </span>
      );
    case 'done':
      return (
        <span className="tk-pill tk-pill--ok">
          <Check size={11} /> Concluída
        </span>
      );
    case 'rejected':
      return (
        <span className="tk-pill tk-pill--bad">
          <XCircle size={11} /> Recusada
        </span>
      );
    default:
      return <span className="tk-pill">Cancelada</span>;
  }
}

function Prio({ level }: { level: string | null }) {
  if (!level) return null;
  return (
    <span className="tk-pill" title={`Prioridade ${levelLabel(level)}`}>
      <span className="tk-prio" data-l={LEVEL_N[level] ?? 0} aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {levelLabel(level)}
    </span>
  );
}

/** Avisa no navegador quando um chamado passa a esperar você (com a aba em segundo plano). */
function useBrowserAlerts(board: Board | null, on: boolean) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!board) return;
    const waiting = board.tickets.filter((t) => t.state === 'approval' || t.state === 'waiting');
    const ids = new Set(waiting.map((t) => `${t.id}:${t.stage}:${t.state}`));
    if (seen.current && on && 'Notification' in window && Notification.permission === 'granted') {
      for (const t of waiting)
        if (!seen.current.has(`${t.id}:${t.stage}:${t.state}`))
          new Notification(`${t.code} · ${t.title}`, {
            body: t.waitingReason ?? 'Esperando você',
            tag: t.id,
          });
    }
    seen.current = ids;
  }, [board, on]);
}

/**
 * Chamados: a esteira de desenvolvimento. Cada coluna é uma etapa com o seu agente de IA; o
 * chamado do cliente entra em Início, espera a sua decisão e, aprovado, anda sozinho até o PR.
 */
export function TicketsBoardPage() {
  const [closed, setClosed] = useState(false);
  const data = useLoad<Board>(`${BASE}${closed ? '?closed=1' : ''}`);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('chamado'),
  );
  const [creating, setCreating] = useState(false);
  const [config, setConfig] = useState(false);
  const [notify, setNotify] = useState(() => {
    try {
      return localStorage.getItem('cm:tk-notify') === '1';
    } catch {
      return false;
    }
  });
  const [running, setRunning] = useState(false);
  const toast = useToast();
  useInterval(data.reload, 8000);
  useBrowserAlerts(data.data, notify);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input,textarea,select')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  const term = q.trim().toLowerCase().replace(/^#/, '');
  const cards = useMemo(() => {
    const all = data.data?.tickets ?? [];
    if (!term) return all;
    return all.filter(
      (t) =>
        t.title.toLowerCase().includes(term) ||
        t.tenant.name.toLowerCase().includes(term) ||
        t.code.toLowerCase().includes(term) ||
        String(t.number) === term.replace(/\D/g, ''),
    );
  }, [data.data, term]);

  async function toggleNotify() {
    if (notify) {
      setNotify(false);
      try {
        localStorage.setItem('cm:tk-notify', '0');
      } catch {
        /* sem armazenamento */
      }
      return;
    }
    if (!('Notification' in window)) return toast('Este navegador não mostra avisos', 'danger');
    const p = await Notification.requestPermission();
    if (p !== 'granted') return toast('O navegador bloqueou os avisos deste site', 'danger');
    setNotify(true);
    try {
      localStorage.setItem('cm:tk-notify', '1');
    } catch {
      /* sem armazenamento */
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const r = await api<{ processed: number }>(`${BASE}/run`, { method: 'POST' });
      toast(r.processed ? `${r.processed} chamado(s) processado(s)` : 'Nada na fila agora');
      data.reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setRunning(false);
    }
  }

  const b = data.data;
  if (data.error) return <Alert tone="danger">{data.error}</Alert>;
  if (!b) return <Spinner />;
  const s = b.settings;
  return (
    <div className="tk-board-page">
      <PageHead
        page
        title="Chamados"
        sub="Esteira de desenvolvimento: do pedido do cliente ao PR"
        actions={
          <>
            <Button variant="ghost" icon={<Settings2 size={16} />} onClick={() => setConfig(true)}>
              Configurar
            </Button>
            <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              Nova demanda
            </Button>
          </>
        }
      />
      {(!s.hasGithubToken || !s.aiReady || !s.enabled) && (
        <Alert tone="warning">
          {!s.enabled ? 'Agentes desligados: os chamados entram e esperam você mover à mão. ' : ''}
          {!s.aiReady ? 'Falta a chave do OpenRouter (Super Admin › Tokens). ' : ''}
          {!s.hasGithubToken
            ? 'Falta o token do GitHub para criar branch e PR (repositório privado): clique em Configurar e siga o passo a passo.'
            : ''}
        </Alert>
      )}
      <div className="tk-toolbar">
        <div className="tk-search">
          <TextField
            ref={searchRef}
            label="Buscar"
            placeholder="Título, cliente ou #número  ( / )"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label className="tk-switch">
          <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
          Mostrar encerradas
        </label>
        <span className="tk-toolbar__spacer" />
        <span className="tk-toolbar__count">
          <b>{b.waiting}</b> esperando você · <b>{b.running}</b> rodando
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={notify ? <Bell size={15} /> : <BellOff size={15} />}
          onClick={() => void toggleNotify()}
        >
          {notify ? 'Avisando no navegador' : 'Avisar no navegador'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Play size={15} />}
          loading={running}
          onClick={() => void runNow()}
        >
          Rodar agora
        </Button>
      </div>
      <div className="tk-board" role="list" aria-label="Etapas">
        {TICKET_STAGES.map((st, i) => {
          const list = cards
            .filter((c) => c.stage === st.id)
            .sort(
              (a, z) =>
                Number(z.state === 'approval' || z.state === 'waiting') -
                  Number(a.state === 'approval' || a.state === 'waiting') ||
                (LEVEL_N[z.priority ?? ''] ?? 0) - (LEVEL_N[a.priority ?? ''] ?? 0) ||
                z.updatedAt.localeCompare(a.updatedAt),
            );
          return (
            <section
              key={st.id}
              className="tk-col"
              role="listitem"
              style={{ '--tk-c': st.color } as React.CSSProperties}
            >
              <header className="tk-col__head">
                <div className="tk-col__title">
                  {st.label}
                  <span className="tk-col__n">{list.length}</span>
                  <span className="tk-col__step">
                    {i + 1}/{TICKET_STAGES.length}
                  </span>
                </div>
                <div className="tk-col__agent">
                  <AgentAvatar stage={st.id} size={24} />
                  <span>
                    <b>{st.agent}</b> · {st.role}
                  </span>
                </div>
              </header>
              <div className="tk-col__body">
                {list.length === 0 ? (
                  <div className="tk-col__empty">
                    <AgentAvatar stage={st.id} size={40} />
                    Nada com {st.agent} agora.
                  </div>
                ) : (
                  list.map((c) => <CardView key={c.id} c={c} onOpen={() => setOpen(c.id)} />)
                )}
                {st.id === 'inicio' && (
                  <button type="button" className="tk-col__add" onClick={() => setCreating(true)}>
                    <Plus size={15} /> Criar demanda
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {open && (
        <TicketDrawer
          id={open}
          onClose={() => {
            setOpen(null);
            data.reload();
          }}
          onChanged={data.reload}
        />
      )}
      <NewDemand
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          data.reload();
          setOpen(id);
        }}
      />
      {config && (
        <PipelineConfig
          s={s}
          onClose={() => setConfig(false)}
          onSaved={() => {
            setConfig(false);
            data.reload();
          }}
        />
      )}
    </div>
  );
}

function CardView({ c, onOpen }: { c: Card; onOpen: () => void }) {
  return (
    <button type="button" className="tk-card" data-state={c.state} onClick={onOpen}>
      <span className="tk-card__title">{c.title}</span>
      <span className="tk-card__client">
        {c.tenant.name}
        {c.tenant.plan ? ` · ${c.tenant.plan}` : ''}
      </span>
      {c.pain && <span className="tk-card__pain">{c.pain}</span>}
      <span className="tk-card__row">
        <StatePill c={c} />
        <Prio level={c.priority ?? c.urgency} />
        {c.files > 0 && (
          <span className="tk-pill" title="Anexos">
            <Paperclip size={11} /> {c.files}
          </span>
        )}
        {c.prNumber && (
          <span className="tk-pill tk-pill--ok">
            <GitPullRequest size={11} /> #{c.prNumber}
          </span>
        )}
        {c.unread > 0 && <span className="tk-unread">{c.unread}</span>}
      </span>
      {c.waitingReason && (c.state === 'waiting' || c.state === 'approval') && (
        <span className="tk-card__pain">{c.waitingReason}</span>
      )}
      <span className="tk-card__foot">
        <span className="tk-code">{c.code}</span>
        <span>{ago(c.updatedAt)}</span>
      </span>
    </button>
  );
}

type Tab = 'etapa' | 'conversa' | 'atividade' | 'diff' | 'anexos' | 'historico';

function TicketDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const d = useLoad<Detail>(`${BASE}/${id}`);
  const [tab, setTab] = useState<Tab>('etapa');
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  useInterval(d.reload, 6000);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  const t = d.data;

  async function act(label: string, path: string, json?: unknown) {
    setBusy(label);
    try {
      await api(`${BASE}/${id}${path}`, { method: 'POST', json: json ?? {} });
      d.reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }
  async function patch(json: unknown) {
    try {
      await api(`${BASE}/${id}`, { method: 'PATCH', json });
      d.reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  const st = stageInfo(t?.stage ?? 'inicio');
  const activity = t?.events.filter((e) => e.kind === 'activity') ?? [];
  const convo = t?.events.filter((e) => e.kind === 'message' || e.kind === 'note') ?? [];
  const history = t?.events.filter((e) => ['stage', 'status', 'decision'].includes(e.kind)) ?? [];
  const closed = t && ['done', 'rejected', 'cancelled'].includes(t.state);
  return (
    <div
      className="tk-drawer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="tk-drawer__panel"
        role="dialog"
        aria-label="Chamado"
        style={{ '--tk-c': st.color } as React.CSSProperties}
      >
        {!t ? (
          <div style={{ padding: 24 }}>
            {d.error ? <Alert tone="danger">{d.error}</Alert> : <Spinner />}
          </div>
        ) : (
          <>
            <div className="tk-drawer__head">
              <div className="tk-drawer__top">
                <AgentAvatar stage={t.stage} size={52} />
                <div className="tk-drawer__who">
                  <b>{st.agent}</b>
                  <span>
                    {st.role} · Etapa {stageIndex(t.stage) + 1} de {TICKET_STAGES.length}:{' '}
                    {st.label}
                  </span>
                </div>
                <div className="tk-drawer__actions">
                  <StatePill c={t} />
                  <button
                    type="button"
                    className="adm-icon-btn"
                    aria-label="Fechar"
                    onClick={onClose}
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
              <h2 className="tk-drawer__title">{t.title}</h2>
              <div className="tk-chips">
                <span className="tk-code">{t.code}</span>
                <button
                  type="button"
                  className="tk-chip"
                  title="Quando ligado, o chamado passa sozinho para a próxima etapa"
                  onClick={() => void patch({ autoAdvance: !t.autoAdvance })}
                >
                  <Zap size={12} /> {t.autoAdvance ? 'Avança sozinho' : 'Avança à mão'}
                </button>
                {t.branch && (
                  <button
                    type="button"
                    className="tk-chip tk-chip--mono"
                    title="Copiar nome da branch"
                    onClick={() => {
                      void navigator.clipboard?.writeText(t.branch!);
                      toast('Branch copiada');
                    }}
                  >
                    <GitBranch size={12} /> {t.branch} <Copy size={11} />
                  </button>
                )}
                {t.prUrl && (
                  <a
                    className="tk-chip tk-chip--link"
                    href={t.prUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <GitPullRequest size={12} /> Pull request #{t.prNumber}{' '}
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
              <ol className="tk-track">
                {TICKET_STAGES.map((s, i) => {
                  const now = stageIndex(t.stage);
                  const done = i < now || (i === now && t.state === 'done');
                  return (
                    <li
                      key={s.id}
                      data-done={i <= now && i > 0}
                      data-now={i === now}
                      data-future={i > now}
                    >
                      <AgentAvatar stage={s.id} size={30} done={done} />
                      <span>{s.label}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="tk-drawer__tabs">
              <Tabs<Tab>
                value={tab}
                onChange={setTab}
                items={[
                  ['etapa', 'Etapa atual'],
                  ['conversa', `Conversa${convo.length ? ` ${convo.length}` : ''}`],
                  ['atividade', `Atividade${activity.length ? ` ${activity.length}` : ''}`],
                  ['diff', 'Diff'],
                  ['anexos', `Anexos${t.files.length ? ` ${t.files.length}` : ''}`],
                  ['historico', `Histórico${history.length ? ` ${history.length}` : ''}`],
                ]}
              />
            </div>
            <div className="tk-drawer__body">
              {tab === 'etapa' && <StageTab t={t} onPatch={patch} />}
              {tab === 'conversa' && <ConvoTab t={t} events={convo} onSent={d.reload} />}
              {tab === 'atividade' && (
                <LogTab events={activity} empty="Os agentes ainda não fizeram nada." />
              )}
              {tab === 'diff' && <DiffTab id={t.id} branch={t.branch} />}
              {tab === 'anexos' &&
                (t.files.length ? (
                  <FileGrid files={t.files} />
                ) : (
                  <p className="adm-empty">Sem anexos.</p>
                ))}
              {tab === 'historico' && <LogTab events={history} empty="Sem histórico." />}
            </div>
            <div className="tk-drawer__foot">
              <span className="tk-drawer__status">
                {t.state === 'done' ? (
                  <>
                    <CheckCircle2 size={16} /> Demanda concluída.
                  </>
                ) : t.state === 'running' ? (
                  <>
                    <Loader2 size={16} className="tk-spin" /> {st.agent} está trabalhando…
                  </>
                ) : (
                  (t.waitingReason ?? t.decisionNote ?? '')
                )}
              </span>
              {t.state === 'approval' && (
                <>
                  <Button variant="ghost" onClick={() => setRejecting(true)} disabled={!!busy}>
                    Recusar
                  </Button>
                  <Button
                    icon={<Check size={16} />}
                    loading={busy === 'approve'}
                    onClick={() => void act('approve', '/decide', { approve: true })}
                  >
                    Aprovar e começar
                  </Button>
                </>
              )}
              {!closed && t.state !== 'approval' && (
                <>
                  <MoveMenu
                    stage={t.stage}
                    onMove={(stage) => void act('move', '/move', { stage })}
                  />
                  {t.stage !== 'concluido' && (
                    <Button
                      variant={t.state === 'waiting' ? 'primary' : 'ghost'}
                      loading={busy === 'advance'}
                      onClick={() => void act('advance', '/advance')}
                    >
                      Avançar
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm('Cancelar este chamado? O cliente é avisado.'))
                        void act('cancel', '/cancel', {});
                    }}
                  >
                    Cancelar
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </aside>
      <RejectModal
        open={rejecting}
        onClose={() => setRejecting(false)}
        onReject={async (note) => {
          await act('reject', '/decide', { approve: false, note: note || undefined });
          setRejecting(false);
        }}
      />
    </div>
  );
}

function MoveMenu({ stage, onMove }: { stage: string; onMove: (s: string) => void }) {
  return (
    <Select
      aria-label="Mover para"
      sheetTitle="Mover para a etapa"
      value=""
      onChange={(e) => e.target.value && onMove(e.target.value)}
      style={{ width: 190 }}
    >
      <option value="">Mover / refazer…</option>
      {TICKET_STAGES.map((s) => (
        <option key={s.id} value={s.id}>
          {s.id === stage ? `Refazer ${s.label} (${s.agent})` : `${s.label} (${s.agent})`}
        </option>
      ))}
    </Select>
  );
}

function RejectModal({
  open,
  onClose,
  onReject,
}: {
  open: boolean;
  onClose: () => void;
  onReject: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Recusar o chamado"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onReject(note);
              setBusy(false);
              setNote('');
            }}
          >
            Recusar
          </Button>
        </>
      }
    >
      <div className="cm-field">
        <label className="cm-label" htmlFor="tk-reject">
          Motivo (o cliente vê)
        </label>
        <textarea
          id="tk-reject"
          className="cm-input"
          rows={3}
          maxLength={1000}
          value={note}
          placeholder="Ex.: isso já dá para fazer em Loja online › Aparência."
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const asText = (v: unknown) => (typeof v === 'string' ? v : '');

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tk-block">
      <span className="tk-block__label">{label}</span>
      {children}
    </div>
  );
}

function Numbered({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ol className="tk-numbered">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ol>
  );
}

function StageTab({ t, onPatch }: { t: Detail; onPatch: (b: unknown) => void }) {
  const a = t.analysis;
  const tri = a.inicio ?? {};
  const pr = a.priorizacao ?? {};
  const dev = a.desenvolvimento ?? {};
  const rev = a.code_review ?? {};
  const tst = a.testes ?? {};
  const issues = Array.isArray(rev.issues)
    ? (rev.issues as { severity: string; file: string; note: string }[])
    : [];
  const manual = (tst.manual ?? null) as { steps?: string[]; regressions?: string[] } | null;
  const ci = Array.isArray(tst.ci)
    ? (tst.ci as { name: string; conclusion: string; url: string }[])
    : [];
  return (
    <>
      {t.lastError && <Alert tone="danger">Último erro: {t.lastError}</Alert>}
      <div className="tk-facts">
        <div className="tk-fact">
          <span>Cliente</span>
          <b>
            <a href={`/restaurantes/${t.tenant.id}`}>{t.tenant.name}</a>
          </b>
        </div>
        <div className="tk-fact">
          <span>Plano</span>
          <b>{t.tenant.plan ?? 'sem plano'}</b>
        </div>
        <div className="tk-fact">
          <span>Aberto por</span>
          <b>{t.openedBy || '—'}</b>
        </div>
        <div className="tk-fact">
          <span>Tipo</span>
          <b>{kindLabel(t.kind)}</b>
        </div>
        <div className="tk-fact">
          <span>Urgência do cliente</span>
          <b>{levelLabel(t.urgency)}</b>
        </div>
        <div className="tk-fact">
          <span>Prioridade{t.priorityScore != null ? ` · ${t.priorityScore}/100` : ''}</span>
          <Select
            aria-label="Prioridade"
            value={t.priority ?? ''}
            onChange={(e) => onPatch({ priority: e.target.value || null })}
          >
            <option value="">automática</option>
            {TICKET_LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="tk-fact">
          <span>O cliente vê</span>
          <b>{t.clientStatus.label}</b>
        </div>
        <div className="tk-fact">
          <span>IA neste chamado</span>
          <b>
            {t.aiTokens.toLocaleString('pt-BR')} tokens · US$ {t.aiCostUsd.toFixed(4)}
          </b>
        </div>
        {t.otherOpen > 0 && (
          <div className="tk-fact">
            <span>Outros chamados abertos</span>
            <b>{t.otherOpen}</b>
          </div>
        )}
      </div>
      {t.pain && t.pain !== t.title && (
        <Block label="Dor do cliente">
          <p>{t.pain}</p>
        </Block>
      )}
      <Block label="Descrição do cliente">
        <p>{t.description || '—'}</p>
      </Block>
      {asText(tri.summary) && (
        <Block label="Triagem (Lia)">
          <p>{asText(tri.summary)}</p>
          {asText(tri.recommendation) && (
            <p>
              Recomendação: <b>{asText(tri.recommendation)}</b>
              {asText(tri.why) ? ` · ${asText(tri.why)}` : ''}
            </p>
          )}
          {asList(tri.questions).length > 0 && (
            <>
              <span className="tk-block__label">Perguntas para o cliente</span>
              <Numbered items={asList(tri.questions)} />
            </>
          )}
        </Block>
      )}
      {asText(pr.probableCause) && (
        <Block label="Análise (Bento)">
          <p>{asText(pr.probableCause)}</p>
          <Numbered items={asList(pr.plan)} />
          {asList(pr.files).length > 0 && (
            <p className="tk-code">{asList(pr.files).join('  ·  ')}</p>
          )}
        </Block>
      )}
      {asList(pr.acceptanceCriteria ?? tri.acceptanceCriteria).length > 0 && (
        <Block label="Critérios de aceite">
          <Numbered items={asList(pr.acceptanceCriteria ?? tri.acceptanceCriteria)} />
        </Block>
      )}
      {(asText(dev.summary) || dev.commit) && (
        <Block label="Desenvolvimento (Caio)">
          <p>{asText(dev.summary) || 'Só a especificação foi para a branch.'}</p>
          {asList(dev.applied).length > 0 && (
            <p className="tk-code">{asList(dev.applied).join('  ·  ')}</p>
          )}
        </Block>
      )}
      {asText(rev.summary) && (
        <Block label="Code review (Vera)">
          <p>{asText(rev.summary)}</p>
          <Numbered items={issues.map((i) => `[${i.severity}] ${i.file}: ${i.note}`)} />
        </Block>
      )}
      {(ci.length > 0 || manual) && (
        <Block label="Testes (Íris)">
          {ci.map((r) => (
            <p key={r.url}>
              {r.conclusion === 'success' ? 'Passou' : r.conclusion}:{' '}
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.name}
              </a>
            </p>
          ))}
          {manual?.steps && (
            <>
              <span className="tk-block__label">Roteiro de teste manual</span>
              <Numbered items={manual.steps} />
            </>
          )}
        </Block>
      )}
      {t.pending.length > 0 && (
        <Block label={`Pendências · ${t.pending.length}`}>
          <Numbered items={t.pending} />
        </Block>
      )}
    </>
  );
}

function ConvoTab({ t, events, onSent }: { t: Detail; events: TicketEvent[]; onSent: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Prepared[]>([]);
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  async function send(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      const ids: string[] = [];
      for (const f of files) ids.push((await uploadTicketFile(BASE, t.id, f)).id);
      await api(`${BASE}/${t.id}/messages`, {
        method: 'POST',
        json: { body: text, fileIds: ids, internal },
      });
      setText('');
      setFiles([]);
      onSent();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      {events.length === 0 && (
        <p className="adm-empty">Ninguém escreveu ainda. O cliente vê o que você mandar aqui.</p>
      )}
      <ul className="tk-thread">
        {events.map((e) => (
          <EventLine
            key={e.id}
            e={e}
            mine={e.actor === 'admin'}
            files={t.files.filter((f) => f.eventId === e.id)}
          />
        ))}
      </ul>
      <form className="tk-compose" onSubmit={send}>
        <textarea
          className="cm-input"
          rows={3}
          maxLength={4000}
          aria-label="Mensagem"
          placeholder={
            internal ? 'Nota interna (o cliente não vê)…' : `Escreva para ${t.tenant.name}…`
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="tk-compose__row">
          <AttachPicker files={files} onChange={setFiles} label="Foto ou vídeo" />
          <label className="tk-switch">
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
            />
            Nota interna
          </label>
          <Button
            type="submit"
            icon={<Send size={15} />}
            loading={sending}
            disabled={!text.trim() && !files.length}
          >
            Enviar
          </Button>
        </div>
      </form>
    </>
  );
}

function LogTab({ events, empty }: { events: TicketEvent[]; empty: string }) {
  if (!events.length) return <p className="adm-empty">{empty}</p>;
  return (
    <ul className="tk-log">
      {[...events].reverse().map((e) => (
        <li key={e.id} data-error={!!e.data?.error}>
          {e.stage ? <AgentAvatar stage={e.stage} size={22} /> : <span />}
          <span>
            <b>{e.actorName || (e.actor === 'client' ? 'Cliente' : 'Sistema')}</b> {e.body}
          </span>
          <small>{when(e.createdAt)}</small>
        </li>
      ))}
    </ul>
  );
}

interface Diff {
  branch: string | null;
  aheadBy: number;
  url: string | null;
  files: {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch: string | null;
  }[];
}

function DiffTab({ id, branch }: { id: string; branch: string | null }) {
  const d = useLoad<Diff>(branch ? `${BASE}/${id}/diff` : null);
  if (!branch) return <p className="adm-empty">A branch nasce na etapa Desenvolvimento.</p>;
  if (d.error) return <Alert tone="danger">{d.error}</Alert>;
  if (!d.data) return <Spinner />;
  return (
    <div className="tk-diff">
      <p className="adm-sub">
        {d.data.aheadBy} commit(s) em <span className="tk-code">{branch}</span>
        {d.data.url && (
          <>
            {' · '}
            <a href={d.data.url} target="_blank" rel="noreferrer">
              ver no GitHub
            </a>
          </>
        )}
      </p>
      {d.data.files.map((f) => (
        <details key={f.filename} open={d.data!.files.length <= 4}>
          <summary>
            {f.filename}
            <em>
              <span className="tk-plus">+{f.additions}</span>{' '}
              <span className="tk-minus">-{f.deletions}</span>
            </em>
          </summary>
          <pre>
            {(f.patch ?? 'Sem prévia (arquivo grande ou binário).').split('\n').map((l, i) => (
              <span
                key={i}
                className={
                  l.startsWith('@@')
                    ? 'hunk'
                    : l.startsWith('+')
                      ? 'add'
                      : l.startsWith('-')
                        ? 'del'
                        : undefined
                }
              >
                {l || ' '}
              </span>
            ))}
          </pre>
        </details>
      ))}
    </div>
  );
}

function NewDemand({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const tenants = useLoad<TenantRow[]>(open ? '/platform/tenants' : null);
  const [tenantId, setTenantId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState('bug');
  const [urgency, setUrgency] = useState('medium');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
    }
  }, [open]);
  useEffect(() => {
    if (!tenantId && tenants.data?.[0]) setTenantId(tenants.data[0].id);
  }, [tenants.data, tenantId]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ id: string }>(BASE, {
        method: 'POST',
        json: { tenantId, title, description, kind, urgency },
      });
      toast('Demanda criada: já entra na triagem e segue aprovada', 'success');
      onCreated(r.id);
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova demanda"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="tk-demand"
            loading={busy}
            disabled={!tenantId || title.trim().length < 3}
          >
            Criar
          </Button>
        </>
      }
    >
      <form id="tk-demand" className="tk-form" onSubmit={submit}>
        <div className="cm-field">
          <label className="cm-label" htmlFor="tk-tenant">
            Cliente
          </label>
          <Select id="tk-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            {(tenants.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <TextField
          label="Título"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
        />
        <div className="tk-form__two">
          <div className="cm-field">
            <label className="cm-label" htmlFor="tk-dkind">
              Tipo
            </label>
            <Select id="tk-dkind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {TICKET_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="cm-field">
            <label className="cm-label" htmlFor="tk-durg">
              Urgência
            </label>
            <Select id="tk-durg" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              {TICKET_LEVELS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="cm-field">
          <label className="cm-label" htmlFor="tk-ddesc">
            Descrição
          </label>
          <textarea
            id="tk-ddesc"
            className="cm-input"
            rows={6}
            maxLength={8000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </form>
    </Modal>
  );
}

/** Configuração da esteira: agentes, GitHub (com o passo a passo do token) e regras. */
function PipelineConfig({
  s,
  onClose,
  onSaved,
}: {
  s: PipelineSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    enabled: s.enabled,
    model: s.model,
    githubRepo: s.githubRepo,
    githubBase: s.githubBase,
    githubToken: '',
    branchPrefix: s.branchPrefix,
    allowCodeChanges: s.allowCodeChanges,
    autoAdvance: s.autoAdvance,
  });
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [checks, setChecks] = useState<{
    ok: boolean;
    checks: { label: string; ok: boolean; detail?: string }[];
  } | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  async function save(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      await api(`${BASE}/settings`, {
        method: 'PUT',
        json: { ...f, githubToken: f.githubToken || undefined },
      });
      toast('Esteira salva', 'success');
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setTesting(true);
    try {
      setChecks(
        await api(`${BASE}/settings/test`, {
          method: 'POST',
          json: { githubRepo: f.githubRepo, githubToken: f.githubToken || undefined },
        }),
      );
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setTesting(false);
    }
  }
  const owner = f.githubRepo.split('/')[0] || 'dhqdev';
  return (
    <Modal
      open
      onClose={onClose}
      title="Configurar a esteira"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button variant="ghost" loading={testing} onClick={() => void test()}>
            Testar GitHub
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            Salvar
          </Button>
        </>
      }
    >
      <form className="tk-form" onSubmit={save}>
        <label className="tk-toggle-row">
          <input
            type="checkbox"
            checked={f.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          Agentes ligados (sem isso, o chamado só entra e espera você)
        </label>
        <TextField
          label="Modelo dos agentes no OpenRouter"
          placeholder={`vazio = o mesmo do assistente (${s.effectiveModel || 'Super Admin › Tokens'})`}
          hint="Para mexer em código, prefira um modelo forte (ex.: anthropic/claude-sonnet-4.5). A chave é a sua, em Super Admin › Tokens (ou a dos restaurantes, se você não colocou a sua)."
          value={f.model}
          onChange={(e) => set('model', e.target.value)}
        />
        {!s.aiReady && (
          <Alert tone="warning">Falta a chave do OpenRouter em Super Admin › Tokens.</Alert>
        )}

        <h3 className="tk-block__label" style={{ margin: '6px 0 0' }}>
          GitHub (repositório privado)
        </h3>
        <ol className="tk-howto">
          <li>
            Entre no GitHub com a conta dona do repositório e abra{' '}
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
            >
              Settings › Developer settings › Fine-grained tokens › Generate new token
            </a>
            .
          </li>
          <li>
            Nome: <code>Comandou esteira</code>. Expiração: 1 ano (anote para renovar). Resource
            owner: <code>{owner}</code>.
          </li>
          <li>
            Repository access: <b>Only select repositories</b> e escolha <code>{f.githubRepo}</code>
            . Como o repositório é privado, sem isso o token não enxerga nada.
          </li>
          <li>
            Em Permissions › Repository permissions, marque:
            <ul>
              <li>
                <b>Contents: Read and write</b> (criar a branch e o commit)
              </li>
              <li>
                <b>Pull requests: Read and write</b> (abrir o PR)
              </li>
              <li>
                <b>Actions: Read-only</b> (a etapa Testes acompanha o CI)
              </li>
              <li>Metadata: Read-only (o GitHub marca sozinho)</li>
            </ul>
          </li>
          <li>
            Clique em <b>Generate token</b>, copie o código (começa com <code>github_pat_</code>) e
            cole abaixo. Ele aparece uma vez só.
          </li>
          <li>
            Clique em <b>Testar GitHub</b>: tudo verde, clique em <b>Salvar</b>. O token fica
            cifrado e nunca volta para a tela.
          </li>
        </ol>
        <p className="tk-attach__hint" style={{ margin: 0, lineHeight: 1.5 }}>
          Se a conta for de uma organização que exige aprovação, um dono precisa aprovar o token em
          Settings › Personal access tokens. O CI do Comandou hoje roda só na main: sem execução
          para a branch, a Íris monta um roteiro de teste manual.
        </p>
        <div className="tk-form__two">
          <TextField
            label="Repositório (dono/nome)"
            value={f.githubRepo}
            onChange={(e) => set('githubRepo', e.target.value)}
          />
          <TextField
            label="Branch base"
            value={f.githubBase}
            onChange={(e) => set('githubBase', e.target.value)}
          />
        </div>
        <TextField
          label="Token do GitHub"
          type="password"
          autoComplete="off"
          placeholder={s.hasGithubToken ? 'Salvo. Cole outro para trocar.' : 'github_pat_…'}
          value={f.githubToken}
          onChange={(e) => set('githubToken', e.target.value)}
        />
        {s.hasGithubToken && !s.tokenReadable && (
          <Alert tone="danger">
            O token salvo não abre com a INTEGRATIONS_KEY atual: cole de novo.
          </Alert>
        )}
        {checks && (
          <ul className="tk-checks">
            {checks.checks.map((c) => (
              <li key={c.label}>
                {c.ok ? (
                  <CheckCircle2 size={15} color="var(--cm-success)" />
                ) : (
                  <XCircle size={15} color="var(--cm-danger)" />
                )}
                <span>
                  {c.label} {c.detail && <small>· {c.detail}</small>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <TextField
          label="Prefixo das branches"
          hint={`Ex.: ${f.branchPrefix || 'chamado'}/12-caixa-nao-fecha`}
          value={f.branchPrefix}
          onChange={(e) => set('branchPrefix', e.target.value)}
        />
        <label className="tk-toggle-row">
          <input
            type="checkbox"
            checked={f.allowCodeChanges}
            onChange={(e) => set('allowCodeChanges', e.target.checked)}
          />
          O agente de desenvolvimento propõe mudanças no código (sempre num PR em rascunho; nunca na
          main)
        </label>
        <label className="tk-toggle-row">
          <input
            type="checkbox"
            checked={f.autoAdvance}
            onChange={(e) => set('autoAdvance', e.target.checked)}
          />
          Chamados novos avançam sozinhos depois de aprovados
        </label>
      </form>
    </Modal>
  );
}
