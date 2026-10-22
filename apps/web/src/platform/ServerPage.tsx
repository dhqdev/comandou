import { RefreshCw, RotateCcw, ScrollText, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, Modal, Spinner, useToast } from '../design-system';
import { dateTime } from '../features/format';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import type { DockerDisk, ServerContainer, ServerService, ServerStatus } from './types';
import {
  ago,
  bytes,
  Dot,
  duration,
  Level,
  levelFor,
  Section,
  Sparkline,
  Tabs,
  Tag,
  Tile,
  useInterval,
} from './ui';
import { ConsumptionRanking } from './TenantInsights';

const rate = (bps: number | null) => (bps === null ? '—' : `${bytes(bps)}/s`);

function serviceLevel(s: ServerService): Level {
  if (s.desired === 0) return 'off';
  if (s.desired !== null && s.running < s.desired) return s.running === 0 ? 'bad' : 'warn';
  return 'ok';
}

const CLEANUP: { key: string; title: string; text: string }[] = [
  {
    key: 'containers',
    title: 'Containers parados',
    text: 'Restos de tarefas que já terminaram ou falharam. Nada que esteja rodando é tocado.',
  },
  {
    key: 'images',
    title: 'Imagens órfãs',
    text: 'Camadas sem nome deixadas por atualizações. Seguro sempre.',
  },
  {
    key: 'build-cache',
    title: 'Cache de build',
    text: 'Restos de builds de imagem feitos no servidor.',
  },
  {
    key: 'unused-images',
    title: 'Todas as imagens sem uso',
    text: 'Versões antigas que nenhum container usa. São baixadas de novo se precisar (rollback fica mais lento).',
  },
];

export function ServerPage() {
  const { data, error, reload } = useLoad<ServerStatus>('/platform/server');
  const [tab, setTab] = useState<'services' | 'containers'>('services');
  const [svc, setSvc] = useState<ServerService | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [filter, setFilter] = useState('');
  useInterval(reload, 10_000);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <Spinner />;
  if (!data.enabled)
    return (
      <>
        <Section title="Servidor">
          <div className="adm-panel adm-panel__body">
            <p style={{ marginTop: 0 }}>
              O agente do servidor ainda não está instalado. Ele é um serviço pequeno da própria
              stack (<code>comandou-agent</code>) que lê CPU, memória, disco e rede da VM e fala com
              o Docker para listar, limpar, reiniciar e mostrar logs.
            </p>
            <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
              Na API: HOST_AGENT_URL e HOST_AGENT_TOKEN. Passo a passo em docs/deploy.md, seção
              “Agente do servidor”.
            </p>
          </div>
        </Section>
        <ConsumptionRanking />
      </>
    );

  const h = data.host;
  const memPct = (h.memory.used / h.memory.total) * 100;
  const disk = h.disks[0];
  const diskPct = disk ? ((disk.total - disk.free) / disk.total) * 100 : null;
  const docker = 'error' in data.docker ? null : data.docker;
  const hist = data.history;
  const q = filter.trim().toLowerCase();
  const services = (docker?.services ?? []).filter(
    (s) => !q || s.name.toLowerCase().includes(q) || s.image.toLowerCase().includes(q),
  );
  const containers = (docker?.containers.list ?? []).filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q),
  );
  const badServices = (docker?.services ?? []).filter(
    (s) => serviceLevel(s) !== 'ok' && s.desired !== 0,
  );

  return (
    <>
      <Section title="Servidor" sub={`${h.hostname} · ligado há ${duration(h.uptimeSec)}`}>
        <div className="adm-grid">
          <Tile
            label="CPU"
            value={h.cpu.percent === null ? '—' : `${h.cpu.percent.toFixed(1)}%`}
            level={levelFor(h.cpu.percent)}
            sub={`${h.cores} núcleos · carga ${h.load[0].toFixed(2)}`}
            meter={h.cpu.percent}
          />
          <Tile
            label="Memória"
            value={`${memPct.toFixed(1)}%`}
            level={levelFor(memPct)}
            sub={`${bytes(h.memory.used)} de ${bytes(h.memory.total)}`}
            meter={memPct}
          />
          <Tile
            label="Disco /"
            value={diskPct === null ? '—' : `${diskPct.toFixed(1)}%`}
            level={levelFor(diskPct, 80, 90)}
            sub={disk ? `${bytes(disk.free)} livres de ${bytes(disk.total)}` : ''}
            meter={diskPct}
          />
          <Tile
            label="Rede ↓"
            value={rate(h.network.rxBps)}
            sub={`↑ ${rate(h.network.txBps)} envio`}
          />
          <Tile
            label="Containers"
            value={
              docker ? (
                <>
                  {docker.containers.running}
                  <small>/{docker.containers.total}</small>
                </>
              ) : (
                '—'
              )
            }
            level={docker ? 'ok' : 'bad'}
            sub={
              docker
                ? `${docker.containers.total - docker.containers.running} parado(s)`
                : 'Docker indisponível'
            }
          />
          <Tile
            label="Serviços"
            value={docker ? docker.services.length : '—'}
            level={badServices.length ? 'bad' : docker ? 'ok' : 'off'}
            sub={
              badServices.length
                ? `${badServices.length} com problema: ${badServices[0]!.name}`
                : 'todos rodando'
            }
          />
        </div>
        {!docker && (
          <Alert tone="danger">Docker: {'error' in data.docker ? data.docker.error : ''}</Alert>
        )}
      </Section>

      <Section title="Recursos" sub="últimos 30 min">
        <div className="adm-two">
          <div className="adm-panel">
            <div className="adm-panel__head">
              <span className="adm-label">CPU</span>
              <span className="adm-top__spacer" />
              <span className="adm-sub">steal {h.cpu.steal.toFixed(1)}%</span>
            </div>
            <div className="adm-panel__body">
              <Sparkline values={hist.map((x) => x.cpu)} max={100} label="Uso de CPU" />
              <dl className="adm-kv" style={{ marginTop: 12 }}>
                <dt>Carga (1/5/15 min)</dt>
                <dd>{h.load.map((l) => l.toFixed(2)).join('  ')}</dd>
              </dl>
            </div>
          </div>
          <div className="adm-panel">
            <div className="adm-panel__head">
              <span className="adm-label">Memória</span>
              <span className="adm-top__spacer" />
              <span className="adm-sub">swap {bytes(h.memory.swapUsed)}</span>
            </div>
            <div className="adm-panel__body">
              <Sparkline
                values={hist.map((x) => x.mem)}
                max={100}
                color="var(--a-info)"
                label="Uso de memória"
              />
              <dl className="adm-kv" style={{ marginTop: 12 }}>
                <dt>Disponível</dt>
                <dd>{bytes(h.memory.available)}</dd>
              </dl>
            </div>
          </div>
          <div className="adm-panel">
            <div className="adm-panel__head">
              <span className="adm-label">Rede</span>
              <span className="adm-top__spacer" />
              <span className="adm-sub">
                ↓ {rate(h.network.rxBps)} · ↑ {rate(h.network.txBps)}
              </span>
            </div>
            <div className="adm-panel__body">
              <Sparkline
                values={hist.map((x) => x.rxBps + x.txBps)}
                color="var(--a-accent)"
                label="Tráfego de rede"
              />
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Docker"
        sub={docker ? `v${docker.version}${docker.swarm ? ' · swarm' : ''}` : undefined}
        actions={
          <button className="adm-action" onClick={() => setCleanupOpen(true)}>
            <Trash2 size={14} /> Limpar
          </button>
        }
      >
        <div className="adm-search">
          <input
            className="cm-input"
            placeholder="filtrar por nome ou imagem"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filtrar"
          />
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            ['services', `Serviços (${docker?.services.length ?? 0})`],
            ['containers', `Containers (${docker?.containers.total ?? 0})`],
          ]}
        />
        <div className="adm-panel">
          {tab === 'services' ? (
            services.length === 0 ? (
              <div className="adm-empty">Nenhum serviço</div>
            ) : (
              <div className="adm-rows">
                {services.map((s) => (
                  <button key={s.id} className="adm-row" onClick={() => setSvc(s)}>
                    <Dot level={serviceLevel(s)} />
                    <span className="adm-row__main">
                      <span className="adm-row__title">{s.name}</span>
                      <span className="adm-row__meta">
                        {s.lastError && serviceLevel(s) !== 'ok' ? s.lastError : s.image}
                      </span>
                    </span>
                    <span className="adm-row__side">
                      {s.mode === 'global' ? `${s.running} global` : `${s.running}/${s.desired}`}
                    </span>
                  </button>
                ))}
              </div>
            )
          ) : containers.length === 0 ? (
            <div className="adm-empty">Nenhum container</div>
          ) : (
            <div className="adm-rows">
              {containers.map((c) => (
                <ContainerRow key={c.id} c={c} />
              ))}
            </div>
          )}
        </div>
      </Section>

      <ConsumptionRanking />

      {svc && (
        <ServiceSheet
          service={svc}
          onClose={() => setSvc(null)}
          onRestarted={() => {
            setSvc(null);
            setTimeout(reload, 1500);
          }}
        />
      )}
      {cleanupOpen && (
        <CleanupSheet
          onClose={() => setCleanupOpen(false)}
          onDone={() => setTimeout(reload, 500)}
        />
      )}
    </>
  );
}

function ContainerRow({ c }: { c: ServerContainer }) {
  const level: Level =
    c.state === 'running'
      ? 'ok'
      : c.state === 'restarting'
        ? 'warn'
        : c.state === 'exited' && /\(0\)/.test(c.status)
          ? 'off'
          : c.state === 'created'
            ? 'off'
            : 'bad';
  return (
    <div className="adm-row">
      <Dot level={level} />
      <span className="adm-row__main">
        <span className="adm-row__title">{c.service ?? c.name}</span>
        <span className="adm-row__meta">
          {c.status} · {c.image}
        </span>
      </span>
      <span className="adm-row__side">{c.memoryBytes !== null ? bytes(c.memoryBytes) : ''}</span>
    </div>
  );
}

function ServiceSheet({
  service,
  onClose,
  onRestarted,
}: {
  service: ServerService;
  onClose: () => void;
  onRestarted: () => void;
}) {
  const toast = useToast();
  const [logs, setLogs] = useState<string | null>(null);
  const [tail, setTail] = useState(200);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function loadLogs(n = tail) {
    setBusy('logs');
    try {
      const r = await api<{ text: string }>(
        `/platform/server/services/${encodeURIComponent(service.name)}/logs?tail=${n}`,
      );
      setLogs(r.text || '(sem linhas)');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function restart() {
    setBusy('restart');
    try {
      await api(`/platform/server/services/${encodeURIComponent(service.name)}/restart`, {
        method: 'POST',
      });
      toast(`${service.name} reiniciando`, 'success');
      onRestarted();
    } catch (e) {
      toast((e as Error).message, 'danger');
      setBusy(null);
    }
  }

  return (
    <Modal open title={service.name} onClose={onClose} size="xl">
      <dl className="adm-kv">
        <dt>Situação</dt>
        <dd>
          <Tag level={serviceLevel(service)}>
            {service.mode === 'global'
              ? `${service.running} rodando (global)`
              : `${service.running} de ${service.desired} rodando`}
          </Tag>
        </dd>
        <dt>Imagem</dt>
        <dd>{service.image}</dd>
        <dt>Atualizado</dt>
        <dd>
          {dateTime(service.updatedAt)} ({ago(service.updatedAt)})
          {service.updateState ? ` · ${service.updateState}` : ''}
        </dd>
        {service.stack && (
          <>
            <dt>Stack</dt>
            <dd>{service.stack}</dd>
          </>
        )}
        {service.lastError && (
          <>
            <dt>Último erro</dt>
            <dd style={{ color: 'var(--a-bad)' }}>{service.lastError}</dd>
          </>
        )}
      </dl>
      <div className="adm-actions" style={{ margin: '16px 0' }}>
        <button className="adm-action" disabled={!!busy} onClick={() => loadLogs()}>
          <ScrollText size={14} />{' '}
          {busy === 'logs' ? 'Carregando…' : logs ? 'Atualizar logs' : 'Ver logs'}
        </button>
        {logs && (
          <select
            className="cm-input"
            style={{ width: 'auto', minHeight: 40 }}
            value={tail}
            onChange={(e) => {
              const n = Number(e.target.value);
              setTail(n);
              void loadLogs(n);
            }}
            aria-label="Linhas"
          >
            {[100, 200, 500, 1000].map((n) => (
              <option key={n} value={n}>
                {n} linhas
              </option>
            ))}
          </select>
        )}
        {!confirm ? (
          <button className="adm-action adm-action--danger" onClick={() => setConfirm(true)}>
            <RotateCcw size={14} /> Reiniciar
          </button>
        ) : (
          <button
            className="adm-action adm-action--primary"
            disabled={busy === 'restart'}
            onClick={restart}
          >
            <RefreshCw size={14} /> {busy === 'restart' ? 'Reiniciando…' : 'Confirmar reinício'}
          </button>
        )}
      </div>
      {confirm && (
        <p className="adm-sub" style={{ whiteSpace: 'normal', marginTop: -6 }}>
          Sobe tarefas novas do serviço (como <code>docker service update --force</code>). Com uma
          réplica só, fica fora do ar por alguns segundos.
        </p>
      )}
      {logs !== null && <pre className="adm-log">{logs}</pre>}
    </Modal>
  );
}

function CleanupSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: df, error } = useLoad<DockerDisk>('/platform/server/disk');
  const [sel, setSel] = useState<string[]>(['containers', 'images', 'build-cache']);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { target: string; reclaimed: number; removed: number; error?: string }[] | null
  >(null);

  const estimate: Record<string, string> = df
    ? {
        containers: `${df.containers.stopped} parado(s) · ${bytes(df.containers.reclaimable)}`,
        images: `${df.images.count} imagens no total`,
        'build-cache': bytes(df.buildCache.reclaimable),
        'unused-images': `${df.images.unused} sem uso · até ${bytes(df.images.reclaimable)}`,
      }
    : {};

  async function run() {
    setBusy(true);
    try {
      const r = await api<{ results: NonNullable<typeof result> }>('/platform/server/cleanup', {
        method: 'POST',
        json: { targets: sel },
      });
      setResult(r.results);
      const total = r.results.reduce((s, x) => s + x.reclaimed, 0);
      toast(`Liberado ${bytes(total)}`, 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Limpar o Docker"
      onClose={onClose}
      size="lg"
      footer={
        result ? (
          <button className="adm-action" onClick={onClose}>
            Fechar
          </button>
        ) : (
          <button
            className="adm-action adm-action--primary"
            disabled={!sel.length || busy}
            onClick={run}
          >
            <Trash2 size={14} /> {busy ? 'Limpando…' : 'Limpar selecionados'}
          </button>
        )
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {result ? (
        <div className="adm-panel">
          <div className="adm-rows">
            {result.map((r) => (
              <div key={r.target} className="adm-row">
                <Dot level={r.error ? 'bad' : 'ok'} />
                <span className="adm-row__main">
                  <span className="adm-row__title">
                    {CLEANUP.find((c) => c.key === r.target)?.title}
                  </span>
                  <span className="adm-row__meta">{r.error ?? `${r.removed} removido(s)`}</span>
                </span>
                <span className="adm-row__side">{bytes(r.reclaimed)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {CLEANUP.map((c) => (
            <label key={c.key} className="adm-check">
              <input
                type="checkbox"
                checked={sel.includes(c.key)}
                onChange={(e) =>
                  setSel((s) => (e.target.checked ? [...s, c.key] : s.filter((x) => x !== c.key)))
                }
              />
              <span>
                <strong>{c.title}</strong>
                <span className="adm-sub" style={{ whiteSpace: 'normal', display: 'block' }}>
                  {c.text}
                </span>
                <span className="adm-label">{df ? estimate[c.key] : 'calculando…'}</span>
              </span>
            </label>
          ))}
          <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
            Volumes (dados do banco, sessões do WhatsApp) nunca são apagados por aqui.
          </p>
        </div>
      )}
    </Modal>
  );
}
