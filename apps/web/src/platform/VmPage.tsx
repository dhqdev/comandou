import {
  ArrowUpCircle,
  Box,
  Power,
  RefreshCw,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Modal, Spinner, useToast } from '../design-system';
import { dateTime } from '../features/format';
import { api } from '../lib/api';
import { useLoad } from './OverviewPages';
import { CleanupSheet } from './ServerPage';
import { ago, bytes, Dot, Level, PageHead, Section, Tag, Tile, useInterval } from './ui';

/** O que o ajudante da VM (scripts/vm.sh) escreve em info.json. */
interface VmInfo {
  helperVersion: number;
  collectedAt: string;
  os: {
    name: string;
    id: string;
    version: string;
    codename: string;
    kernel: string;
    arch: string;
    timezone: string;
    ntpSynced: string;
    bootedAt: string;
  };
  reboot: { required: boolean; packages: string };
  updates: {
    lastCheck: string;
    total: number;
    security: number;
    docker: boolean;
    autoremove: number | null;
    list: { name: string; from: string; to: string; security: boolean }[];
  };
  packages: { name: string; version: string }[];
  security: { firewall: string; autoUpdates: boolean };
  cache: { apt: number | null; journal: number | null; logs: number | null; ram: number | null };
  install: {
    dir: string;
    version: string;
    config: string;
    configExists: boolean;
    standard: boolean;
    logs: string;
    data: string;
  };
}
export interface VmJob {
  id: string;
  action: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  exitCode: number | null;
  targets?: string[];
}
type VmState =
  | { enabled: false }
  | {
      enabled: true;
      installed: boolean;
      outdated?: boolean;
      stuck?: boolean;
      info?: VmInfo | null;
      jobs?: VmJob[];
    };
interface Component {
  service: string;
  stack: string | null;
  product: string;
  image: string;
  tag: string;
  version: string;
  runtimes: { name: string; version: string }[];
  builtAt: string | null;
  comandou: boolean;
  canUpdate: boolean;
  updateState: string | null;
  update: { status: 'current' | 'available' | 'unknown' | 'managed'; error?: string };
}
interface Components {
  checkedAt: string;
  engine: { version: string | null; components: { name: string; version: string }[] } | null;
  agent: { node: string; openssl: string };
  components: Component[];
}

const ACTION_LABEL: Record<string, string> = {
  check: 'Procurar atualizações',
  upgrade: 'Atualizar tudo',
  'upgrade-security': 'Atualizar só segurança',
  clean: 'Limpar a VM',
  'restart-docker': 'Reiniciar o Docker',
  reboot: 'Reiniciar a VM',
};
const JOB_LEVEL: Record<VmJob['status'], Level> = {
  pending: 'off',
  running: 'info',
  done: 'ok',
  failed: 'bad',
};
const JOB_LABEL: Record<VmJob['status'], string> = {
  pending: 'na fila',
  running: 'rodando…',
  done: 'ok',
  failed: 'falhou',
};
const PACKAGE_LABEL: Record<string, string> = {
  'docker-ce': 'Docker Engine (pacote)',
  'docker-ce-cli': 'Docker CLI',
  'containerd.io': 'containerd (pacote)',
  'docker.io': 'Docker (Ubuntu)',
  'docker-compose-plugin': 'Docker Compose',
  'docker-buildx-plugin': 'Docker Buildx',
  'openssh-server': 'OpenSSH',
  openssl: 'OpenSSL',
  systemd: 'systemd',
  curl: 'curl',
  'ca-certificates': 'Certificados raiz',
  ufw: 'Firewall (ufw)',
  'unattended-upgrades': 'Atualização automática',
};

const CLEAN: { key: 'apt' | 'journal' | 'logs' | 'ram'; title: string; text: string }[] = [
  {
    key: 'apt',
    title: 'Cache de pacotes',
    text: 'Instaladores já usados do apt e pacotes que sobraram (kernels antigos). Seguro sempre.',
  },
  {
    key: 'journal',
    title: 'Diário do sistema',
    text: 'Logs do systemd: fica o das 2 últimas semanas, até 200 MB.',
  },
  {
    key: 'logs',
    title: 'Logs antigos',
    text: 'Arquivos de log já rotacionados (.gz, .1) em /var/log. Os logs atuais ficam.',
  },
  {
    key: 'ram',
    title: 'Cache de memória',
    text: 'Esvazia o cache de disco da RAM. Libera memória na hora; o sistema fica um pouco mais lento por alguns minutos enquanto o cache volta.',
  },
];

const INSTALL_CMD = 'curl -fsSL https://admin.comandou.com/instalar | sudo bash';

/** Aba "VM" da Infraestrutura: sistema, atualizações, versões, limpeza e reinício do servidor. */
export function VmPage() {
  const toast = useToast();
  const { data, error, reload } = useLoad<VmState>('/platform/server/vm');
  const [fresh, setFresh] = useState(0);
  const comps = useLoad<Components>(
    data?.enabled ? `/platform/server/components${fresh ? '?fresh=1' : ''}` : null,
    [fresh],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    'upgrade' | 'upgrade-security' | 'restart-docker' | 'reboot' | null
  >(null);
  const [cleanOpen, setCleanOpen] = useState(false);
  const [dockerClean, setDockerClean] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [allUpdates, setAllUpdates] = useState(false);
  const [component, setComponent] = useState<Component | null>(null);

  const jobs = data?.enabled ? (data.jobs ?? []) : [];
  const active = jobs.find((j) => j.status === 'pending' || j.status === 'running');
  useInterval(reload, active ? 4000 : 30_000);
  // Ao terminar um trabalho, as versões podem ter mudado.
  const [lastActive, setLastActive] = useState<string | null>(null);
  useEffect(() => {
    if (active) setLastActive(active.id);
    else if (lastActive) {
      setLastActive(null);
      comps.reload();
    }
  }, [active?.id]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const r = await api<{ id: string }>('/platform/server/vm/actions', {
        method: 'POST',
        json: { action, ...extra },
      });
      toast(`${ACTION_LABEL[action]}: pedido enviado à VM`, 'success');
      setJobId(r.id);
      reload();
      return true;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <Spinner />;
  if (!data.enabled)
    return (
      <>
        <PageHead sub={<span>Agente do servidor não instalado</span>} />
        <InstallHelp />
      </>
    );

  const info = data.info ?? null;
  const u = info?.updates;
  const disabled = !!active || !data.installed;
  const shownUpdates = allUpdates ? (u?.list ?? []) : (u?.list ?? []).slice(0, 10);

  return (
    <>
      <PageHead
        sub={
          info ? (
            <>
              <span>{info.os.name}</span>
              <span>coletado {ago(info.collectedAt)}</span>
            </>
          ) : (
            <span>Sistema da VM</span>
          )
        }
      />

      {!data.installed && <InstallHelp outdated={data.outdated} />}
      {data.stuck && (
        <Alert tone="warning">
          A VM não está pegando os pedidos. No servidor, confira com{' '}
          <code>sudo systemctl status comandou-vm.path</code> ou rode o instalador de novo.
        </Alert>
      )}
      {active && (
        <Alert tone="info">
          <strong>{ACTION_LABEL[active.action] ?? active.action}</strong>:{' '}
          {active.status === 'pending' ? 'esperando a VM pegar o pedido…' : 'rodando…'}{' '}
          <button className="adm-link" onClick={() => setJobId(active.id)}>
            ver o registro
          </button>
        </Alert>
      )}
      {info?.reboot.required && !active && (
        <Alert tone="warning">
          A VM precisa reiniciar para terminar uma atualização
          {info.reboot.packages ? ` (${info.reboot.packages.split('\n').join(', ')})` : ''}.{' '}
          <button className="adm-link" onClick={() => setConfirm('reboot')}>
            Reiniciar agora
          </button>
        </Alert>
      )}
      {info && !info.install.standard && (
        <Alert tone="warning">
          O Comandou está instalado em <code>{info.install.dir}</code>. O lugar certo é{' '}
          <code>/opt/comandou</code>: rode <code>{INSTALL_CMD}</code> no servidor, que ele copia
          tudo para lá e passa a usar de lá.
        </Alert>
      )}

      {info && u && (
        <Section title="Sistema">
          <div className="adm-grid">
            <Tile
              label="Sistema operacional"
              value={`${info.os.id === 'ubuntu' ? 'Ubuntu' : info.os.id === 'debian' ? 'Debian' : info.os.id} ${info.os.version}`}
              sub={`${info.os.codename ? `${info.os.codename} · ` : ''}kernel ${info.os.kernel} · ${info.os.arch}`}
            />
            <Tile
              label="Atualizações"
              value={u.total}
              level={u.security ? 'warn' : u.total ? 'info' : 'ok'}
              sub={
                u.total
                  ? `${u.security} de segurança${u.docker ? ' · inclui o Docker' : ''}`
                  : 'tudo em dia'
              }
            />
            <Tile
              label="Reinício"
              value={info.reboot.required ? 'Pendente' : 'Não precisa'}
              level={info.reboot.required ? 'warn' : 'ok'}
              sub={info.os.bootedAt ? `ligada desde ${dateTime(info.os.bootedAt)}` : ''}
            />
            <Tile
              label="Docker"
              value={comps.data?.engine?.version ?? '—'}
              sub={
                comps.data?.engine?.components
                  .filter((c) => c.name !== 'Engine')
                  .map((c) => `${c.name} ${c.version}`)
                  .join(' · ') || 'motor dos contêineres'
              }
            />
            <Tile
              label="Relógio"
              value={info.os.timezone || '—'}
              level={info.os.ntpSynced === 'no' ? 'warn' : 'ok'}
              sub={
                info.os.ntpSynced === 'yes'
                  ? 'sincronizado (NTP)'
                  : info.os.ntpSynced === 'no'
                    ? 'NÃO sincronizado'
                    : ''
              }
            />
            <Tile
              label="Proteção"
              value={info.security.autoUpdates ? 'Automática' : 'Manual'}
              level={info.security.autoUpdates ? 'ok' : 'info'}
              sub={`atualizações de segurança${info.security.firewall ? ` · firewall ${info.security.firewall === 'active' ? 'ligado' : 'desligado'}` : ''}`}
            />
          </div>
        </Section>
      )}

      {info && u && (
        <Section
          title="Atualizações do sistema"
          sub={u.lastCheck ? `procurado ${ago(u.lastCheck)}` : undefined}
          actions={
            <>
              <button className="adm-action" disabled={disabled} onClick={() => act('check')}>
                <RefreshCw size={14} /> {busy === 'check' ? 'Pedindo…' : 'Procurar agora'}
              </button>
              {u.security > 0 && (
                <button
                  className="adm-action"
                  disabled={disabled}
                  onClick={() => setConfirm('upgrade-security')}
                >
                  <ShieldCheck size={14} /> Só segurança
                </button>
              )}
              <button
                className="adm-action adm-action--primary"
                disabled={disabled || !u.total}
                onClick={() => setConfirm('upgrade')}
              >
                <ArrowUpCircle size={14} /> Atualizar tudo
              </button>
            </>
          }
        >
          <div className="adm-panel">
            {u.total === 0 ? (
              <div className="adm-empty">O sistema da VM está em dia</div>
            ) : (
              <div className="adm-rows">
                {shownUpdates.map((p) => (
                  <div key={p.name} className="adm-row">
                    <Dot level={p.security ? 'warn' : 'info'} />
                    <span className="adm-row__main">
                      <span className="adm-row__title">{p.name}</span>
                      <span className="adm-row__meta">
                        {p.from} → {p.to}
                      </span>
                    </span>
                    <span className="adm-row__side">
                      {p.security ? <Tag level="warn">segurança</Tag> : null}
                    </span>
                  </div>
                ))}
                {u.list.length > 10 && (
                  <button className="adm-row" onClick={() => setAllUpdates((v) => !v)}>
                    <span className="adm-row__main">
                      <span className="adm-row__meta">
                        {allUpdates ? 'Mostrar menos' : `Ver todos os ${u.total} pacotes`}
                      </span>
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        </Section>
      )}

      <Section
        title="Componentes e versões"
        sub={comps.data ? `conferido ${ago(comps.data.checkedAt)}` : undefined}
        actions={
          <button
            className="adm-action"
            disabled={!comps.data && !comps.error}
            onClick={() => setFresh((n) => n + 1)}
          >
            <RefreshCw size={14} /> Procurar versões novas
          </button>
        }
      >
        {comps.error && <Alert tone="danger">{comps.error}</Alert>}
        {!comps.data && !comps.error && <Spinner />}
        {comps.data && (
          <div className="adm-panel">
            <div className="adm-rows">
              {comps.data.components.map((c) => (
                <ComponentRow key={c.service} c={c} onUpdate={() => setComponent(c)} />
              ))}
              {comps.data.engine && (
                <div className="adm-row">
                  <Dot level={u?.docker ? 'info' : 'ok'} />
                  <span className="adm-row__main">
                    <span className="adm-row__title">
                      Docker Engine {comps.data.engine.version}
                    </span>
                    <span className="adm-row__meta">
                      {comps.data.engine.components
                        .filter((x) => x.name !== 'Engine')
                        .map((x) => `${x.name} ${x.version}`)
                        .join(' · ')}{' '}
                      · atualiza junto com o sistema
                    </span>
                  </span>
                  <span className="adm-row__side">
                    {u?.docker ? <Tag level="info">tem atualização</Tag> : <Tag>em dia</Tag>}
                  </span>
                </div>
              )}
              <div className="adm-row">
                <Dot level="ok" />
                <span className="adm-row__main">
                  <span className="adm-row__title">Node.js {comps.data.agent.node}</span>
                  <span className="adm-row__meta">
                    API e agente do servidor · OpenSSL {comps.data.agent.openssl} · vem com a versão
                    do Comandou
                  </span>
                </span>
              </div>
              {info?.packages
                .filter((p) => !/^docker-ce$|^containerd\.io$/.test(p.name))
                .map((p) => {
                  const pending = u?.list.find((x) => x.name === p.name);
                  return (
                    <div key={p.name} className="adm-row">
                      <Dot level={pending ? (pending.security ? 'warn' : 'info') : 'ok'} />
                      <span className="adm-row__main">
                        <span className="adm-row__title">{PACKAGE_LABEL[p.name] ?? p.name}</span>
                        <span className="adm-row__meta">
                          {p.version}
                          {pending ? ` → ${pending.to}` : ''} · pacote do sistema
                        </span>
                      </span>
                      <span className="adm-row__side">
                        {pending ? <Tag level="info">tem atualização</Tag> : <Tag>em dia</Tag>}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
        <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
          O Comandou muda de versão pelo botão “Atualizar sistema” na aba Servidor. Postgres, Redis
          e Traefik aqui só recebem a compilação nova da mesma versão (correções), nunca uma versão
          principal nova. Pacotes do sistema e o Docker atualizam em “Atualizações do sistema”.
        </p>
      </Section>

      {info && (
        <Section
          title="Limpeza"
          actions={
            <>
              <button className="adm-action" onClick={() => setDockerClean(true)}>
                <Box size={14} /> Limpar o Docker
              </button>
              <button
                className="adm-action adm-action--primary"
                disabled={disabled}
                onClick={() => setCleanOpen(true)}
              >
                <Trash2 size={14} /> Limpar a VM
              </button>
            </>
          }
        >
          <div className="adm-grid">
            {CLEAN.map((c) => (
              <Tile
                key={c.key}
                label={c.title}
                value={bytes(info.cache[c.key])}
                sub={
                  c.key === 'apt' && info.updates.autoremove
                    ? `${info.updates.autoremove} pacote(s) sobrando`
                    : c.key === 'ram'
                      ? 'em cache agora'
                      : 'pode liberar'
                }
              />
            ))}
          </div>
        </Section>
      )}

      <Section title="Reiniciar">
        <div className="adm-panel adm-panel__body">
          <p style={{ marginTop: 0 }}>
            Reiniciar um serviço só (API, web, banco) fica na aba Servidor, no próprio serviço. Aqui
            é o servidor inteiro: todos os restaurantes ficam fora do ar enquanto volta.
          </p>
          <div className="adm-actions">
            <button
              className="adm-action adm-action--danger"
              disabled={disabled}
              onClick={() => setConfirm('restart-docker')}
            >
              <RotateCcw size={14} /> Reiniciar o Docker
            </button>
            <button
              className="adm-action adm-action--danger"
              disabled={disabled}
              onClick={() => setConfirm('reboot')}
            >
              <Power size={14} /> Reiniciar a VM
            </button>
          </div>
        </div>
      </Section>

      {info && (
        <Section title="Instalação">
          <div className="adm-panel adm-panel__body">
            <dl className="adm-kv">
              <dt>Programa e instalador</dt>
              <dd>
                <code>{info.install.dir}</code>{' '}
                {info.install.standard ? (
                  <Tag level="ok">lugar certo</Tag>
                ) : (
                  <Tag level="warn">fora do padrão</Tag>
                )}
              </dd>
              <dt>Versão do instalador</dt>
              <dd>{info.install.version || '—'}</dd>
              <dt>Configuração</dt>
              <dd>
                <code>{info.install.config}</code>
                {info.install.configExists ? '' : ' (não encontrada)'}
              </dd>
              <dt>Dados (banco, arquivos)</dt>
              <dd>
                <code>{info.install.data}</code> · volumes do Docker
              </dd>
              <dt>Logs de instalação</dt>
              <dd>
                <code>{info.install.logs}</code>
              </dd>
              <dt>Ajudante da VM</dt>
              <dd>
                versão {info.helperVersion} · <code>/var/lib/comandou/vm</code>
              </dd>
            </dl>
          </div>
        </Section>
      )}

      {jobs.length > 0 && (
        <Section title="Histórico">
          <div className="adm-panel">
            <div className="adm-rows">
              {jobs.slice(0, 15).map((j) => (
                <button key={j.id} className="adm-row" onClick={() => setJobId(j.id)}>
                  <Dot level={JOB_LEVEL[j.status]} />
                  <span className="adm-row__main">
                    <span className="adm-row__title">
                      {ACTION_LABEL[j.action] ?? j.action}
                      {j.targets?.length ? ` (${j.targets.join(', ')})` : ''}
                    </span>
                    <span className="adm-row__meta">
                      {j.startedAt ? dateTime(j.startedAt) : 'na fila'}
                      {j.message ? ` · ${j.message}` : ''}
                    </span>
                  </span>
                  <span className="adm-row__side">{JOB_LABEL[j.status]}</span>
                </button>
              ))}
            </div>
          </div>
        </Section>
      )}

      {confirm && (
        <ConfirmSheet
          action={confirm}
          info={info}
          busy={busy === confirm}
          onClose={() => setConfirm(null)}
          onConfirm={async (word) => {
            if (await act(confirm, word ? { confirm: word } : {})) setConfirm(null);
          }}
        />
      )}
      {cleanOpen && info && (
        <VmCleanSheet
          info={info}
          busy={busy === 'clean'}
          onClose={() => setCleanOpen(false)}
          onConfirm={async (targets) => {
            if (await act('clean', { targets })) setCleanOpen(false);
          }}
        />
      )}
      {dockerClean && <CleanupSheet onClose={() => setDockerClean(false)} onDone={() => {}} />}
      {jobId && <JobSheet id={jobId} onClose={() => setJobId(null)} />}
      {component && (
        <ComponentSheet
          c={component}
          onClose={() => setComponent(null)}
          onDone={() => {
            setComponent(null);
            setTimeout(comps.reload, 1500);
          }}
        />
      )}
    </>
  );
}

function InstallHelp({ outdated }: { outdated?: boolean }) {
  return (
    <Section title="Ligar o painel da VM">
      <div className="adm-panel adm-panel__body">
        <p style={{ marginTop: 0 }}>
          {outdated
            ? 'O agente do servidor no ar é de uma versão antiga e ainda não fala com a VM.'
            : 'Falta o ajudante da VM: um serviço pequeno do próprio servidor (systemd) que responde aos pedidos deste painel.'}{' '}
          Para ligar, entre no servidor por SSH e rode uma vez:
        </p>
        <pre className="adm-log" style={{ maxHeight: 'none' }}>
          {INSTALL_CMD}
        </pre>
        <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
          O instalador coloca tudo no lugar padrão (<code>/opt/comandou</code> para o programa,{' '}
          <code>/etc/comandou</code> para a configuração e <code>/var/lib/comandou/vm</code> para a
          conversa com o painel), liga o agente do servidor e o ajudante da VM. Ele só faz ações
          fixas: procurar e instalar atualizações, limpar caches e reiniciar. Não existe terminal
          nem comando livre pelo painel.
        </p>
      </div>
    </Section>
  );
}

function ComponentRow({ c, onUpdate }: { c: Component; onUpdate: () => void }) {
  const level: Level =
    c.update.status === 'available' ? 'info' : c.update.status === 'unknown' ? 'off' : 'ok';
  const updating = c.updateState === 'updating' || c.updateState === 'rollback_started';
  return (
    <div className="adm-row">
      <Dot level={updating ? 'info' : level} />
      <span className="adm-row__main">
        <span className="adm-row__title">
          {c.product} {c.version}
        </span>
        <span className="adm-row__meta">
          {c.service} · {c.image}
          {c.runtimes.length
            ? ` · ${c.runtimes.map((r) => `${r.name} ${r.version}`).join(' · ')}`
            : ''}
          {c.update.status === 'unknown' && c.update.error ? ` · ${c.update.error}` : ''}
        </span>
      </span>
      <span className="adm-row__side">
        {updating ? (
          <Tag level="info">atualizando…</Tag>
        ) : c.update.status === 'available' && c.canUpdate ? (
          <button className="adm-action adm-action--sm adm-action--primary" onClick={onUpdate}>
            <ArrowUpCircle size={13} /> Atualizar
          </button>
        ) : c.update.status === 'available' ? (
          <Tag level="info">compilação nova</Tag>
        ) : c.update.status === 'managed' ? (
          <Tag>pelo Comandou</Tag>
        ) : c.update.status === 'current' ? (
          <Tag level="ok">em dia</Tag>
        ) : (
          <Tag>sem resposta</Tag>
        )}
      </span>
    </div>
  );
}

function ComponentSheet({
  c,
  onClose,
  onDone,
}: {
  c: Component;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      await api(`/platform/server/components/${encodeURIComponent(c.service)}/update`, {
        method: 'POST',
      });
      toast(`${c.product}: atualizando`, 'success');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'danger');
      setBusy(false);
    }
  }
  const db = /postgres/i.test(c.image);
  return (
    <Modal
      open
      title={`Atualizar ${c.product}`}
      onClose={onClose}
      footer={
        <button className="adm-action adm-action--primary" disabled={busy} onClick={run}>
          <ArrowUpCircle size={14} /> {busy ? 'Pedindo…' : 'Atualizar agora'}
        </button>
      }
    >
      <p style={{ marginTop: 0 }}>
        O registro tem uma compilação nova de <code>{c.image}</code> (correções da mesma versão). O
        serviço <strong>{c.service}</strong> reinicia com ela; se não subir, o Docker volta sozinho
        para a anterior.
      </p>
      <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
        {db
          ? 'O banco fica fora do ar por alguns segundos enquanto reinicia: faça fora do horário de movimento. Os dados ficam no volume e não são tocados.'
          : 'Fica fora do ar por alguns segundos enquanto reinicia.'}
      </p>
    </Modal>
  );
}

function ConfirmSheet({
  action,
  info,
  busy,
  onClose,
  onConfirm,
}: {
  action: 'upgrade' | 'upgrade-security' | 'restart-docker' | 'reboot';
  info: VmInfo | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (word?: string) => void;
}) {
  const [word, setWord] = useState('');
  const strong = action === 'reboot' || action === 'restart-docker';
  const text: Record<typeof action, string> = {
    upgrade: `Instala ${info?.updates.total ?? 'as'} atualização(ões) do sistema (apt), sem remover nada. Leva alguns minutos.`,
    'upgrade-security': `Instala só as ${info?.updates.security ?? ''} atualização(ões) de segurança. Leva alguns minutos.`,
    'restart-docker':
      'Para e sobe de novo todos os contêineres (sistema, banco, sites). Todos os restaurantes ficam fora do ar por cerca de 1 minuto.',
    reboot:
      'Desliga e liga o servidor. Todos os restaurantes ficam fora do ar por 1 a 3 minutos, até tudo subir sozinho de novo.',
  };
  return (
    <Modal
      open
      title={ACTION_LABEL[action]}
      onClose={onClose}
      footer={
        <button
          className={`adm-action ${strong ? 'adm-action--danger' : 'adm-action--primary'}`}
          disabled={busy || (strong && word.trim().toUpperCase() !== 'REINICIAR')}
          onClick={() => onConfirm(strong ? 'REINICIAR' : undefined)}
        >
          {strong ? <Power size={14} /> : <ArrowUpCircle size={14} />}{' '}
          {busy ? 'Pedindo…' : ACTION_LABEL[action]}
        </button>
      }
    >
      <p style={{ marginTop: 0 }}>{text[action]}</p>
      {action.startsWith('upgrade') && info?.updates.docker && action === 'upgrade' && (
        <Alert tone="warning">
          A lista inclui o Docker: quando ele for atualizado, todos os contêineres reiniciam e os
          restaurantes ficam fora do ar por cerca de 1 minuto. Prefira fora do horário de movimento.
        </Alert>
      )}
      {action.startsWith('upgrade') && (
        <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
          Se alguma atualização pedir, o painel avisa que a VM precisa reiniciar. Você escolhe
          quando.
        </p>
      )}
      {strong && (
        <label className="cm-field" style={{ display: 'grid', gap: 6 }}>
          <span className="adm-label">Para confirmar, digite REINICIAR</span>
          <input
            className="cm-input"
            value={word}
            autoComplete="off"
            onChange={(e) => setWord(e.target.value)}
            aria-label="Digite REINICIAR"
          />
        </label>
      )}
    </Modal>
  );
}

function VmCleanSheet({
  info,
  busy,
  onClose,
  onConfirm,
}: {
  info: VmInfo;
  busy: boolean;
  onClose: () => void;
  onConfirm: (targets: string[]) => void;
}) {
  const [sel, setSel] = useState<string[]>(['apt', 'journal', 'logs']);
  return (
    <Modal
      open
      title="Limpar a VM"
      onClose={onClose}
      size="lg"
      footer={
        <button
          className="adm-action adm-action--primary"
          disabled={!sel.length || busy}
          onClick={() => onConfirm(sel)}
        >
          <Trash2 size={14} /> {busy ? 'Pedindo…' : 'Limpar selecionados'}
        </button>
      }
    >
      <div style={{ display: 'grid', gap: 8 }}>
        {CLEAN.map((c) => (
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
              <span className="adm-label">{bytes(info.cache[c.key])}</span>
            </span>
          </label>
        ))}
        <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
          Dados do banco, arquivos dos restaurantes e backups nunca são apagados por aqui. Para
          imagens e contêineres velhos, use “Limpar o Docker”.
        </p>
      </div>
    </Modal>
  );
}

function JobSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, reload } = useLoad<{ job: VmJob; log: string }>(
    `/platform/server/vm/jobs/${id}`,
  );
  const live = !data || data.job.status === 'pending' || data.job.status === 'running';
  useInterval(reload, live ? 3000 : null);
  return (
    <Modal
      open
      title={data ? (ACTION_LABEL[data.job.action] ?? data.job.action) : 'Registro'}
      onClose={onClose}
      size="xl"
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {!data && !error && <Spinner />}
      {data && (
        <>
          <dl className="adm-kv">
            <dt>Situação</dt>
            <dd>
              <Tag level={JOB_LEVEL[data.job.status]}>{JOB_LABEL[data.job.status]}</Tag>
              {data.job.message ? ` ${data.job.message}` : ''}
            </dd>
            {data.job.startedAt && (
              <>
                <dt>Começou</dt>
                <dd>{dateTime(data.job.startedAt)}</dd>
              </>
            )}
            {data.job.finishedAt && (
              <>
                <dt>Terminou</dt>
                <dd>{dateTime(data.job.finishedAt)}</dd>
              </>
            )}
          </dl>
          <div className="adm-actions" style={{ margin: '12px 0' }}>
            <button className="adm-action" onClick={reload}>
              <ScrollText size={14} /> Atualizar registro
            </button>
          </div>
          <pre className="adm-log">{data.log || '(ainda sem linhas)'}</pre>
        </>
      )}
    </Modal>
  );
}
