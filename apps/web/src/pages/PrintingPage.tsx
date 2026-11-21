import {
  Bluetooth,
  Cable,
  Copy,
  Download,
  ExternalLink,
  FileText,
  MonitorSmartphone,
  Network,
  Plus,
  Printer,
  Search,
  Trash2,
  Usb,
  Wifi,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Segmented,
  Select,
  TextField,
  useToast,
  Skeleton,
} from '../design-system';
import { dateTime, elapsed, minutesSince, time } from '../features/format';
import {
  appLink,
  connectionCode,
  detectOs,
  downloadUrl,
  mainPrinter,
  PRINT_AGENT_DOWNLOADS,
  printHealth,
  type DesktopOs,
  type PrintHealthState,
} from '../features/print-agent';
import { PrintTemplatesCard } from '../features/PrintTemplates';
import { api } from '../lib/api';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { PrintAgent, PrintAgentPrinter, PrintJob } from '../lib/types';
import './printing.css';
import { TourButton } from '../features/tour/PageTour';

const KIND: Record<PrintJob['kind'], string> = {
  kitchen_ticket: 'Comanda',
  receipt: 'Conferência',
  test: 'Teste',
  fiscal_receipt: 'Cupom fiscal',
  kitchen_cancel: 'Item cancelado',
};
const STATUS: Record<PrintJob['status'], [string, 'neutral' | 'info' | 'success' | 'danger']> = {
  queued: ['Na fila', 'neutral'],
  printing: ['Imprimindo', 'info'],
  done: ['Impresso', 'success'],
  failed: ['Falhou', 'danger'],
  cancelled: ['Tirado da fila', 'neutral'],
};
/** Ainda vai sair (esperando ou com um computador agora). */
const pending = (j: PrintJob) => j.status === 'queued' || j.status === 'printing';
const PRINTER_ICON: Record<PrintAgentPrinter['kind'], ReactNode> = {
  usb: <Usb size={14} />,
  network: <Network size={14} />,
  bluetooth: <Bluetooth size={14} />,
  serial: <Cable size={14} />,
  document: <FileText size={14} />,
  none: <Printer size={14} />,
};

/** "agora", "há 5 min", "há 2 h"; mais de um dia, a data. */
function ago(iso: string) {
  const min = minutesSince(iso);
  if (min < 1) return 'agora';
  if (min < 24 * 60) return `há ${elapsed(min)}`;
  return dateTime(iso);
}

type JobFilter = 'all' | 'pending' | 'done' | 'failed' | 'cancelled';
/** Quantos trabalhos há em cada situação e os destinos já usados. */
type JobsSummary = { counts: Record<PrintJob['status'], number>; targets: string[] };
const PAGE = 50;
/** Impressora aberta na janela de trabalhos: computador + destino (null = principal). */
type OpenPrinter = { agent: PrintAgent; printer: PrintAgentPrinter };

/**
 * Impressão: o aplicativo "Comandou Impressão" roda no computador do restaurante, ligado às
 * impressoras, e busca os trabalhos aqui. Comandas de cozinha saem sozinhas a cada pedido.
 */
export function PrintingPage() {
  const toast = useToast();
  const [agents, setAgents] = useState<PrintAgent[] | null>(null);
  const [summary, setSummary] = useState<JobsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [secret, setSecret] = useState<{ name: string; token: string } | null>(null);
  const [openPrinter, setOpenPrinter] = useState<OpenPrinter | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [a, sum] = await Promise.all([
        api<PrintAgent[]>('/printing/agents'),
        api<JobsSummary>('/printing/jobs/summary'),
      ]);
      setAgents(a);
      setSummary(sum);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    // "Online" vale por 2 minutos depois do último sinal: confere de novo e atualiza o "há X min".
    const t = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      tick((n) => n + 1);
      void load();
    }, 30_000);
    return () => window.clearInterval(t);
  }, [load]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'print.changed') reload();
  }, load);

  async function call<T>(
    url: string,
    json: object = {},
    method: 'POST' | 'PATCH' | 'DELETE' = 'POST',
  ) {
    try {
      const r = await api<T>(url, method === 'DELETE' ? { method } : { method, json });
      await load();
      return r;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return undefined;
    }
  }

  const health = printHealth(agents);
  const queuedCount = summary ? summary.counts.queued + summary.counts.printing : 0;
  // Sem computador nenhum, o aplicativo vem primeiro; com computador, fica no fim da tela.
  const needsApp = agents !== null && health.state === 'none';

  async function testPrint() {
    if (await call('/printing/test', { target: 'Caixa' }))
      toast(
        health.state === 'ok'
          ? 'Página de teste enviada para a impressora'
          : 'Página de teste na fila: sai quando o computador da impressora estiver conectado',
        'success',
      );
  }

  return (
    <>
      <div>
        <div className="page-title-row">
          <h1 className="page-title">Impressão</h1>
          <TourButton tour="impressao" />
        </div>
        <p className="page-sub">
          Comandas de cozinha e conferências saem sozinhas nas impressoras do restaurante.
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}

      {agents !== null && health.state !== 'none' && (
        <StatusPanel
          state={health.state}
          off={health.off}
          agents={agents}
          queued={queuedCount}
          onTest={() => void testPrint()}
        />
      )}

      {needsApp && <DownloadHero online={false} onConnect={() => setConnectOpen(true)} />}

      <Card
        searchId="secao-agentes"
        title="Computadores conectados"
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={16} />}
            onClick={() => setConnectOpen(true)}
          >
            Conectar computador
          </Button>
        }
        bodyless
      >
        {agents === null ? (
          <div className="cm-card__body">
            <Skeleton />
          </div>
        ) : agents.length === 0 ? (
          <div className="cm-card__body">
            <EmptyState
              icon={<Printer size={20} />}
              title="Nenhum computador conectado"
              description="Sem o aplicativo, os pedidos funcionam normalmente, só não imprimem."
            />
          </div>
        ) : (
          <ul className="print-agents">
            {[...agents]
              .sort(
                (a, b) =>
                  Number(b.active) - Number(a.active) || Number(b.online) - Number(a.online),
              )
              .map((a) => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  onToken={async () => {
                    const r = await call<{ token: string }>(`/printing/agents/${a.id}/token`);
                    if (r) setSecret({ name: a.name, token: r.token });
                  }}
                  onToggle={() => call(`/printing/agents/${a.id}`, { active: !a.active }, 'PATCH')}
                  onPurge={async () => {
                    if (await call(`/printing/agents/${a.id}/purge`))
                      toast(
                        a.online
                          ? `"${a.name}" vai apagar as comandas paradas na fila do Windows em até 30 segundos`
                          : `"${a.name}" apaga as comandas paradas na fila do Windows quando voltar`,
                        'success',
                      );
                  }}
                  onDelete={async () => {
                    if (
                      !window.confirm(
                        `Excluir "${a.name}"? O código dele para de funcionar e ele some da lista. O histórico de impressão fica.`,
                      )
                    )
                      return;
                    if (await call(`/printing/agents/${a.id}`, {}, 'DELETE'))
                      toast(`"${a.name}" excluído`, 'success');
                  }}
                  onOpenPrinter={(printer) => setOpenPrinter({ agent: a, printer })}
                />
              ))}
          </ul>
        )}
      </Card>

      <PrintQueueCard
        summary={summary}
        waitReason={WAIT_REASON[health.state]}
        healthState={health.state}
        onTest={() => void testPrint()}
        onChanged={() => void load()}
      />

      {!needsApp && agents !== null && (
        <DownloadHero online={health.state === 'ok'} onConnect={() => setConnectOpen(true)} />
      )}

      <ConnectionGuide />

      <PrintTemplatesCard />

      <ConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onCreated={(name, token) => {
          setConnectOpen(false);
          setSecret({ name, token });
          void load();
        }}
      />
      <PrinterJobsModal
        open={openPrinter}
        onClose={() => setOpenPrinter(null)}
        onChanged={() => void load()}
      />
      <Modal
        open={!!secret}
        title={`Conectar "${secret?.name ?? ''}"`}
        onClose={() => setSecret(null)}
      >
        {secret && <AgentSetup name={secret.name} token={secret.token} />}
      </Modal>
    </>
  );
}

/** Por que os trabalhos estão parados "Na fila", em uma frase. */
const WAIT_REASON: Record<PrintHealthState, string> = {
  ok: 'Saindo agora',
  'printer-off': 'Impressora desligada: ligue para voltar a sair',
  'no-printer': 'Esperando escolher a impressora no aplicativo',
  offline: 'Esperando o computador da impressora ligar',
  none: 'Esperando um computador com o aplicativo',
};

/** Situação no topo: uma frase dizendo se está imprimindo e, se não, o que fazer. */
function StatusPanel({
  state,
  agents,
  queued,
  off,
  onTest,
}: {
  state: Exclude<PrintHealthState, 'none'>;
  off: string[];
  agents: PrintAgent[];
  queued: number;
  onTest: () => void;
}) {
  const active = agents.filter((a) => a.active);
  const online = active.filter((a) => a.online);
  const names = (list: PrintAgent[]) => list.map((a) => a.name).join(', ');
  const last = active
    .map((a) => a.lastSeenAt)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);
  const waiting = queued
    ? ` ${queued === 1 ? '1 trabalho espera' : `${queued} trabalhos esperam`} na fila e ${queued === 1 ? 'sai' : 'saem'} assim que resolver.`
    : '';
  const copy = {
    ok: {
      title: 'Impressão funcionando',
      text: `${names(online)} ${online.length === 1 ? 'está conectado' : 'estão conectados'}. Cada pedido imprime sozinho, na hora.`,
    },
    'printer-off': {
      title: off.length === 1 ? 'Impressora desligada' : 'Impressoras desligadas',
      text: `${off.join(', ')} não ${off.length === 1 ? 'responde' : 'respondem'}. Ligue e confira o cabo ou a rede. O que não sair fica em Falharam, com o botão Imprimir de novo.`,
    },
    'no-printer': {
      title: 'Falta escolher a impressora',
      text: `O aplicativo está aberto em ${names(online)}, mas nenhuma impressora foi escolhida. Abra o Comandou Impressão nesse computador e clique em Usar na impressora da lista.${waiting}`,
    },
    offline: {
      title: 'Impressão parada',
      text: `${names(active)} ${last ? `deu sinal pela última vez ${ago(last)}` : 'ainda não conectou'}. Ligue o computador, confira a internet e abra o Comandou Impressão (ele fica perto do relógio).${waiting}`,
    },
  }[state];
  return (
    <section className="print-state" data-state={state} role="status">
      <span className="print-state__dot" aria-hidden />
      <div className="print-state__body">
        <strong className="print-state__title">{copy.title}</strong>
        <p className="print-state__text">{copy.text}</p>
      </div>
      {state === 'ok' && (
        <Button variant="secondary" size="sm" onClick={onTest}>
          Imprimir teste
        </Button>
      )}
    </section>
  );
}

function AgentRow({
  agent: a,
  onToken,
  onToggle,
  onPurge,
  onDelete,
  onOpenPrinter,
}: {
  agent: PrintAgent;
  onToken: () => void;
  onToggle: () => void;
  onPurge: () => void;
  onDelete: () => void;
  onOpenPrinter: (p: PrintAgentPrinter) => void;
}) {
  const main = mainPrinter(a);
  const routes = (a.printers ?? []).filter((p) => p.target !== null);
  const st = !a.active ? 'off' : !a.online ? 'offline' : a.printers && !main ? 'warn' : 'ok';
  const when = !a.active
    ? 'Desativado: não recebe trabalhos'
    : a.online
      ? 'Conectado agora'
      : a.lastSeenAt
        ? `Desconectado, último sinal ${ago(a.lastSeenAt)}`
        : 'Ainda não conectou: abra o aplicativo e cole o código';
  return (
    <li className="print-agent" data-state={st} data-search-id={`agente-${a.id}`}>
      <span className="print-agent__dot" aria-hidden />
      <div className="print-agent__main">
        <div className="print-agent__head">
          <strong>{a.name}</strong>
          <span className="cm-hint">
            {when}
            {a.version && ` · v${a.version}`}
          </span>
        </div>
        {a.active && a.printers !== null && (
          <div className="print-agent__printers">
            {main ? (
              <button
                type="button"
                className={`print-chip print-chip--main${main.state === 'off' ? ' print-chip--off' : ''}`}
                title="Recebe tudo o que não tem impressora própria. Toque para ver os trabalhos dela."
                onClick={() => onOpenPrinter(main)}
              >
                {PRINTER_ICON[main.kind]}
                <span>
                  Principal: <strong>{main.label}</strong>
                  {main.state === 'off' && ' · desligada'}
                </span>
              </button>
            ) : (
              <span className="print-chip print-chip--warn">
                <Printer size={14} />
                Nenhuma impressora escolhida no aplicativo
              </span>
            )}
            {routes.map((p) => (
              <button
                type="button"
                key={p.target}
                className={`print-chip${p.state === 'off' ? ' print-chip--off' : ''}`}
                title="Toque para ver os trabalhos desta impressora"
                onClick={() => onOpenPrinter(p)}
              >
                {PRINTER_ICON[p.kind]}
                <span>
                  {p.target}: <strong>{p.label}</strong>
                  {p.state === 'off' && ' · desligada'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="print-agent__actions">
        <Button variant="ghost" size="sm" onClick={onToken}>
          Novo código
        </Button>
        {a.active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onPurge}
            title="Apaga as comandas do Comandou que ficaram paradas na fila do Windows deste computador"
          >
            Limpar fila do Windows
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onToggle}>
          {a.active ? 'Desativar' : 'Ativar'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 size={16} />}
          onClick={onDelete}
          aria-label={`Excluir ${a.name}`}
          title="Excluir computador"
        />
      </div>
    </li>
  );
}

/**
 * Janela de uma impressora: o que ainda vai sair nela (na fila) e o que já passou por ela, com
 * o botão de tirar a impressora do aplicativo daquele computador.
 */
function PrinterJobsModal({
  open,
  onClose,
  onChanged,
}: {
  open: OpenPrinter | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<{ upcoming: PrintJob[]; past: PrintJob[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const agentId = open?.agent.id;
  const target = open?.printer.target ?? null;
  const label = open?.printer.label;
  const load = useCallback(async () => {
    if (!agentId) return;
    const qs = new URLSearchParams();
    if (target !== null) qs.set('target', target);
    if (label) qs.set('label', label);
    try {
      setData(await api(`/printing/agents/${agentId}/jobs?${qs}`));
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }, [agentId, target, label, toast]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  useRealtime((e) => {
    if (e.type === 'print.changed') void load();
  }, load);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      onChanged();
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function removePrinter() {
    if (!open) return;
    const what = target === null ? 'a impressora principal' : `a impressora de ${target}`;
    if (
      !window.confirm(
        target === null
          ? `Tirar ${what} (${label}) de "${open.agent.name}"? Sem principal, este computador para de imprimir até escolherem outra no aplicativo.`
          : `Tirar ${what} (${label}) de "${open.agent.name}"? O que for para ${target} passa a sair na principal.`,
      )
    )
      return;
    await act(() =>
      api(`/printing/agents/${open.agent.id}/printers/remove`, {
        method: 'POST',
        json: { target, label },
      }),
    );
    toast('Impressora tirada. O aplicativo apaga a escolha em até 30 segundos.', 'success');
    onClose();
  }

  const title = open
    ? `${open.printer.target === null ? 'Principal' : open.printer.target}: ${open.printer.label}`
    : '';
  return (
    <Modal
      open={!!open}
      title={title}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="ghost"
            icon={<Trash2 size={16} />}
            onClick={() => void removePrinter()}
            disabled={busy}
          >
            Tirar impressora
          </Button>
          <Button onClick={onClose}>Fechar</Button>
        </>
      }
    >
      {open && (
        <p className="cm-hint">
          No computador <strong>{open.agent.name}</strong>.{' '}
          {open.printer.target === null
            ? 'Recebe tudo o que não tem impressora própria.'
            : `Recebe o que vai para ${open.printer.target}.`}
        </p>
      )}
      {data === null ? (
        <Skeleton variant="table" />
      ) : (
        <div className="print-printer">
          <section>
            <h3 className="print-printer__title">
              Próximos <Badge tone="neutral">{data.upcoming.length}</Badge>
            </h3>
            {data.upcoming.length === 0 ? (
              <p className="cm-hint">Nada esperando para esta impressora.</p>
            ) : (
              <ul className="print-jobs">
                {data.upcoming.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    wait={null}
                    onRetry={() => undefined}
                    onDiscard={() =>
                      void act(() =>
                        api('/printing/jobs/discard', { method: 'POST', json: { ids: [j.id] } }),
                      )
                    }
                  />
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="print-printer__title">
              Anteriores <Badge tone="neutral">{data.past.length}</Badge>
            </h3>
            {data.past.length === 0 ? (
              <p className="cm-hint">Nada impresso nesta impressora ainda.</p>
            ) : (
              <ul className="print-jobs">
                {data.past.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    wait={null}
                    onRetry={() =>
                      void act(() => api(`/printing/jobs/${j.id}/retry`, { method: 'POST' }))
                    }
                    onDiscard={() => undefined}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function JobRow({
  job: j,
  wait,
  onRetry,
  onDiscard,
  onDelete,
  selected,
  onSelect,
}: {
  job: PrintJob;
  wait: string | null;
  onRetry: () => void;
  onDiscard: () => void;
  onDelete?: () => void;
  selected?: boolean;
  onSelect?: (on: boolean) => void;
}) {
  const [label, tone] = STATUS[j.status];
  const today = new Date(j.createdAt).toDateString() === new Date().toDateString();
  const name = `${KIND[j.kind]}${j.orderNumber ? ` #${j.orderNumber}` : ''}`;
  return (
    <li className="print-job" data-status={j.status} data-selected={selected || undefined}>
      {onSelect && (
        <input
          type="checkbox"
          className="print-job__check"
          checked={!!selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`Escolher ${name} (${time(j.createdAt)})`}
        />
      )}
      <span className="print-job__when" title={dateTime(j.createdAt)}>
        {today ? time(j.createdAt) : dateTime(j.createdAt)}
      </span>
      <div className="print-job__what">
        <strong>
          {KIND[j.kind]}
          {j.orderNumber ? ` #${j.orderNumber}` : ''}
        </strong>
        <span className="cm-hint">
          {j.target}
          {j.agentName && ` · ${j.agentName}`}
        </span>
      </div>
      <div className="print-job__status">
        <Badge tone={tone}>{label}</Badge>
        {j.status === 'queued' && j.retryAt && new Date(j.retryAt) > new Date() ? (
          <span className="cm-hint">
            Tenta de novo às {time(j.retryAt)}
            {j.lastError && ` · ${j.lastError}`}
          </span>
        ) : (
          j.status === 'queued' &&
          wait && (
            <span className="cm-hint">
              {wait} · {ago(j.createdAt)}
            </span>
          )
        )}
        {j.status === 'failed' && j.lastError && <span className="cm-hint">{j.lastError}</span>}
        {(j.status === 'done' || j.status === 'failed') && j.printerLabel && (
          <span className="cm-hint">Em {j.printerLabel}</span>
        )}
      </div>
      <div className="print-job__actions">
        {(j.status === 'failed' || j.status === 'cancelled') && (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            {j.status === 'failed' ? 'Imprimir de novo' : 'Voltar para a fila'}
          </Button>
        )}
        {pending(j) && (
          <Button variant="ghost" size="sm" onClick={onDiscard}>
            Tirar da fila
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={16} />}
            onClick={onDelete}
            aria-label={`Apagar ${name}`}
            title="Apagar da lista"
          />
        )}
      </div>
    </li>
  );
}

/**
 * Fila de impressão: filtros por situação, destino e busca, seleção com ações em lote
 * (tirar da fila, imprimir de novo, apagar) e "Apagar histórico" por situação.
 */
function PrintQueueCard({
  summary,
  waitReason,
  healthState,
  onTest,
  onChanged,
}: {
  summary: JobsSummary | null;
  waitReason: string;
  healthState: PrintHealthState;
  onTest: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState<JobFilter>('all');
  const [target, setTarget] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PrintJob[] | null>(null);
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const shownRef = useRef(PAGE);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const query = useCallback(
    (limit: number, before?: string) => {
      const p = new URLSearchParams({ limit: String(limit) });
      if (filter !== 'all') p.set('status', filter);
      if (target) p.set('target', target);
      if (q) p.set('q', q);
      if (before) p.set('before', before);
      return api<PrintJob[]>(`/printing/jobs?${p}`);
    },
    [filter, target, q],
  );

  // Recarrega mantendo quantos já estavam na tela (até 200).
  const load = useCallback(async () => {
    try {
      const limit = Math.min(200, Math.max(PAGE, shownRef.current));
      const list = await query(limit);
      setItems(list);
      setMore(list.length === limit);
      setSelected((s) => new Set([...s].filter((id) => list.some((j) => j.id === id))));
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }, [query, toast]);
  useEffect(() => {
    shownRef.current = PAGE;
    setItems(null);
    setSelected(new Set());
    void load();
  }, [load]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'print.changed') reload();
  }, load);

  async function loadMore() {
    const last = items?.at(-1);
    if (!last) return;
    try {
      const next = await query(PAGE, last.createdAt);
      setItems((cur) => [...(cur ?? []), ...next]);
      shownRef.current = (items?.length ?? 0) + next.length;
      setMore(next.length === PAGE);
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  }

  async function run<T>(fn: () => Promise<T>, done: (r: T) => string) {
    setBusy(true);
    try {
      const r = await fn();
      toast(done(r), 'success');
      setSelected(new Set());
      onChanged();
      await load();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }
  const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

  const discard = (ids?: string[]) => {
    if (
      !ids &&
      !window.confirm(
        'Tirar da fila tudo o que ainda não imprimiu? Os computadores também apagam as comandas que estão paradas na fila do Windows.',
      )
    )
      return;
    void run(
      () =>
        api<{ discarded: number }>('/printing/jobs/discard', {
          method: 'POST',
          json: ids ? { ids } : {},
        }),
      (r) => `${plural(r.discarded, 'trabalho tirado', 'trabalhos tirados')} da fila`,
    );
  };
  const requeue = (ids: string[]) =>
    void run(
      () => api<{ requeued: number }>('/printing/jobs/requeue', { method: 'POST', json: { ids } }),
      (r) => `${plural(r.requeued, 'trabalho voltou', 'trabalhos voltaram')} para a fila`,
    );
  const remove = (ids: string[]) => {
    const pend = (items ?? []).filter((j) => ids.includes(j.id) && pending(j)).length;
    if (
      !window.confirm(
        `Apagar ${plural(ids.length, 'trabalho', 'trabalhos')} da lista?${pend ? ` ${plural(pend, 'ainda ia', 'ainda iam')} imprimir e não ${pend === 1 ? 'sai' : 'saem'} mais.` : ''} Não dá para desfazer.`,
      )
    )
      return;
    void run(
      () => api<{ deleted: number }>('/printing/jobs/delete', { method: 'POST', json: { ids } }),
      (r) => `${plural(r.deleted, 'trabalho apagado', 'trabalhos apagados')}`,
    );
  };

  const counts = summary?.counts;
  const pendingCount = counts ? counts.queued + counts.printing : 0;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  const historyCount = counts ? counts.done + counts.failed + counts.cancelled : 0;
  const chosen = (items ?? []).filter((j) => selected.has(j.id));
  const allOn = !!items?.length && items.every((j) => selected.has(j.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const filtered = !!target || !!q;

  return (
    <Card
      searchId="secao-fila"
      title="Fila de impressão"
      actions={
        <>
          {pendingCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => discard()} disabled={busy}>
              Limpar fila
            </Button>
          )}
          {historyCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={16} />}
              onClick={() => setHistoryOpen(true)}
              disabled={busy}
            >
              Apagar histórico
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onTest}>
            Imprimir teste
          </Button>
        </>
      }
      bodyless
    >
      {total === 0 && summary ? (
        <div className="cm-card__body">
          <EmptyState
            icon={<Printer size={20} />}
            title="Nada impresso ainda"
            description="Cada comanda e conferência aparece aqui, com a hora e se saiu na impressora."
          />
        </div>
      ) : (
        <>
          <div className="print-queue__bar">
            <Segmented
              label="Filtrar a fila"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Todos', count: total },
                { value: 'pending', label: 'Na fila', count: pendingCount },
                { value: 'done', label: 'Impressos', count: counts?.done ?? 0 },
                { value: 'failed', label: 'Falharam', count: counts?.failed ?? 0 },
                { value: 'cancelled', label: 'Tirados', count: counts?.cancelled ?? 0 },
              ]}
            />
            {pendingCount > 0 && (
              <span className={`print-queue__why print-queue__why--${healthState}`}>
                {waitReason}
              </span>
            )}
          </div>
          <div className="print-queue__tools">
            <label className="print-queue__search">
              <Search size={16} aria-hidden />
              <input
                className="cm-input"
                type="search"
                placeholder="Nº do pedido, destino ou computador"
                aria-label="Buscar na fila"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <Select
              aria-label="Destino"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="print-queue__target"
            >
              <option value="">Todos os destinos</option>
              {(summary?.targets ?? []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          {items && items.length > 0 && (
            <div className="print-queue__select" data-active={chosen.length > 0 || undefined}>
              <label className="print-queue__all">
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(items.map((j) => j.id)) : new Set())
                  }
                />
                {chosen.length
                  ? `${plural(chosen.length, 'escolhido', 'escolhidos')}`
                  : 'Escolher todos'}
              </label>
              {chosen.length > 0 && (
                <div className="print-queue__bulk">
                  {chosen.some(pending) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => discard(chosen.filter(pending).map((j) => j.id))}
                    >
                      Tirar da fila
                    </Button>
                  )}
                  {chosen.some((j) => j.status === 'failed' || j.status === 'cancelled') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        requeue(
                          chosen
                            .filter((j) => j.status === 'failed' || j.status === 'cancelled')
                            .map((j) => j.id),
                        )
                      }
                    >
                      Imprimir de novo
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 size={16} />}
                    disabled={busy}
                    onClick={() => remove(chosen.map((j) => j.id))}
                  >
                    Apagar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    Cancelar
                  </Button>
                </div>
              )}
            </div>
          )}
          {items === null ? (
            <div className="cm-card__body">
              <Skeleton variant="table" />
            </div>
          ) : items.length === 0 ? (
            <div className="cm-card__body">
              <EmptyState
                title={
                  filtered
                    ? 'Nada com esses filtros'
                    : filter === 'pending'
                      ? 'Nada esperando'
                      : 'Nada aqui'
                }
                description={
                  filtered
                    ? 'Troque a aba, o destino ou a busca.'
                    : 'Tudo o que foi enviado já saiu na impressora.'
                }
              />
            </div>
          ) : (
            <>
              <ul className="print-jobs">
                {items.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    wait={j.status === 'queued' ? waitReason : null}
                    selected={selected.has(j.id)}
                    onSelect={(on) => toggle(j.id, on)}
                    onRetry={() => requeue([j.id])}
                    onDiscard={() => discard([j.id])}
                    onDelete={() => remove([j.id])}
                  />
                ))}
              </ul>
              {more && (
                <div className="print-queue__more">
                  <Button variant="ghost" size="sm" onClick={() => void loadMore()}>
                    Mostrar mais
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
      <HistoryModal
        open={historyOpen}
        counts={counts}
        onClose={() => setHistoryOpen(false)}
        onConfirm={(statuses) => {
          setHistoryOpen(false);
          void run(
            () =>
              api<{ deleted: number }>('/printing/jobs/delete', {
                method: 'POST',
                json: { statuses },
              }),
            (r) => `${plural(r.deleted, 'trabalho apagado', 'trabalhos apagados')} do histórico`,
          );
        }}
      />
    </Card>
  );
}

/** Apagar o histórico por situação (a fila de espera nunca entra). */
function HistoryModal({
  open,
  counts,
  onClose,
  onConfirm,
}: {
  open: boolean;
  counts: JobsSummary['counts'] | undefined;
  onClose: () => void;
  onConfirm: (statuses: ('done' | 'failed' | 'cancelled')[]) => void;
}) {
  const [pick, setPick] = useState({ done: true, failed: true, cancelled: true });
  const chosen = (Object.keys(pick) as (keyof typeof pick)[]).filter((k) => pick[k]);
  const n = chosen.reduce((a, k) => a + (counts?.[k] ?? 0), 0);
  const rows: [keyof typeof pick, string][] = [
    ['done', 'Impressos'],
    ['failed', 'Falharam'],
    ['cancelled', 'Tirados da fila'],
  ];
  return (
    <Modal
      open={open}
      title="Apagar histórico"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            icon={<Trash2 size={16} />}
            disabled={n === 0}
            onClick={() => onConfirm(chosen)}
          >
            Apagar {n}
          </Button>
        </>
      }
    >
      <p className="cm-hint">
        Apaga da lista o que já passou pela impressora. O que ainda está na fila não muda. Não dá
        para desfazer.
      </p>
      <div className="print-history">
        {rows.map(([k, label]) => (
          <label key={k} className="print-history__row">
            <input
              type="checkbox"
              checked={pick[k]}
              onChange={(e) => setPick((p) => ({ ...p, [k]: e.target.checked }))}
            />
            <span>{label}</span>
            <Badge tone="neutral">{counts?.[k] ?? 0}</Badge>
          </label>
        ))}
      </div>
    </Modal>
  );
}

/** Cartão de topo: baixar o aplicativo (sistema do visitante em destaque) e os 3 passos. */
function DownloadHero({ online, onConnect }: { online: boolean; onConnect: () => void }) {
  const [os] = useState<DesktopOs>(() => detectOs());
  const main = PRINT_AGENT_DOWNLOADS[os];
  const others = (Object.keys(PRINT_AGENT_DOWNLOADS) as DesktopOs[]).filter((o) => o !== os);
  return (
    <section className="print-hero" data-search-id="secao-aplicativo">
      <div className="print-hero__intro">
        <div className="print-hero__icon" aria-hidden>
          <Printer size={26} />
        </div>
        <div>
          <h2 className="print-hero__title">
            Aplicativo Comandou Impressão
            {online && <Badge tone="success">imprimindo</Badge>}
          </h2>
          <p className="print-hero__text">
            Instale no computador que fica ligado à impressora (normalmente o do caixa). Ele roda em
            segundo plano, perto do relógio (com a bolinha verde quando está conectado), e imprime
            cada pedido na hora. Funciona com impressora térmica USB, de rede (cabo ou Wi-Fi),
            Bluetooth ou serial, e também com impressora comum (jato de tinta ou laser).
          </p>
          <div className="print-hero__actions">
            <a className="cm-btn cm-btn--primary cm-btn--lg" href={downloadUrl(os)} download>
              <Download size={18} /> Baixar para {main.label}
            </a>
            <Button
              variant="secondary"
              size="lg"
              icon={<MonitorSmartphone size={18} />}
              onClick={onConnect}
            >
              Conectar computador
            </Button>
          </div>
          <p className="cm-hint print-hero__others">
            {main.note}. Também para{' '}
            {others.map((o, i) => (
              <span key={o}>
                {i > 0 && ' e '}
                <a href={downloadUrl(o)} download>
                  {PRINT_AGENT_DOWNLOADS[o].label}
                </a>
              </span>
            ))}
            .
          </p>
        </div>
      </div>
      <ol className="print-steps">
        <li>
          <span className="print-steps__n">1</span>
          <div>
            <strong>Baixe e instale</strong>
            <span>Dois cliques no arquivo baixado. Não precisa de mais nada.</span>
          </div>
        </li>
        <li>
          <span className="print-steps__n">2</span>
          <div>
            <strong>Conecte o computador</strong>
            <span>Clique em Conectar computador e depois em Abrir no aplicativo.</span>
          </div>
        </li>
        <li>
          <span className="print-steps__n">3</span>
          <div>
            <strong>Escolha a impressora</strong>
            <span>
              O aplicativo procura sozinho (cabo, rede e Bluetooth). Clique em Usar na sua
              impressora e imprima um teste.
            </span>
          </div>
        </li>
      </ol>
    </section>
  );
}

function ConnectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string, token: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('PC do caixa');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      title="Conectar computador"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="print-connect" loading={busy} disabled={!name.trim()}>
            Gerar código
          </Button>
        </>
      }
    >
      <form
        id="print-connect"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await api<{ token: string }>('/printing/agents', {
              method: 'POST',
              json: { name: name.trim() },
            });
            onCreated(name.trim(), r.token);
          } catch (err) {
            toast((err as Error).message, 'danger');
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField
          label="Nome do computador"
          hint="Aparece aqui na lista, para você saber qual computador está imprimindo."
          placeholder="Ex.: PC do caixa"
          value={name}
          maxLength={60}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </form>
    </Modal>
  );
}

function AgentSetup({ name, token }: { name: string; token: string }) {
  const toast = useToast();
  const origin = window.location.origin;
  const code = connectionCode(origin, token, name);
  const copy = (text: string, what: string) =>
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast(`${what} copiado`, 'success'))
      .catch(() => toast('Selecione e copie o texto', 'danger'));
  return (
    <div className="print-setup">
      <p>
        Faça isto <strong>no computador ligado à impressora</strong>, com o aplicativo instalado:
      </p>
      <a className="cm-btn cm-btn--primary cm-btn--lg cm-btn--block" href={appLink(code)}>
        <ExternalLink size={18} /> Abrir no aplicativo
      </a>
      <div className="print-setup__or">
        <span>ou copie o código e cole no aplicativo</span>
      </div>
      <div className="print-setup__code">
        <code onClick={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)}>
          {code}
        </code>
        <Button variant="secondary" icon={<Copy size={16} />} onClick={() => copy(code, 'Código')}>
          Copiar
        </Button>
      </div>
      <Alert tone="warning">
        Este código aparece só agora e liga um computador a este restaurante. Não mande por grupo
        nem poste em print. Se perder, é só gerar outro.
      </Alert>
      <details className="print-setup__adv">
        <summary>Linha de comando (servidor Linux, avançado)</summary>
        <p className="cm-hint">
          Sem tela, com Node.js 22, rode o agente da pasta tools/print-agent do projeto:
        </p>
        <pre className="code-block">
          {`COMANDOU_CODE=<código acima> \\\nPRINTER_DEFAULT=tcp://192.168.0.50:9100 \\\nnode agent.mjs`}
        </pre>
        <p className="cm-hint">
          Outras impressoras: <code>serial:/dev/rfcomm0</code> (Bluetooth),{' '}
          <code>serial:/dev/ttyUSB0?baud=19200</code> (serial), <code>file:/dev/usb/lp0</code> (USB
          direto). Papel de 58 mm: acrescente <code>?papel=58</code>.
        </p>
      </details>
    </div>
  );
}

/** Tipos de ligação: o que fazer antes de abrir o aplicativo. O passo a passo completo fica no app. */
const CONNECTIONS: { icon: ReactNode; title: string; steps: string[] }[] = [
  {
    icon: <Usb size={18} />,
    title: 'USB',
    steps: [
      'Ligue o cabo no computador e instale o driver do fabricante.',
      'Sem driver no Windows: adicione como "Generic / Text Only" na porta USB001.',
      'No aplicativo ela aparece sozinha na lista: clique em Usar.',
    ],
  },
  {
    icon: <Network size={18} />,
    title: 'Rede com cabo',
    steps: [
      'Ligue o cabo da impressora no roteador.',
      'Segure o botão FEED ao ligar: a folha de autoteste mostra o IP.',
      'O aplicativo procura na rede sozinho: clique em Usar.',
    ],
  },
  {
    icon: <Wifi size={18} />,
    title: 'Wi-Fi',
    steps: [
      'Coloque a impressora no Wi-Fi do restaurante (programa do fabricante ou WPS).',
      'Reserve o IP dela no roteador para não mudar.',
      'O aplicativo acha na rede sozinho: clique em Usar.',
    ],
  },
  {
    icon: <Bluetooth size={18} />,
    title: 'Bluetooth',
    steps: [
      'Pareie com o computador (PIN 0000 ou 1234).',
      'Desconecte do celular: ela aceita uma conexão por vez.',
      'Ela aparece na lista do aplicativo: clique em Usar.',
    ],
  },
  {
    icon: <FileText size={18} />,
    title: 'Impressora comum',
    steps: [
      'Jato de tinta ou laser (Epson, HP, Canon…) instalada no computador.',
      'Ela imprime a comanda numa folha A4, sem abrir janela.',
      'Na lista do aplicativo ela vem marcada como Folha: clique em Usar.',
    ],
  },
  {
    icon: <Cable size={18} />,
    title: 'Serial (COM)',
    steps: [
      'Ligue o cabo RS-232 ou o adaptador USB-serial (com o driver dele).',
      'Veja a velocidade (baud rate) na folha de autoteste.',
      'Ela aparece na lista do aplicativo (porta COM): clique em Usar.',
    ],
  },
];

function ConnectionGuide() {
  return (
    <Card searchId="secao-ligacao" title="Como ligar a impressora">
      <p className="cm-hint print-conn__intro">
        Veja atrás da impressora como ela se liga e faça isto antes de abrir o aplicativo. Tem mais
        de uma opção? Prefira a rede com cabo. O botão <strong>Ajuda</strong> do aplicativo tem o
        passo a passo completo e os problemas mais comuns.
      </p>
      <div className="print-conn">
        {CONNECTIONS.map((c) => (
          <section key={c.title} className="print-conn__item">
            <h3 className="print-conn__title">
              <span className="print-conn__icon" aria-hidden>
                {c.icon}
              </span>
              {c.title}
            </h3>
            <ol>
              {c.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      <details className="print-conn__trouble">
        <summary>Saiu errado? Os problemas mais comuns</summary>
        <ul>
          <li>
            <strong>Papel em branco:</strong> a bobina está virada. O lado que imprime escurece ao
            riscar com a unha.
          </li>
          <li>
            <strong>Linhas quebradas ou cortadas:</strong> bobina de 58 mm. No aplicativo, Trocar ›
            Papel 58 mm.
          </li>
          <li>
            <strong>Acentos viraram símbolos:</strong> no aplicativo, Trocar › Acentos › CP850 (ou
            Sem acentos).
          </li>
          <li>
            <strong>Parou de imprimir na rede:</strong> o IP mudou. Imprima a folha de autoteste e
            confira; reserve o IP no roteador.
          </li>
          <li>
            <strong>Comandas não saem, mas o teste sim:</strong> o computador entrou em suspensão ou
            o aplicativo foi fechado. Veja se ele está online em Computadores conectados.
          </li>
        </ul>
      </details>
    </Card>
  );
}
