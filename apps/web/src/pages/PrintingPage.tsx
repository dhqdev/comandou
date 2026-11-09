import {
  Bluetooth,
  Cable,
  Copy,
  Download,
  ExternalLink,
  MonitorSmartphone,
  Network,
  Plus,
  Printer,
  Usb,
  Wifi,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
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
import { PrintTemplatesCard } from '../features/PrintTemplates';
import { api } from '../lib/api';
import { useDebounced, useRealtime } from '../lib/realtime';
import type { PrintAgent, PrintJob } from '../lib/types';
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
        <div className="page-title-row">
          <h1 className="page-title">Impressão</h1>
          <TourButton tour="impressao" />
        </div>
        <p className="page-sub">
          Comandas de cozinha e conferências saem sozinhas nas impressoras térmicas do restaurante.
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}

      <DownloadHero online={online} onConnect={() => setConnectOpen(true)} />

      <ConnectionGuide />

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
            USB, de rede (cabo ou Wi-Fi), Bluetooth ou serial.
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
              No aplicativo, clique em Adicionar impressora, diga como ela está ligada e imprima um
              teste.
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
      'No aplicativo: Adicionar impressora › USB.',
    ],
  },
  {
    icon: <Network size={18} />,
    title: 'Rede com cabo',
    steps: [
      'Ligue o cabo da impressora no roteador.',
      'Segure o botão FEED ao ligar: a folha de autoteste mostra o IP.',
      'No aplicativo: Adicionar impressora › Rede. Ele procura sozinho.',
    ],
  },
  {
    icon: <Wifi size={18} />,
    title: 'Wi-Fi',
    steps: [
      'Coloque a impressora no Wi-Fi do restaurante (programa do fabricante ou WPS).',
      'Reserve o IP dela no roteador para não mudar.',
      'No aplicativo: Adicionar impressora › Rede.',
    ],
  },
  {
    icon: <Bluetooth size={18} />,
    title: 'Bluetooth',
    steps: [
      'Pareie com o computador (PIN 0000 ou 1234).',
      'Desconecte do celular: ela aceita uma conexão por vez.',
      'No aplicativo: Adicionar impressora › Bluetooth.',
    ],
  },
  {
    icon: <Cable size={18} />,
    title: 'Serial (COM)',
    steps: [
      'Ligue o cabo RS-232 ou o adaptador USB-serial (com o driver dele).',
      'Veja a velocidade (baud rate) na folha de autoteste.',
      'No aplicativo: Adicionar impressora › Serial.',
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
