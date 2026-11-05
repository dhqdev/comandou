import { ExternalLink, LogIn, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Spinner } from '../design-system';
import { api } from '../lib/api';
import { useOpenTenant } from './TenantsPages';
import type { SiteCheck, SiteState, SitesReport, SiteStatus } from './types';
import { ago, Dot, Level, Tag, Tile, useInterval } from './ui';

/** De quanto em quanto tempo a tela relê o status (só com a aba visível). */
export const SITES_REFRESH_MS = 15_000;

export const SITE_STATE: Record<SiteState, [string, Level]> = {
  online: ['Online', 'ok'],
  attention: ['Atenção', 'warn'],
  offline: ['Fora do ar', 'bad'],
  suspended: ['Suspenso', 'off'],
  setup: ['Em criação', 'info'],
};

const WHATSAPP: Record<NonNullable<SiteStatus['whatsapp']>['status'], [string, Level]> = {
  connected: ['Conectado', 'ok'],
  connecting: ['Conectando', 'warn'],
  qr: ['Aguardando QR', 'warn'],
  disconnected: ['Desconectado', 'off'],
  logged_out: ['Desconectado', 'off'],
  unknown: ['Sem resposta', 'warn'],
};

type Filter = 'all' | 'offline' | 'attention' | 'suspended' | 'whatsapp';

/** "200 · 353 ms" ou o motivo da falha. */
export function checkText(c: SiteCheck | null | undefined) {
  if (!c) return '—';
  if (!c.ok) return c.error ?? 'falhou';
  return [c.http, c.ms !== null ? `${c.ms} ms` : null].filter(Boolean).join(' · ');
}

const siteHref = (host: string) =>
  `${window.location.protocol}//${host}${window.location.port ? `:${window.location.port}` : ''}/`;

function backupLevel(at: string | null): Level {
  if (!at) return 'bad';
  return (Date.now() - new Date(at).getTime()) / 3_600_000 > 26 ? 'warn' : 'ok';
}

const waProblem = (s: SiteStatus) =>
  s.state !== 'suspended' &&
  s.state !== 'setup' &&
  !!s.whatsapp &&
  s.whatsapp.status !== 'connected';

/** Lê o status de todos os sites e relê sozinho a cada 15 s. */
export function useSites() {
  const [data, setData] = useState<SitesReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      setData(await api<SitesReport>(`/platform/sites${fresh ? '?fresh=1' : ''}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useInterval(() => void load(), SITES_REFRESH_MS);
  return { data, error, loading, reload: () => load(true) };
}

/** Os números do topo da tela inicial. */
export function SitesTiles({
  report,
  alerts,
  onFilter,
}: {
  report: SitesReport | null;
  alerts: number;
  onFilter: (f: Filter) => void;
}) {
  const navigate = useNavigate();
  if (!report)
    return (
      <div className="adm-grid">
        <Tile label="Sites" value="…" sub="testando" />
      </div>
    );
  const s = report.sites;
  const count = (st: SiteState) => s.filter((x) => x.state === st).length;
  const live = s.filter((x) => x.state !== 'suspended' && x.state !== 'setup');
  const dbBad = s.filter((x) => x.database.check && !x.database.check.ok).length;
  const dbOk = s.filter((x) => x.database.check?.ok).length;
  const waOn = live.filter((x) => x.whatsapp?.status === 'connected').length;
  const waOff = live.filter(waProblem).length;
  const bkOk = live.filter((x) => backupLevel(x.backup.lastOkAt) === 'ok').length;
  const offline = count('offline');
  return (
    <div className="adm-grid">
      <Tile
        label="Sites"
        value={offline ? `${offline} fora do ar` : `${count('online') + count('attention')} online`}
        sub={
          offline
            ? `${count('online') + count('attention')} online · ${count('suspended')} suspenso(s)`
            : `0 fora do ar · ${count('suspended')} suspenso(s)`
        }
        level={offline ? 'bad' : undefined}
        onClick={() => onFilter(offline ? 'offline' : 'all')}
      />
      <Tile
        label="Bancos"
        value={`${dbOk} ok`}
        sub={dbBad ? `${dbBad} sem resposta` : 'todos respondendo'}
        level={dbBad ? 'bad' : undefined}
        onClick={() => navigate('/servidor/bancos')}
      />
      <Tile
        label="WhatsApp"
        value={
          report.whatsappGateway === 'disabled'
            ? 'desligado'
            : report.whatsappGateway === 'error'
              ? 'fora do ar'
              : `${waOn} conectado(s)`
        }
        sub={
          report.whatsappGateway === 'ok'
            ? `${waOff} desconectado(s)`
            : report.whatsappGateway === 'disabled'
              ? 'serviço não configurado'
              : 'serviço sem resposta'
        }
        level={report.whatsappGateway === 'error' ? 'bad' : undefined}
        onClick={() => onFilter('whatsapp')}
      />
      <Tile
        label="Backups"
        value={`${bkOk} em dia`}
        sub={`${live.length - bkOk} com atenção`}
        level={live.length - bkOk ? 'warn' : undefined}
        onClick={() => navigate('/servidor/backups')}
      />
      <Tile
        label="Alertas"
        value={alerts + count('attention')}
        sub={alerts + count('attention') ? 'veja abaixo' : 'tudo certo'}
        level={alerts + count('attention') ? 'warn' : undefined}
        onClick={() => onFilter('attention')}
      />
    </div>
  );
}

/** Tabela de sites: situação, endereço, ações, banco, WhatsApp e último backup. */
export function SitesTable({
  report,
  error,
  loading,
  filter,
  setFilter,
  onReload,
}: {
  report: SitesReport | null;
  error: string | null;
  loading: boolean;
  filter: Filter;
  setFilter: (f: Filter) => void;
  onReload: () => void;
}) {
  const navigate = useNavigate();
  const { open, busy, sheet } = useOpenTenant();
  const [search, setSearch] = useState('');
  // Relógio para o "lido há X s" andar sozinho.
  const [, setNow] = useState(0);
  useInterval(() => setNow((n) => n + 1), 5000);

  const sites = report?.sites ?? [];
  const counts: Record<Filter, number> = useMemo(
    () => ({
      all: sites.length,
      offline: sites.filter((s) => s.state === 'offline').length,
      attention: sites.filter((s) => s.state === 'attention').length,
      suspended: sites.filter((s) => s.state === 'suspended').length,
      whatsapp: sites.filter(waProblem).length,
    }),
    [sites],
  );
  const q = search.trim().toLowerCase();
  const shown = sites
    .filter((s) =>
      filter === 'all' ? true : filter === 'whatsapp' ? waProblem(s) : s.state === filter,
    )
    .filter(
      (s) =>
        !q ||
        [
          s.name,
          s.host,
          s.database.name,
          s.database.server,
          s.planName,
          ...s.domains.map((d) => d.hostname),
        ]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
    )
    // Problema primeiro; depois por nome.
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name, 'pt-BR'));

  const chips: [Filter, string][] = [
    ['all', 'Todos'],
    ['offline', 'Fora do ar'],
    ['attention', 'Com atenção'],
    ['whatsapp', 'WhatsApp desconectado'],
    ['suspended', 'Suspensos'],
  ];

  return (
    <section className="adm-section">
      <div className="adm-search adm-sites__bar">
        <input
          className="cm-input"
          placeholder="Buscar site, domínio, banco ou servidor"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar site"
        />
        <div className="adm-chips" role="group" aria-label="Filtrar sites">
          {chips.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className="adm-chip"
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
            >
              {label} <span>{counts[k]}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="adm-action"
          onClick={onReload}
          disabled={loading}
          aria-busy={loading}
        >
          <RefreshCw size={15} className={loading ? 'adm-spin' : undefined} /> Recarregar
        </button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="adm-panel">
        {!report ? (
          <div className="adm-panel__body">
            <Spinner />
          </div>
        ) : shown.length === 0 ? (
          <div className="adm-empty">
            {sites.length === 0 ? 'Nenhum restaurante cadastrado' : 'Nenhum site neste filtro'}
          </div>
        ) : (
          <div className="adm-sites">
            <div className="adm-sites__row adm-sites__head" aria-hidden>
              <span>Situação</span>
              <span>Site</span>
              <span>Ações</span>
              <span>Banco</span>
              <span>WhatsApp</span>
              <span>Último backup</span>
            </div>
            {shown.map((s) => {
              const [label, level] = SITE_STATE[s.state];
              const wa = s.whatsapp ? WHATSAPP[s.whatsapp.status] : null;
              const bk = backupLevel(s.backup.lastOkAt);
              const db = s.database;
              return (
                <div
                  key={s.id}
                  className={`adm-sites__row is-link adm-sites__row--${level}`}
                  onClick={() => navigate(`/restaurantes/${s.id}`)}
                >
                  <span className="adm-sites__cell adm-sites__state">
                    <Tag level={level}>{label}</Tag>
                    <span className="adm-row__meta">
                      {!s.web
                        ? s.state === 'suspended'
                          ? 'não testado'
                          : '—'
                        : s.web.ok
                          ? checkText(s.web)
                          : s.web.http
                            ? `HTTP ${s.web.http}`
                            : 'sem resposta'}
                    </span>
                  </span>
                  <span className="adm-sites__cell adm-sites__site">
                    <span className="adm-row__title">{s.name}</span>
                    <code className="adm-sites__host">{s.host}</code>
                    {s.domains.map((d) => (
                      <span key={d.hostname} className="adm-row__meta adm-sites__domain">
                        <Dot
                          level={!d.verified ? 'off' : d.check?.ok ? 'ok' : d.check ? 'bad' : 'off'}
                        />
                        {d.hostname}
                        {!d.verified && ' · aguardando DNS'}
                        {d.check && ` · ${checkText(d.check)}`}
                      </span>
                    ))}
                    {s.issues.length > 0 && (
                      <span
                        className={`adm-sites__issues adm-text--${level === 'bad' ? 'bad' : 'warn'}`}
                      >
                        {s.issues.join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="adm-sites__cell adm-sites__actions">
                    {s.status === 'provisioned' && (
                      <button
                        type="button"
                        className="adm-action adm-action--sm"
                        title="Abrir o sistema do restaurante já logado"
                        aria-busy={busy === s.id}
                        disabled={busy === s.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void open(s.id);
                        }}
                      >
                        <LogIn size={14} /> {busy === s.id ? 'Abrindo…' : 'Entrar'}
                      </button>
                    )}
                    <a
                      className="adm-icon-btn"
                      href={siteHref(s.host)}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={`Abrir ${s.host}`}
                      aria-label={`Abrir ${s.host} em nova aba`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink size={15} />
                    </a>
                  </span>
                  <span className="adm-sites__cell adm-sites__db">
                    {db.kind === 'dedicated' ? (
                      <code title={db.name ?? undefined}>{db.name}</code>
                    ) : (
                      <span>Banco central</span>
                    )}
                    <span className="adm-row__meta">
                      {db.kind === 'dedicated' && `${db.server} · `}
                      {db.check ? (
                        <span className={db.check.ok ? 'adm-text--ok' : 'adm-text--bad'}>
                          {db.check.ok ? `ok · ${db.check.ms} ms` : db.check.error}
                        </span>
                      ) : (
                        'não testado'
                      )}
                    </span>
                  </span>
                  <span
                    className={`adm-sites__cell adm-sites__wa${wa ? '' : ' adm-sites__wa--none'}`}
                  >
                    {wa ? (
                      <>
                        <Tag level={wa[1]}>{wa[0]}</Tag>
                        {s.whatsapp?.phone && (
                          <span className="adm-row__meta">{s.whatsapp.phone}</span>
                        )}
                      </>
                    ) : (
                      <span className="adm-row__meta">—</span>
                    )}
                  </span>
                  <span className="adm-sites__cell adm-sites__backup">
                    <Tag level={bk}>
                      {bk === 'ok' ? 'OK' : bk === 'warn' ? 'Atrasado' : 'Nunca'}
                    </Tag>
                    <span className="adm-row__meta">{ago(s.backup.lastOkAt)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {report && (
        <div className="adm-sub adm-sites__foot">
          Mostrando {shown.length} de {sites.length} site(s) · lido {ago(report.checkedAt)} ·
          atualiza sozinho a cada {SITES_REFRESH_MS / 1000} s
        </div>
      )}
      {sheet}
    </section>
  );
}

const ORDER: Record<SiteState, number> = {
  offline: 0,
  attention: 1,
  online: 2,
  setup: 3,
  suspended: 4,
};

/** Bloco inteiro (números + tabela), usado na tela "Status". */
export function useSitesFilter() {
  return useState<Filter>('all');
}
export type { Filter as SitesFilter };
