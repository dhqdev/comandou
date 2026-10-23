import { Copy, Plus, Printer } from 'lucide-react';
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
import { api } from '../lib/api';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { PrintAgent, PrintJob } from '../lib/types';

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
 * Impressão: um pequeno programa (agente) roda no computador do restaurante, ligado às
 * impressoras térmicas, e busca os trabalhos aqui. Comandas de cozinha saem sozinhas a cada pedido.
 */
export function PrintingPage() {
  const toast = useToast();
  const [agents, setAgents] = useState<PrintAgent[] | null>(null);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
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

  return (
    <>
      <div>
        <h1 className="page-title">Impressão</h1>
        <p className="page-sub">
          Agentes instalados nos computadores do restaurante e a fila de impressão.
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Card searchId="secao-agentes" title="Agentes de impressão">
        <form
          className="filters"
          style={{ alignItems: 'end' }}
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await call<{ token: string }>('/printing/agents', { name });
            if (r) {
              setSecret({ name, token: r.token });
              setName('');
            }
          }}
        >
          <TextField
            label="Nome do computador"
            placeholder="Ex.: PC do caixa"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" icon={<Plus size={16} />} disabled={!name.trim()}>
            Adicionar agente
          </Button>
        </form>
        {agents === null ? (
          <Spinner />
        ) : agents.length === 0 ? (
          <EmptyState
            icon={<Printer size={20} />}
            title="Nenhum agente"
            description="Sem agente ativo, os pedidos funcionam normalmente, só não imprimem."
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
                    novo token
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
      <Modal
        open={!!secret}
        title={`Token do agente "${secret?.name ?? ''}"`}
        onClose={() => setSecret(null)}
      >
        {secret && <AgentSetup token={secret.token} />}
      </Modal>
    </>
  );
}

function AgentSetup({ token }: { token: string }) {
  const toast = useToast();
  const origin = window.location.origin;
  return (
    <>
      <Alert tone="warning">
        Copie agora: este token não aparece de novo. Quem tiver o token consegue ler a fila de
        impressão deste restaurante.
      </Alert>
      <TextField label="Token" readOnly value={token} onFocus={(e) => e.target.select()} />
      <Button
        variant="secondary"
        icon={<Copy size={16} />}
        onClick={() =>
          navigator.clipboard
            ?.writeText(token)
            .then(() => toast('Token copiado', 'success'))
            .catch(() => toast('Selecione e copie o texto', 'danger'))
        }
      >
        Copiar token
      </Button>
      <p className="cm-hint">
        No computador ligado à impressora, com Node.js 22 instalado, rode o agente (pasta
        tools/print-agent do projeto):
      </p>
      <pre className="code-block">
        {`COMANDOU_URL=${origin} \\\nCOMANDOU_AGENT_TOKEN=<token> \\\nPRINTER_DEFAULT=tcp://192.168.0.50:9100 \\\nnode agent.mjs`}
      </pre>
    </>
  );
}
