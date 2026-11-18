import { ExternalLink } from 'lucide-react';
import { ReactNode, useEffect } from 'react';
import { useLocation } from 'react-router';
import { Alert, Spinner } from '../../design-system';
import { useLoad } from '../OverviewPages';
import { Dot, Level, PageHead, Section, Tag, Tile } from '../ui';
import { CREDENTIALS, CredDef, CredGroup, TENANT_CREDENTIALS } from './catalog';
import {
  AsaasEditor,
  BackblazeEditor,
  FocusEditor,
  FocusState,
  GithubEditor,
  OpenRouterEditor,
  PagBankEditor,
  ResendEditor,
  SiteKeyEditor,
} from './editors';
import './credentials.css';

interface Status {
  id: string;
  configured: boolean | null;
  required: boolean;
  detail?: string;
}

interface Overview {
  keyConfigured: boolean;
  baseDomain: string;
  focus: FocusState;
  items: Status[];
}

const GROUPS: { id: CredGroup; title: string; sub: string }[] = [
  {
    id: 'painel',
    title: 'Aqui no painel',
    sub: 'você cola a chave e salva; fica cifrada e nunca aparece de novo',
  },
  {
    id: 'instalador',
    title: 'No servidor, criadas pelo instalador',
    sub: 'Docker secrets gerados sozinhos na primeira subida',
  },
  {
    id: 'servidor',
    title: 'No servidor, você informa',
    sub: 'DNS e valores do /etc/comandou/deploy.env',
  },
  { id: 'github', title: 'No GitHub', sub: 'só para implantar pelo GitHub Actions' },
];

function levelOf(s: Status | undefined): Level {
  if (!s || s.configured === null) return 'info';
  if (s.configured) return 'ok';
  return s.required ? 'bad' : 'off';
}

function label(s: Status | undefined) {
  if (!s || s.configured === null) return 'confira fora daqui';
  if (s.configured) return 'configurada';
  return s.required ? 'falta' : 'opcional';
}

/**
 * Super Admin › Credenciais: tudo o que o Comandou precisa de chave, token ou senha, num lugar
 * só. As do painel se cadastram aqui mesmo; as do servidor e do GitHub têm o passo a passo.
 * As outras telas (Tokens, Cobrança, Pagamentos, E-mail, Backups, Chamados) ficam só com os
 * ajustes de cada assunto.
 */
export function CredentialsPage() {
  const data = useLoad<Overview>('/platform/credentials');
  const o = data.data;
  const { hash } = useLocation();
  const loaded = !!o;
  // Vindo de outra tela (ex.: "Abrir em Credenciais"), rola até a credencial pedida.
  useEffect(() => {
    if (!loaded || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [loaded, hash]);
  if (data.error) return <Alert tone="danger">{data.error}</Alert>;
  if (!o) return <Spinner />;
  const byId = new Map(o.items.map((i) => [i.id, i]));
  const known = o.items.filter((i) => i.configured !== null);
  const ready = known.filter((i) => i.configured).length;
  const missing = CREDENTIALS.filter((c) => {
    const s = byId.get(c.id);
    return s?.required && s.configured === false;
  });
  const external = o.items.filter((i) => i.configured === null).length;

  const editor = (id: string): ReactNode => {
    const reload = data.reload;
    switch (id) {
      case 'focus_master':
        return <FocusEditor focus={o.focus} keyConfigured={o.keyConfigured} onSaved={reload} />;
      case 'openrouter_clients':
        return <OpenRouterEditor kind="clients" onSaved={reload} />;
      case 'openrouter_owner':
        return <OpenRouterEditor kind="owner" onSaved={reload} />;
      case 'openrouter_site':
        return <SiteKeyEditor onSaved={reload} />;
      case 'resend':
        return <ResendEditor onSaved={reload} />;
      case 'asaas':
        return <AsaasEditor onSaved={reload} />;
      case 'pagbank':
        return <PagBankEditor onSaved={reload} />;
      case 'backblaze':
        return <BackblazeEditor onSaved={reload} />;
      case 'github_pipeline':
        return <GithubEditor onSaved={reload} />;
      default:
        return null;
    }
  };

  return (
    <>
      <PageHead
        page
        title="Credenciais"
        sub={<span>Todas as chaves, tokens e senhas do Comandou, e como conseguir cada uma</span>}
      />
      <Section title="Situação">
        <div className="adm-grid">
          <Tile
            label="Configuradas"
            value={`${ready} de ${known.length}`}
            level={ready === known.length ? 'ok' : 'warn'}
            sub="que dá para conferir daqui"
          />
          <Tile
            label="Faltando"
            value={missing.length}
            level={missing.length ? 'bad' : 'ok'}
            sub={missing.length ? 'necessárias para subir' : 'nenhuma necessária'}
          />
          <Tile
            label="Para conferir fora daqui"
            value={external}
            level="info"
            sub="DNS, GitHub e serviços do servidor"
          />
        </div>
        {missing.length > 0 && (
          <div className="adm-cred__missing">
            <Alert tone="warning">Falta cadastrar: {missing.map((c) => c.title).join(', ')}.</Alert>
          </div>
        )}
        {!o.keyConfigured && (
          <Alert tone="danger">
            O servidor está sem a chave mestra (INTEGRATIONS_KEY). Nenhuma chave do painel pode ser
            salva até ela existir: rode o instalador de novo.
          </Alert>
        )}
      </Section>

      {GROUPS.map((g) => {
        const list = CREDENTIALS.filter((c) => c.group === g.id);
        return (
          <Section key={g.id} title={g.title} sub={g.sub}>
            <div className="adm-cred__list">
              {list.map((c) => (
                <CredentialCard key={c.id} def={c} status={byId.get(c.id)}>
                  {editor(c.id)}
                </CredentialCard>
              ))}
            </div>
          </Section>
        );
      })}

      <Section title="Cada restaurante cadastra" sub="no sistema dele, não aqui">
        <div className="adm-panel adm-rows adm-cred__tenants">
          {TENANT_CREDENTIALS.map((t) => (
            <div key={t.title} className="adm-row">
              <Dot level="off" />
              <span className="adm-row__main">
                <span className="adm-row__title">{t.title}</span>
                <span className="adm-row__meta">{t.what}</span>
              </span>
              <span className="adm-row__side">
                <small>{t.where}</small>
              </span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function CredentialCard({
  def,
  status,
  children,
}: {
  def: CredDef;
  status: Status | undefined;
  children: ReactNode;
}) {
  const level = levelOf(status);
  return (
    <article className="adm-cred" id={`cred-${def.id}`}>
      <header className="adm-cred__head">
        <Dot level={level} />
        <div className="adm-cred__title">
          <h3>{def.title}</h3>
          <p>{def.purpose}</p>
        </div>
        <span className="adm-cred__tag">
          <Tag level={level === 'off' ? undefined : level}>{label(status)}</Tag>
          {status?.detail && <small>{status.detail}</small>}
        </span>
      </header>
      {def.where && (
        <p className="adm-cred__where">
          {def.group === 'instalador'
            ? 'Secret: '
            : def.group === 'github'
              ? 'No GitHub: '
              : 'No servidor: '}
          {def.where.map((w, i) => (
            <span key={w}>
              {i > 0 && ', '}
              <code>{w}</code>
            </span>
          ))}
        </p>
      )}
      <details className="adm-cred__how" open={!children && status?.configured === false}>
        <summary>Como conseguir e cadastrar</summary>
        <ol>
          {def.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {def.links && def.links.length > 0 && (
          <ul className="adm-cred__links">
            {def.links.map((l) => (
              <li key={l.href}>
                <a href={l.href} target="_blank" rel="noreferrer">
                  {l.label} <ExternalLink size={13} aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        )}
      </details>
      {children && <div className="adm-cred__body">{children}</div>}
    </article>
  );
}
