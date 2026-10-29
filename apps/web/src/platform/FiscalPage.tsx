import { Alert, Spinner } from '../design-system';
import { dateTime } from '../features/format';
import { useNavigate } from 'react-router';
import { useLoad } from './OverviewPages';
import { ago, Dot, Level, Section, Tag, Tile } from './ui';

interface FiscalRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  featureFiscal: boolean | null;
  certificateAlert: 'expired' | 'soon' | null;
  fiscal: {
    enabled: boolean;
    nfeEnabled: boolean;
    mode: 'own' | 'managed';
    environment: 'homologacao' | 'producao';
    cnpj: string | null;
    focusRegistered: boolean;
    certificateValidUntil: string | null;
    authorized30d: number;
    failed7d: number;
    pendingNow: number;
    lastAuthorizedAt: string | null;
  } | null;
}
interface FiscalOverview {
  server: {
    masterToken: boolean;
    integrationsKey: boolean;
    urlHomologacao: string;
    urlProducao: string;
  };
  totals: { enabled: number; production: number; failed7d: number; certificateAlerts: number };
  tenants: FiscalRow[];
  errors: { dbName: string; error: string }[];
}

function levelOf(t: FiscalRow): Level {
  const f = t.fiscal;
  if (!f?.enabled) return 'off';
  if (t.certificateAlert === 'expired' || f.failed7d > 0) return 'bad';
  if (t.certificateAlert === 'soon' || f.pendingNow > 0 || f.environment === 'homologacao')
    return 'warn';
  return 'ok';
}

/** Nota fiscal em todos os restaurantes: quem emite, em que ambiente, certificado e recusas. */
export function FiscalPage() {
  const { data, error } = useLoad<FiscalOverview>('/platform/fiscal');
  const navigate = useNavigate();
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <Spinner />;
  const { server, totals } = data;
  const rows = [...data.tenants].sort((a, b) => {
    const order: Level[] = ['bad', 'warn', 'ok', 'info', 'off'];
    return order.indexOf(levelOf(a)) - order.indexOf(levelOf(b)) || a.name.localeCompare(b.name);
  });
  return (
    <>
      <Section title="Servidor" sub="Configuração da emissão neste servidor">
        <div className="adm-grid">
          <Tile
            label="Conta revenda (token mestre)"
            value={server.masterToken ? 'configurada' : 'ausente'}
            level={server.masterToken ? 'ok' : 'warn'}
            sub={
              server.masterToken
                ? 'cadastro guiado disponível'
                : 'restaurantes só com token próprio'
            }
          />
          <Tile
            label="Chave dos tokens"
            value={server.integrationsKey ? 'configurada' : 'ausente'}
            level={server.integrationsKey ? 'ok' : 'bad'}
            sub="INTEGRATIONS_KEY"
          />
          <Tile label="Homologação" value="URL" sub={server.urlHomologacao} />
          <Tile label="Produção" value="URL" sub={server.urlProducao} />
        </div>
      </Section>
      <Section title="Resumo">
        <div className="adm-grid">
          <Tile label="Emitindo" value={totals.enabled} sub={`${totals.production} em produção`} />
          <Tile
            label="Notas com erro (7 dias)"
            value={totals.failed7d}
            level={totals.failed7d ? 'bad' : 'ok'}
          />
          <Tile
            label="Certificados"
            value={totals.certificateAlerts}
            level={totals.certificateAlerts ? 'warn' : 'ok'}
            sub="vencidos ou vencendo em 30 dias"
          />
        </div>
      </Section>
      {data.errors.length > 0 && (
        <Alert tone="warning">
          Não deu para ler {data.errors.length} banco(s) de restaurante:{' '}
          {data.errors.map((e) => e.dbName).join(', ')}.
        </Alert>
      )}
      <Section title="Restaurantes">
        <div className="adm-rows">
          {rows.map((t) => {
            const f = t.fiscal;
            const meta = f?.enabled
              ? [
                  f.environment === 'producao' ? 'produção' : 'homologação',
                  f.mode === 'managed' ? 'cadastro guiado' : 'token próprio',
                  f.nfeEnabled ? 'NFC-e e NF-e' : 'NFC-e',
                  `${f.authorized30d} notas em 30 dias`,
                  f.failed7d ? `${f.failed7d} com erro em 7 dias` : null,
                  f.pendingNow ? `${f.pendingNow} na fila` : null,
                  f.certificateValidUntil
                    ? `certificado até ${dateTime(f.certificateValidUntil)}`
                    : null,
                ]
              : [t.featureFiscal === false ? 'plano sem nota fiscal' : 'emissão desligada'];
            return (
              <button
                type="button"
                key={t.id}
                className="adm-row"
                onClick={() => navigate(`/restaurantes/${t.id}`)}
              >
                <Dot level={levelOf(t)} />
                <span className="adm-row__main">
                  <span className="adm-row__title">
                    {t.name}{' '}
                    {t.certificateAlert && (
                      <Tag level={t.certificateAlert === 'expired' ? 'bad' : 'warn'}>
                        {t.certificateAlert === 'expired'
                          ? 'certificado vencido'
                          : 'certificado vence logo'}
                      </Tag>
                    )}
                  </span>
                  <span className="adm-row__meta">{meta.filter(Boolean).join(' · ')}</span>
                </span>
                <span className="adm-row__side">
                  {f?.lastAuthorizedAt ? `última nota ${ago(f.lastAuthorizedAt)}` : '—'}
                </span>
              </button>
            );
          })}
        </div>
      </Section>
    </>
  );
}
