import { useEffect, useRef, useState } from 'react';
import { Alert, Skeleton } from '../design-system';
import { dateTime } from '../features/format';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import type {
  BackupSettings,
  HealthState,
  Overview,
  PendingContract,
  ServerStatus,
  UpdateInfo,
} from './types';
import { ChevronRight } from 'lucide-react';
import { ago, bytes, Dot, Level, levelFor, PageHead, Section, Tile } from './ui';
import { useNavigate } from 'react-router';
import { SitesTable, SitesTiles, useSites, useSitesFilter, type SitesFilter } from './SitesStatus';
import type { CredentialItem } from './credentials/KeyInUse';
import { ageLevel, badServices, newerVersion, queueText, statusAlerts } from './status-alerts';

export { bytes };

export function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    api<T>(path)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [path, tick, ...deps]);
  return { data, error, reload: () => setTick((t) => t + 1), setData };
}

/**
 * Recarrega sozinho enquanto a tela está à vista (a cada `ms` e ao voltar para a aba): o que o
 * restaurante muda do lado dele (ícone, nome, cadastro) aparece no painel sem apertar nada.
 */
export function useAutoReload(reload: () => void, ms = 20_000) {
  const fn = useRef(reload);
  fn.current = reload;
  useEffect(() => {
    const tick = () => !document.hidden && fn.current();
    const t = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms]);
}

const HEALTH: Record<HealthState, [string, Level]> = {
  ok: ['ok', 'ok'],
  error: ['falha', 'bad'],
  disabled: ['desligado', 'off'],
};

const WA_STATUS: Record<string, string> = {
  connected: 'conectado',
  connecting: 'conectando',
  qr: 'esperando o QR Code',
  disconnected: 'desconectado',
  logged_out: 'desconectado',
};

interface PlatformWa {
  configured: boolean;
  status: string;
  phone?: string;
}

/**
 * Tela inicial do Super Admin: o que pede ação agora (alertas), o negócio (receita, testes,
 * inadimplência, atendimento), os restaurantes no ar e a saúde do servidor. Cada número leva à
 * tela que explica ou resolve.
 */
export function OverviewPage() {
  const { data, error, reload } = useLoad<Overview>('/platform/overview');
  const server = useLoad<ServerStatus>('/platform/server');
  const backup = useLoad<BackupSettings>('/platform/backups/settings');
  const contracts = useLoad<PendingContract[]>('/platform/contracts/pending');
  const creds = useLoad<{ items: CredentialItem[] }>('/platform/credentials');
  const wa = useLoad<PlatformWa>('/platform/whatsapp/session');
  const update = useLoad<UpdateInfo>('/platform/server/update');
  useAutoReload(() => {
    reload();
    server.reload();
    wa.reload();
  }, 30_000);
  const navigate = useNavigate();
  const sites = useSites();
  const [filter, setFilter] = useSitesFilter();
  const showSites = (f: SitesFilter) => {
    setFilter(f);
    document.querySelector('.adm-sites__bar')?.scrollIntoView({ block: 'start' });
  };
  const offsite = backup.data ? backup.data.enabled && backup.data.configured : null;
  const sitesBlock = (
    <Section title="Restaurantes no ar" sub="cada site testado pelo endereço público">
      <SitesTiles report={sites.data} offsite={offsite} onFilter={showSites} />
      <SitesTable
        report={sites.data}
        error={sites.error}
        loading={sites.loading}
        filter={filter}
        setFilter={setFilter}
        onReload={() => void sites.reload()}
      />
    </Section>
  );
  if (error)
    return (
      <>
        <Alert tone="danger">{error}</Alert>
        {sitesBlock}
      </>
    );
  if (!data)
    return (
      <>
        <PageHead page title="Status" />
        <Skeleton variant="cards" />
        {sitesBlock}
      </>
    );
  const alerts = statusAlerts({
    data,
    server: server.data,
    backup: backup.data,
    contracts: contracts.data,
    sites: sites.data,
    credentials: creds.data?.items,
    platformWa: wa.data,
    update: update.data,
  });
  const b = ageLevel(data.backups.backup.lastOkAt, 26);
  const r = ageLevel(data.backups.restoreTest.lastOkAt, 24 * 8);
  const s = server.data?.enabled ? server.data : null;
  const docker = s && !('error' in s.docker) ? s.docker : null;
  const disk = s?.host.disks[0];
  const diskPct = disk ? ((disk.total - disk.free) / disk.total) * 100 : null;
  const memPct = s ? (s.host.memory.used / s.host.memory.total) * 100 : null;
  const bad = badServices(docker?.services ?? []);
  const queue = queueText(data.queue);
  const biz = data.business;
  const support = data.support;
  const usage = data.usage;
  const live = (sites.data?.sites ?? []).filter(
    (x) => x.state !== 'suspended' && x.state !== 'setup',
  );
  const waOn = live.filter((x) => x.whatsapp?.status === 'connected').length;
  const newer = newerVersion(update.data?.latest?.version, data.version);

  const health: { label: string; level: Level; value: string; to?: string; sub?: string }[] = [
    {
      label: 'Banco de dados central',
      level: HEALTH[data.health.database][1],
      value: HEALTH[data.health.database][0],
      sub: 'cadastro, assinaturas e o painel',
    },
    {
      label: 'Redis (filas e tempo real)',
      level: HEALTH[data.health.redis][1],
      value: HEALTH[data.health.redis][0],
    },
    {
      label: 'Serviço do WhatsApp',
      level: HEALTH[data.health.whatsappGateway][1],
      value: HEALTH[data.health.whatsappGateway][0],
      // "ok" aqui é o serviço respondendo; quantos números estão conectados é outra coisa.
      sub: [
        sites.data && data.health.whatsappGateway === 'ok'
          ? `${waOn} de ${live.length} restaurante(s) conectado(s)`
          : null,
        wa.data?.configured ? `seu número: ${WA_STATUS[wa.data.status] ?? wa.data.status}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      to: '/whatsapp',
    },
    {
      label: 'Fila de tarefas',
      level: queue.level,
      value: queue.value,
      sub: queue.sub,
    },
    {
      label: 'Falhas em 7 dias',
      level: (data.last7Days.fiscalErrors + data.last7Days.messageFailures
        ? 'warn'
        : 'ok') as Level,
      value: String(data.last7Days.fiscalErrors + data.last7Days.messageFailures),
      sub: `${data.last7Days.fiscalErrors} nota(s) fiscal(is) recusada(s) · ${data.last7Days.messageFailures} WhatsApp não enviado(s)`,
    },
    {
      label: 'Backup do banco central',
      level: b,
      value: ago(data.backups.backup.lastOkAt),
      sub: data.backups.backup.lastOkAt
        ? `${dateTime(data.backups.backup.lastOkAt)}${offsite === false ? ' · só neste servidor' : ''}`
        : 'nenhum backup bom ainda',
      to: '/servidor/backups',
    },
    {
      label: 'Teste de restauração',
      level: r,
      value: ago(data.backups.restoreTest.lastOkAt),
      sub: data.backups.restoreTest.lastOkAt
        ? dateTime(data.backups.restoreTest.lastOkAt)
        : 'nenhum teste ainda',
      to: '/servidor/backups',
    },
  ];

  return (
    <>
      <PageHead
        page
        title="Status"
        sub={
          <>
            <span>
              Comandou v{data.version}
              {newer && ` · ${update.data!.latest!.version} disponível`}
            </span>
            <span>
              {alerts.length === 0
                ? 'tudo certo'
                : alerts.length === 1
                  ? '1 coisa pede atenção'
                  : `${alerts.length} coisas pedem atenção`}
            </span>
          </>
        }
      />

      {alerts.length > 0 && (
        <Section title="Pede atenção">
          <div className="adm-panel">
            <div className="adm-rows">
              {alerts.map((a, i) => {
                const body = (
                  <>
                    <Dot level={a.level} />
                    <span className="adm-row__main">{a.text}</span>
                    {(a.to || a.sites) && <ChevronRight size={16} className="adm-row__go" />}
                  </>
                );
                return a.to || a.sites ? (
                  <button
                    key={i}
                    className="adm-row"
                    onClick={() => (a.sites ? showSites(a.sites) : navigate(a.to!))}
                  >
                    {body}
                  </button>
                ) : (
                  <div key={i} className="adm-row">
                    {body}
                  </div>
                );
              })}
            </div>
          </div>
        </Section>
      )}

      {biz && (
        <Section
          title="Negócio"
          sub={biz.demo ? 'a demonstração (Fumaça) não entra nestas contas' : undefined}
        >
          <div className="adm-grid adm-grid--3">
            <Tile
              label="Receita por mês"
              value={brl(biz.mrr)}
              sub={`${biz.paying} assinatura(s) paga(s)${biz.courtesy ? ` · ${biz.courtesy} cortesia(s)` : ''}`}
              onClick={() => navigate('/cobranca')}
            />
            <Tile
              label="Recebido no mês"
              value={brl(biz.paidMonth)}
              level={biz.overdueCount ? 'warn' : undefined}
              sub={
                biz.overdueCount
                  ? `${brl(biz.overdue)} vencido (${biz.overdueCount} fatura(s))`
                  : 'nada vencido'
              }
              onClick={() => navigate('/cobranca')}
            />
            <Tile
              label="Em teste grátis"
              value={biz.trialing}
              level={biz.trialEnded ? 'warn' : undefined}
              sub={
                [
                  biz.trialEndingSoon ? `${biz.trialEndingSoon} acaba(m) em 7 dias` : null,
                  biz.trialEnded ? `${biz.trialEnded} já acabou(aram)` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'nenhum acabando'
              }
              onClick={() => navigate('/cobranca')}
            />
            <Tile
              label="Clientes em 30 dias"
              value={`+${biz.newLast30}`}
              level={biz.blocked || biz.pastDue ? 'warn' : undefined}
              sub={[
                `${biz.cancelledLast30} cancelaram`,
                biz.pastDue ? `${biz.pastDue} pendente(s)` : null,
                biz.blocked ? `${biz.blocked} bloqueado(s)` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              onClick={() => navigate('/restaurantes')}
            />
            {usage && (
              <Tile
                label="Pedidos no mês"
                value={usage.ordersMonth.toLocaleString('pt-BR')}
                sub={`${usage.sellingLast7} de ${usage.live} vendeu(ram) nos últimos 7 dias`}
                onClick={() => navigate('/restaurantes')}
              />
            )}
            {support && (
              <Tile
                label="Atendimento"
                value={support.chatsWaiting ? `${support.chatsWaiting} esperando` : 'em dia'}
                level={support.chatsWaiting || support.ticketsWaiting ? 'warn' : undefined}
                sub={`${support.ticketsOpen} chamado(s) aberto(s)${support.ticketsWaiting ? ` · ${support.ticketsWaiting} com você` : ''}`}
                onClick={() => navigate(support.chatsWaiting ? '/conversas' : '/chamados')}
              />
            )}
          </div>
        </Section>
      )}

      {sitesBlock}

      <div className="adm-two">
        <Section title="Servidor" sub={s ? s.host.hostname : undefined}>
          {!server.data ? (
            <Skeleton variant="cards" />
          ) : !s ? (
            <button
              type="button"
              className="adm-panel adm-empty"
              style={{ cursor: 'pointer', font: 'inherit' }}
              onClick={() => navigate('/servidor')}
            >
              Agente do servidor não instalado. Veja em Infraestrutura › Servidor como ativar.
            </button>
          ) : (
            <div className="adm-grid adm-grid--2">
              <Tile
                label="CPU"
                value={s.host.cpu.percent === null ? '—' : `${s.host.cpu.percent.toFixed(1)}%`}
                level={levelFor(s.host.cpu.percent)}
                sub={`${s.host.cores} núcleos · carga ${s.host.load[0].toFixed(2)}`}
                meter={s.host.cpu.percent}
                onClick={() => navigate('/servidor')}
              />
              <Tile
                label="Memória"
                value={`${memPct!.toFixed(1)}%`}
                level={levelFor(memPct)}
                sub={`${bytes(s.host.memory.used)} de ${bytes(s.host.memory.total)}`}
                meter={memPct}
                onClick={() => navigate('/servidor')}
              />
              <Tile
                label="Disco /"
                value={diskPct === null ? '—' : `${diskPct.toFixed(1)}%`}
                level={levelFor(diskPct, 80, 90)}
                sub={disk ? `${bytes(disk.free)} livres de ${bytes(disk.total)}` : ''}
                meter={diskPct}
                onClick={() => navigate('/servidor')}
              />
              <Tile
                label="Serviços"
                value={
                  docker ? (
                    <>
                      {docker.services.length - bad.length}
                      <small>/{docker.services.length}</small>
                    </>
                  ) : (
                    '—'
                  )
                }
                level={!docker ? 'off' : bad.length ? 'bad' : undefined}
                sub={
                  !docker
                    ? 'Docker indisponível'
                    : bad.length
                      ? `${bad.length} com problema: ${bad.map((x) => x.name).join(', ')}`
                      : 'todos funcionando'
                }
                onClick={() => navigate('/servidor')}
              />
            </div>
          )}
        </Section>

        <Section title="Saúde">
          <div className="adm-panel">
            <div className="adm-rows">
              {health.map((h) => {
                const body = (
                  <>
                    <Dot level={h.level} />
                    <span className="adm-row__main">
                      <span>{h.label}</span>
                      {h.sub && <span className="adm-row__meta">{h.sub}</span>}
                    </span>
                    <span
                      className={`adm-row__side ${h.level === 'bad' || h.level === 'warn' ? `adm-text--${h.level}` : ''}`}
                    >
                      {h.value}
                    </span>
                  </>
                );
                return h.to ? (
                  <button key={h.label} className="adm-row" onClick={() => navigate(h.to!)}>
                    {body}
                  </button>
                ) : (
                  <div key={h.label} className="adm-row">
                    {body}
                  </div>
                );
              })}
            </div>
          </div>
        </Section>
      </div>
    </>
  );
}
