import { Copy, Download, ExternalLink, MonitorSmartphone, Plus, Printer } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Spinner,
  TextField,
  useToast,
} from '../design-system';
import { dateTime } from '../features/format';
import {
  appLink,
  connectionCode,
  detectOs,
  downloadUrl,
  PRINT_AGENT_DOWNLOADS,
  type DesktopOs,
} from '../features/print-agent';
import { api } from '../lib/api';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { PrintAgent, PrintJob } from '../lib/types';
import './printing.css';

const KIND: Record<PrintJob['kind'], string> = {
  kitchen_ticket: 'Comanda',
  receipt: 'Conferência',
  test: 'Teste',
};
const STATUS: Record<PrintJob['status'], [string, 'neutral' | 'info' | 'success' | 'danger']> = {
  queued: ['Na fila', 'neutral'],
  printing: ['Imprimindo', 'info'],
  done: ['Impresso', 'success'],
  failed: ['Falhou', 'danger'],
};

/**
 * Impressão: o aplicativo "Comandou Impressão" roda no computador do restaurante, ligado às
 * impressoras térmicas, e busca os trabalhos aqui. Comandas de cozinha saem sozinhas a cada pedido.
 */
export function PrintingPage() {
  const toast = useToast();
  const [agents, setAgents] = useState<PrintAgent[] | null>(null);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [secret, setSecret] = useState<{ name: string; token: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, j] = await Promise.all([
        api<PrintAgent[]>('/printing/agents'),
        api<PrintJob[]>('/printing/jobs?limit=50'),
      ]);
      setAgents(a);
      setJobs(j);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const reload = useDebounced(load);
  useRealtime((e) => {
    if (e.type === 'print.changed') reload();
  }, load);

  async function call<T>(url: string, json: object = {}, method: 'POST' | 'PATCH' = 'POST') {
    try {
      const r = await api<T>(url, { method, json });
      await load();
      return r;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return undefined;
    }
  }

  const online = agents?.some((a) => a.active && a.online) ?? false;

  return (
    <>
      <div>
        <h1 className="page-title">Impressão</h1>
        <p className="page-sub">
          Comandas de cozinha e conferências saem sozinhas nas impressoras térmicas do restaurante.
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}

      <DownloadHero online={online} onConnect={() => setConnectOpen(true)} />

      <Card
        searchId="secao-agentes"
        title="Computadores conectados"
        actions={
          <Button
            variant="secondary"
            icon={<Plus size={16} />}
            onClick={() => setConnectOpen(true)}
          >
            Conectar computador
          </Button>
        }
      >
        {agents === null ? (
          <Spinner />
        ) : agents.length === 0 ? (
          <EmptyState
            icon={<Printer size={20} />}
            title="Nenhum computador conectado"
            description="Sem o aplicativo, os pedidos funcionam normalmente, só não imprimem."
          />
        ) : (
          <ul className="plain-list">
            {agents.map((a) => (
              <li key={a.id} data-search-id={`agente-${a.id}`} style={{ flexWrap: 'wrap', gap: 8 }}>
                <span>
                  <strong>{a.name}</strong>{' '}
                  {!a.active ? (
                    <Badge>desativado</Badge>
                  ) : a.online ? (
                    <Badge tone="success">online</Badge>
                  ) : (
                    <Badge tone="warning">offline</Badge>
                  )}
                  <span className="cm-hint">
                    {' '}
                    {a.lastSeenAt ? `visto ${dateTime(a.lastSeenAt)}` : 'nunca conectou'}
                    {a.version && ` · v${a.version}`}
                  </span>
                </span>
                <span className="actions-row">
                  <button
                    className="link-btn"
                    onClick={async () => {
                      const r = await call<{ token: string }>(`/printing/agents/${a.id}/token`);
                      if (r) setSecret({ name: a.name, token: r.token });
                    }}
                  >
                    gerar novo código
                  </button>
                  <button
                    className="link-btn"
                    onClick={() => call(`/printing/agents/${a.id}`, { active: !a.active }, 'PATCH')}
                  >
                    {a.active ? 'desativar' : 'ativar'}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        searchId="secao-fila"
        title="Fila de impressão"
        actions={
          <Button
            variant="secondary"
            onClick={async () => {
              if (await call('/printing/test', { target: 'Caixa' }))
                toast('Página de teste enviada', 'success');
            }}
          >
            Imprimir teste
          </Button>
        }
        bodyless
      >
        {jobs.length === 0 ? (
          <EmptyState title="Nada impresso ainda" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="cm-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>O quê</th>
                  <th>Destino</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{dateTime(j.createdAt)}</td>
                    <td>
                      {KIND[j.kind]} {j.orderNumber && `#${j.orderNumber}`}
                    </td>
                    <td>{j.target}</td>
                    <td>
                      <Badge tone={STATUS[j.status][1]}>{STATUS[j.status][0]}</Badge>
                      {j.lastError && <div className="cm-hint">{j.lastError}</div>}
                    </td>
                    <td className="cm-num">
                      {j.status === 'failed' && (
                        <Button
                          variant="ghost"
                          onClick={() => call(`/printing/jobs/${j.id}/retry`)}
                        >
                          Tentar de novo
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onCreated={(name, token) => {
          setConnectOpen(false);
          setSecret({ name, token });
          void load();
        }}
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
            segundo plano, perto do relógio, e imprime cada pedido na hora. Funciona com impressora
            USB ou de rede.
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
            <span>No aplicativo, selecione a impressora e clique em Testar.</span>
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
      </details>
    </div>
  );
}
