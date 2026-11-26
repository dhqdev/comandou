import { useEffect, useRef, useState } from 'react';
import { Alert, Skeleton } from '../design-system';
import { api } from '../lib/api';
import { brl } from '../lib/money';
import type { BackupSettings, Overview, PendingContract, ServerStatus, UpdateInfo } from './types';
import { ChevronRight } from 'lucide-react';
import { bytes, Dot, PageHead, Section, Tile } from './ui';
import { useNavigate } from 'react-router';
import { SitesTable, SitesTiles, useSites, useSitesFilter, type SitesFilter } from './SitesStatus';
import type { CredentialItem } from './credentials/KeyInUse';
import { newerVersion, statusAlerts } from './status-alerts';

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

interface PlatformWa {
  configured: boolean;
  status: string;
  phone?: string;
}

/**
 * Tela inicial do Super Admin: o que pede ação agora (alertas), o negócio (receita, testes,
 * inadimplência, atendimento) e os restaurantes no ar; servidor e saúde ficam em Infraestrutura. Cada número leva à
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
  const biz = data.business;
  const support = data.support;
  const usage = data.usage;
  const newer = newerVersion(update.data?.latest?.version, data.version);

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
      {/* Servidor e Saúde saíram do Status (pedido do David, 0.267.0): ficam em Infraestrutura, e
          o que der problema aparece em "Pede atenção" (statusAlerts). */}
    </>
  );
}
