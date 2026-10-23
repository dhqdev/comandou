import { useEffect, useState } from 'react';
import { Alert, Spinner } from '../design-system';
import { dateTime } from '../features/format';
import { api } from '../lib/api';
import type { AuditRow, BackupSettings, HealthState, Overview, ServerStatus } from './types';
import { ago, bytes, Dot, Level, levelFor, Section, Tile } from './ui';
import { useNavigate } from 'react-router';

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

const HEALTH: Record<HealthState, [string, Level]> = {
  ok: ['ok', 'ok'],
  error: ['falha', 'bad'],
  disabled: ['desligado', 'off'],
};

/** Idade do último sucesso: alerta se o backup passou de 26 h ou o teste de 8 dias. */
function backupLevel(at: string | null, warnHours: number): Level {
  if (!at) return 'bad';
  return (Date.now() - new Date(at).getTime()) / 3_600_000 > warnHours ? 'warn' : 'ok';
}

export function OverviewPage() {
  const { data, error } = useLoad<Overview>('/platform/overview');
  const server = useLoad<ServerStatus>('/platform/server');
  const backup = useLoad<BackupSettings>('/platform/backups/settings');
  const navigate = useNavigate();
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <Spinner />;
  const b = backupLevel(data.backups.backup.lastOkAt, 26);
  const r = backupLevel(data.backups.restoreTest.lastOkAt, 24 * 8);
  const s = server.data?.enabled ? server.data : null;
  const docker = s && !('error' in s.docker) ? s.docker : null;
  const disk = s?.host.disks[0];
  const diskPct = disk ? ((disk.total - disk.free) / disk.total) * 100 : null;
  const memPct = s ? (s.host.memory.used / s.host.memory.total) * 100 : null;
  const badServices =
    docker?.services.filter((x) => x.desired !== null && x.running < x.desired) ?? [];

  const alerts: { level: Level; text: string; to?: string }[] = [];
  for (const [label, st] of [
    ['Banco de dados', data.health.database],
    ['Redis (filas e tempo real)', data.health.redis],
    ['Serviço de WhatsApp', data.health.whatsappGateway],
  ] as const)
    if (st === 'error') alerts.push({ level: 'bad', text: `${label} com falha` });
  const bk = backup.data;
  if (bk && !(bk.enabled && bk.configured))
    alerts.push({ level: 'warn', text: 'Backup no Backblaze não configurado', to: '/backups' });
  else if (bk && !bk.worker.alive)
    alerts.push({ level: 'bad', text: 'Serviço de backup parado', to: '/backups' });
  if (b !== 'ok')
    alerts.push({
      level: b,
      text: `Backup: último bom ${ago(data.backups.backup.lastOkAt)}`,
      to: '/backups',
    });
  if (r !== 'ok')
    alerts.push({
      level: r,
      text: `Teste de restauração: último bom ${ago(data.backups.restoreTest.lastOkAt)}`,
      to: '/backups',
    });
  for (const x of badServices)
    alerts.push({
      level: 'bad',
      text: `${x.name}: ${x.running}/${x.desired} rodando`,
      to: '/servidor',
    });
  if (diskPct !== null && diskPct > 80)
    alerts.push({
      level: levelFor(diskPct, 80, 90),
      text: `Disco em ${diskPct.toFixed(0)}%`,
      to: '/servidor',
    });
  if (data.tenants.failed)
    alerts.push({
      level: 'warn',
      text: `${data.tenants.failed} restaurante(s) com cadastro incompleto`,
      to: '/restaurantes',
    });

  return (
    <>
      <Section title="Resumo" sub={`v${data.version}`}>
        <div className="adm-grid">
          <Tile
            label="Restaurantes ativos"
            value={data.tenants.provisioned ?? 0}
            sub={`${data.tenants.suspended ?? 0} suspenso(s)`}
            onClick={() => navigate('/restaurantes')}
          />
          <Tile
            label="Assinaturas"
            value={
              <>
                {data.subscriptions.active ?? 0}
                <small> ativas</small>
              </>
            }
            sub={`${data.subscriptions.trialing ?? 0} em teste · ${data.subscriptions.past_due ?? 0} pendente(s)`}
            level={data.subscriptions.past_due ? 'warn' : undefined}
          />
          <Tile
            label="Alertas"
            value={alerts.length}
            level={alerts.length ? 'warn' : 'ok'}
            sub={alerts[0]?.text ?? 'tudo certo'}
          />
          <Tile
            label="Falhas em 7 dias"
            value={data.last7Days.fiscalErrors + data.last7Days.messageFailures}
            sub={`${data.last7Days.fiscalErrors} NFC-e · ${data.last7Days.messageFailures} WhatsApp`}
            level={
              data.last7Days.fiscalErrors + data.last7Days.messageFailures ? 'warn' : undefined
            }
          />
        </div>
      </Section>

      {alerts.length > 0 && (
        <Section title="Alertas">
          <div className="adm-panel">
            <div className="adm-rows">
              {alerts.map((a, i) =>
                a.to ? (
                  <button key={i} className="adm-row" onClick={() => navigate(a.to!)}>
                    <Dot level={a.level} />
                    <span className="adm-row__main">{a.text}</span>
                    <span className="adm-row__side">ver ›</span>
                  </button>
                ) : (
                  <div key={i} className="adm-row">
                    <Dot level={a.level} />
                    <span className="adm-row__main">{a.text}</span>
                  </div>
                ),
              )}
            </div>
          </div>
        </Section>
      )}

      <Section title="Servidor" sub={s ? s.host.hostname : undefined}>
        {!server.data ? (
          <Spinner />
        ) : !s ? (
          <div className="adm-panel adm-empty">
            Agente do servidor não instalado. Veja “Servidor” para ativar.
          </div>
        ) : (
          <div className="adm-grid">
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
              sub={disk ? `${bytes(disk.free)} livres` : ''}
              meter={diskPct}
              onClick={() => navigate('/servidor')}
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
              level={badServices.length ? 'bad' : docker ? 'ok' : 'off'}
              sub={
                docker
                  ? `${docker.services.length} serviços · ${badServices.length} com problema`
                  : 'Docker indisponível'
              }
              onClick={() => navigate('/servidor')}
            />
          </div>
        )}
      </Section>

      <Section title="Saúde">
        <div className="adm-grid">
          {(
            [
              ['Banco de dados', data.health.database],
              ['Redis', data.health.redis],
              ['WhatsApp', data.health.whatsappGateway],
            ] as const
          ).map(([label, st]) => (
            <Tile key={label} label={label} value={HEALTH[st][0]} level={HEALTH[st][1]} />
          ))}
          <Tile
            label="Fila"
            value={data.queue ? (data.queue.waiting ?? 0) + (data.queue.active ?? 0) : '—'}
            sub={
              data.queue
                ? Object.entries(data.queue)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(' · ')
                : 'sem Redis'
            }
          />
          <Tile
            label="Último backup"
            value={ago(data.backups.backup.lastOkAt)}
            level={b}
            sub={data.backups.backup.lastOkAt ? dateTime(data.backups.backup.lastOkAt) : 'nenhum'}
            onClick={() => navigate('/backups')}
          />
          <Tile
            label="Teste de restauração"
            value={ago(data.backups.restoreTest.lastOkAt)}
            level={r}
            sub={
              data.backups.restoreTest.lastOkAt
                ? dateTime(data.backups.restoreTest.lastOkAt)
                : 'nenhum'
            }
            onClick={() => navigate('/backups')}
          />
        </div>
      </Section>
    </>
  );
}

export { BackupsPage } from './BackupsPage';

export const ACTION_LABELS: Record<string, string> = {
  'platform.login': 'Entrou no painel',
  'platform.login_failed': 'Tentativa de login recusada',
  'platform.logout': 'Saiu do painel',
  'platform.admin_created': 'Administrador criado (CLI)',
  'platform.tenant_created': 'Restaurante criado',
  'platform.tenant_provision_failed': 'Falha ao criar restaurante',
  'platform.tenant.suspended': 'Restaurante suspenso',
  'platform.tenant.reactivated': 'Restaurante reativado',
  'platform.tenant.renamed': 'Restaurante renomeado',
  'platform.tenant.support_access': 'Abriu o sistema do restaurante',
  'platform.tenant.sessions_revoked': 'Encerrou sessões',
  'platform.user.password_reset': 'Redefiniu senha',
  'platform.subscription_changed': 'Assinatura alterada',
  'platform.domain_removed': 'Domínio removido',
  'platform.plan_created': 'Plano criado',
  'platform.plan_updated': 'Plano alterado',
  'platform.server.cleanup': 'Limpeza no servidor',
  'platform.server.service_restarted': 'Reiniciou serviço',
  'platform.server.logs_viewed': 'Viu logs de serviço',
};

const FAIL = new Set(['platform.login_failed', 'platform.tenant_provision_failed']);
const STRONG = new Set([
  'platform.tenant.suspended',
  'platform.user.password_reset',
  'platform.server.cleanup',
  'platform.server.service_restarted',
  'platform.tenant.support_access',
]);

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) return <div className="adm-empty">Nada registrado</div>;
  return (
    <div className="adm-rows">
      {rows.map((a) => {
        const details = Object.entries(a.data ?? {})
          .filter(([, v]) => v !== null && typeof v !== 'object')
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join(' · ');
        return (
          <div key={a.id} className="adm-row">
            <Dot level={FAIL.has(a.action) ? 'bad' : STRONG.has(a.action) ? 'warn' : 'off'} />
            <span className="adm-row__main">
              <span className="adm-row__title">{ACTION_LABELS[a.action] ?? a.action}</span>
              <span className="adm-row__meta">
                {[a.adminName, a.tenantSlug, details, a.ip && `IP ${a.ip}`]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </span>
            </span>
            <span className="adm-row__side">{dateTime(a.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function AuditPage() {
  const { data, error } = useLoad<AuditRow[]>('/platform/audit?limit=300');
  return (
    <Section title="Auditoria" sub="toda ação no painel">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="adm-panel">{!data ? <Spinner /> : <AuditTable rows={data} />}</div>
    </Section>
  );
}
