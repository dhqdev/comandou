import { useEffect, useState } from 'react';
import { Alert, Badge, Card, EmptyState, Spinner } from '../design-system';
import { dateTime } from '../features/format';
import { api } from '../lib/api';
import type { AuditRow, BackupRun, HealthState, Overview } from './types';

export function useLoad<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
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

const HEALTH: Record<HealthState, [string, 'success' | 'danger' | 'neutral']> = {
  ok: ['ok', 'success'],
  error: ['com falha', 'danger'],
  disabled: ['não configurado', 'neutral'],
};

const TENANT_STATUS: Record<string, string> = {
  provisioned: 'Ativos',
  suspended: 'Suspensos',
  failed: 'Falha no cadastro',
  provisioning: 'Em cadastro',
  recovering: 'Recuperando',
  requested: 'Solicitados',
};

export function bytes(n: string | number | null) {
  if (n === null) return '—';
  const v = Number(n);
  if (v < 1024) return `${v} B`;
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  return `${(v / 1024 ** 3).toFixed(2)} GB`;
}

/** Idade do último sucesso: alerta se o backup passou de 26 h ou o teste de 8 dias. */
function age(at: string | null, warnHours: number) {
  if (!at) return { text: 'nunca', tone: 'danger' as const };
  const h = (Date.now() - new Date(at).getTime()) / 3_600_000;
  return { text: dateTime(at), tone: h > warnHours ? ('warning' as const) : ('success' as const) };
}

export function OverviewPage() {
  const { data, error } = useLoad<Overview>('/platform/overview');
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <Spinner />;
  const b = age(data.backups.backup.lastOkAt, 26);
  const r = age(data.backups.restoreTest.lastOkAt, 24 * 8);
  return (
    <>
      <div>
        <h1 className="page-title">Visão geral</h1>
        <p className="page-sub">Versão {data.version} em execução.</p>
      </div>
      <div className="stat-grid">
        {Object.entries(TENANT_STATUS)
          .filter(([k]) => data.tenants[k] || k === 'provisioned')
          .map(([k, label]) => (
            <div key={k} className="pm-card stat">
              <div className="stat__label">Restaurantes · {label}</div>
              <div className="stat__value">{data.tenants[k] ?? 0}</div>
            </div>
          ))}
        <div className="pm-card stat">
          <div className="stat__label">Assinaturas em teste / ativas / pendentes</div>
          <div className="stat__value">
            {data.subscriptions.trialing ?? 0} / {data.subscriptions.active ?? 0} /{' '}
            {data.subscriptions.past_due ?? 0}
          </div>
        </div>
      </div>
      <div className="two-cols">
        <Card title="Saúde">
          <ul className="plain-list">
            {(
              [
                ['Banco de dados', data.health.database],
                ['Redis (filas e tempo real)', data.health.redis],
                ['Serviço de WhatsApp', data.health.whatsappGateway],
              ] as const
            ).map(([label, st]) => (
              <li key={label}>
                <Badge tone={HEALTH[st][1]}>{HEALTH[st][0]}</Badge> {label}
              </li>
            ))}
            {data.queue && (
              <li className="pm-hint">
                Fila:{' '}
                {Object.entries(data.queue)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(' · ')}
              </li>
            )}
          </ul>
          <p className="pm-hint">
            Últimos 7 dias: {data.last7Days.fiscalErrors} notas com erro ou rejeitadas,{' '}
            {data.last7Days.messageFailures} mensagens de WhatsApp com falha.
          </p>
        </Card>
        <Card title="Backups">
          <ul className="plain-list">
            <li>
              <Badge tone={b.tone}>{b.text}</Badge> Último backup bem-sucedido
            </li>
            <li>
              <Badge tone={r.tone}>{r.text}</Badge> Último teste de restauração bem-sucedido
            </li>
          </ul>
          {data.backups.backup.last?.status === 'failed' && (
            <Alert tone="danger">Último backup falhou: {data.backups.backup.last.error}</Alert>
          )}
          {data.backups.restoreTest.last?.status === 'failed' && (
            <Alert tone="danger">
              Último teste de restauração falhou: {data.backups.restoreTest.last.error}
            </Alert>
          )}
        </Card>
      </div>
    </>
  );
}

export function BackupsPage() {
  const { data, error } = useLoad<BackupRun[]>('/platform/backups');
  return (
    <>
      <div>
        <h1 className="page-title">Backups</h1>
        <p className="page-sub">
          Backup diário cifrado no bucket (B2/S3) e teste semanal de restauração num banco
          temporário.
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Card bodyless>
        {!data ? (
          <div className="pm-card__body">
            <Spinner />
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            title="Nenhuma execução registrada"
            description="O serviço de backup grava cada execução aqui."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="pm-table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Situação</th>
                  <th>Início</th>
                  <th>Arquivo</th>
                  <th className="pm-num">Tamanho</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td>{r.kind === 'backup' ? 'Backup' : 'Teste de restauração'}</td>
                    <td>
                      <Badge
                        tone={
                          r.status === 'ok' ? 'success' : r.status === 'failed' ? 'danger' : 'info'
                        }
                      >
                        {r.status === 'ok' ? 'ok' : r.status === 'failed' ? 'falhou' : 'rodando'}
                      </Badge>
                      {r.error && <div className="pm-hint">{r.error}</div>}
                    </td>
                    <td>{dateTime(r.startedAt)}</td>
                    <td className="mono-break">{r.objectKey ?? '—'}</td>
                    <td className="pm-num">{bytes(r.sizeBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export const ACTION_LABELS: Record<string, string> = {
  'platform.login': 'Entrou no painel',
  'platform.login_failed': 'Tentativa de login recusada',
  'platform.logout': 'Saiu do painel',
  'platform.admin_created': 'Administrador criado (CLI)',
  'platform.tenant_created': 'Restaurante criado',
  'platform.tenant_provision_failed': 'Falha ao criar restaurante',
  'platform.tenant.suspended': 'Restaurante suspenso',
  'platform.tenant.reactivated': 'Restaurante reativado',
  'platform.subscription_changed': 'Assinatura alterada',
  'platform.domain_removed': 'Domínio removido',
  'platform.plan_created': 'Plano criado',
  'platform.plan_updated': 'Plano alterado',
};

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) return <EmptyState title="Nada registrado" />;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="pm-table">
        <thead>
          <tr>
            <th>Quando</th>
            <th>Quem</th>
            <th>Ação</th>
            <th>Detalhes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>{dateTime(a.createdAt)}</td>
              <td>{a.adminName ?? '—'}</td>
              <td>
                {ACTION_LABELS[a.action] ?? a.action}
                {a.tenantSlug && <div className="pm-hint">{a.tenantSlug}</div>}
              </td>
              <td className="mono-break">
                {Object.entries(a.data ?? {})
                  .filter(([, v]) => v !== null && typeof v !== 'object')
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join(' · ')}
                {a.ip && <div className="pm-hint">IP {a.ip}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditPage() {
  const { data, error } = useLoad<AuditRow[]>('/platform/audit?limit=300');
  return (
    <>
      <div>
        <h1 className="page-title">Auditoria</h1>
        <p className="page-sub">Toda ação no painel, inclusive tentativas de login recusadas.</p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Card bodyless>{!data ? <Spinner /> : <AuditTable rows={data} />}</Card>
    </>
  );
}
