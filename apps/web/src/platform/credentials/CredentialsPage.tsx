import { ExternalLink } from 'lucide-react';
import { ReactNode, useEffect } from 'react';
import { Link, useLocation } from 'react-router';
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
import type { CredentialItem } from './KeyInUse';
import './credentials.css';

type Status = CredentialItem;

interface Overview {
  keyConfigured: boolean;
  baseDomain: string;
  focus: FocusState;
  items: Status[];
}

const INSTALL_FIRST = 'curl -fsSL https://admin.comandou.com/instalar | sudo bash';
const INSTALL_AGAIN = 'sudo bash /opt/comandou/scripts/install.sh';
const MASTER_COPY =
  'docker exec $(docker ps -q -f label=com.docker.swarm.service.name=comandou_api | head -1) cat /run/secrets/comandou_integrations_key';

const GROUPS: { id: CredGroup; title: string; sub: string }[] = [
  {
    id: 'painel',
    title: 'Aqui no painel',
    sub: 'você cola, testa e salva; fica cifrada e só o final aparece de novo',
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

const code = (s: string) => <code>{s}</code>;

function levelOf(s: Status | undefined): Level {
  if (!s || s.configured === null) return 'info';
  if (s.unreadable) return 'bad';
  if (s.configured) return 'ok';
  return s.required ? 'bad' : 'off';
}

function label(s: Status | undefined) {
  if (!s || s.configured === null) return 'confira fora daqui';
  if (s.unreadable) return 'cole de novo';
  if (s.configured) return 'configurada';
  return s.required ? 'falta' : 'opcional';
}

/** O que identifica a chave salva: ambiente, conta e o final dela. Nunca o valor. */
function inUse(s: Status | undefined) {
  if (!s?.configured) return null;
  return [s.detail, s.last4 ? `termina em ${s.last4}` : null].filter(Boolean).join(' · ') || null;
}

/**
 * Super Admin › Credenciais: tudo o que o Comandou precisa de chave, token ou senha, num lugar
 * só, com o guia para subir o sistema. As do painel se cadastram aqui mesmo; as do servidor e
 * do GitHub têm o passo a passo. As outras telas só mostram qual chave está em uso (`KeyInUse`).
 */
export function CredentialsPage() {
  const data = useLoad<Overview>('/platform/credentials');
  const o = data.data;
  const { hash } = useLocation();
  const loaded = !!o;
  // Vindo de outra tela ou da ordem para subir: rola até a credencial pedida.
  useEffect(() => {
    if (!loaded || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [loaded, hash]);
  if (data.error) return <Alert tone="danger">{data.error}</Alert>;
  if (!o) return <Spinner />;
  const byId = new Map(o.items.map((i) => [i.id, i]));
  const known = o.items.filter((i) => i.configured !== null);
  const ready = known.filter((i) => i.configured && !i.unreadable).length;
  const missing = CREDENTIALS.filter((c) => {
    const s = byId.get(c.id);
    return s?.required && (s.configured === false || s.unreadable);
  });
  const hook = byId.get('asaas_webhook');
  if (hook?.required && !hook.configured && byId.get('asaas')?.configured)
    missing.push({ ...CREDENTIALS.find((c) => c.id === 'asaas')!, title: 'webhook do Asaas' });
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
      case 'openrouter_admin':
        return <OpenRouterEditor kind="admin" onSaved={reload} />;
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

  /** Atalho para um cartão, com a bolinha da situação. */
  const jump = (id: string, name: string) => (
    <Link key={id} to={{ hash: `cred-${id}` }} className="adm-cred__jump">
      <Dot level={levelOf(byId.get(id))} />
      {name}
    </Link>
  );
  const allOk = (ids: string[]) =>
    ids.every((id) => byId.get(id)?.configured && !byId.get(id)?.unreadable);
  const needed = ['focus_master', 'openrouter_clients', 'resend', 'asaas', 'asaas_webhook'];

  return (
    <>
      <PageHead
        page
        title="Credenciais"
        sub={
          <span>
            Todas as chaves, tokens e senhas do Comandou: o que cada uma faz, como conseguir e onde
            cadastrar
          </span>
        }
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

      <Section title="Como funciona">
        <div className="adm-panel adm-cred__intro">
          <p>
            <strong>Aqui no painel</strong> você cola a chave, clica em <strong>Testar</strong> e
            depois em <strong>Salvar</strong>. Ela fica cifrada no banco com a chave mestra do
            servidor e nunca mais aparece inteira: daqui em diante, só o final dela (“termina em
            4f2a”), para você saber qual está em uso. Para trocar, cole a nova por cima.
          </p>
          <p>
            <strong>No servidor</strong>, os secrets o instalador cria sozinho. As variáveis você
            escreve no {code('/etc/comandou/deploy.env')} e roda o instalador de novo, que mantém
            tudo o que já existe.
          </p>
          <p>
            <strong>Nas outras telas</strong> (Tokens de IA, Cobrança, Pagamentos pelo app, E-mail,
            Backups, Site com IA e Chamados) aparece só qual chave está em uso. Cadastrar, trocar e
            testar é sempre aqui.
          </p>
        </div>
      </Section>

      <Section title="Para subir o sistema, na ordem">
        <ol className="adm-panel adm-cred__order">
          <li>
            <Dot level="info" />
            <div>
              <strong>Aponte o domínio para o servidor.</strong> Registros A de {code('@')},{' '}
              {code('*')} e {code('admin')} com o IP do servidor.
              <div className="adm-cred__jumps">{jump('dns', 'DNS do domínio')}</div>
            </div>
          </li>
          <li>
            <Dot level={o.keyConfigured ? 'ok' : 'bad'} />
            <div>
              <strong>Rode o instalador no servidor</strong> (por SSH): {code(INSTALL_FIRST)}. Ele
              pergunta o domínio, o seu e-mail e a senha deste painel, mostra o QR Code do
              autenticador e cria sozinho todas as senhas e tokens do servidor.
              <div className="adm-cred__jumps">
                {jump('acme_email', 'E-mail do Let’s Encrypt')}
                {jump('platform_admin', 'Seu acesso ao Super Admin')}
              </div>
            </div>
          </li>
          <li>
            <Dot level="info" />
            <div>
              <strong>Guarde a chave mestra fora do servidor</strong> (num gerenciador de senhas).
              Sem ela, nenhum backup abre. Para copiar: {code(MASTER_COPY)}
              <div className="adm-cred__jumps">
                {jump('integrations_key', 'Chave mestra (INTEGRATIONS_KEY)')}
              </div>
            </div>
          </li>
          <li>
            <Dot level={allOk(needed) ? 'ok' : 'bad'} />
            <div>
              <strong>Cadastre aqui as necessárias.</strong> Sem elas não sai nota fiscal, o
              assistente não responde, nenhum e-mail chega e a mensalidade não é cobrada.
              <div className="adm-cred__jumps">
                {jump('focus_master', 'Focus NFe')}
                {jump('openrouter_clients', 'OpenRouter dos restaurantes')}
                {jump('resend', 'Resend')}
                {jump('asaas', 'Asaas e o webhook')}
              </div>
            </div>
          </li>
          <li>
            <Dot level={byId.get('backblaze')?.configured ? 'ok' : 'off'} />
            <div>
              <strong>Depois, as que você for usar.</strong> O Backblaze é o mais recomendado: leva
              a cópia dos bancos para fora do servidor.
              <div className="adm-cred__jumps">
                {jump('backblaze', 'Backblaze B2')}
                {jump('pagbank', 'PagBank')}
                {jump('openrouter_owner', 'Sua chave do OpenRouter')}
                {jump('openrouter_admin', 'Saldo do OpenRouter')}
                {jump('openrouter_site', 'Chave dos sites')}
                {jump('github_pipeline', 'GitHub da esteira')}
                {jump('ifood', 'iFood')}
              </div>
            </div>
          </li>
          <li>
            <Dot level="off" />
            <div>
              <strong>Cada restaurante cadastra o dele</strong> no próprio sistema: certificado e
              CSC da nota fiscal, PagBank, WhatsApp e iFood.
              <div className="adm-cred__jumps">
                <Link to={{ hash: 'cred-tenants' }} className="adm-cred__jump">
                  O que cada restaurante cadastra
                </Link>
              </div>
            </div>
          </li>
        </ol>
      </Section>

      {GROUPS.map((g) => {
        const list = CREDENTIALS.filter((c) => c.group === g.id);
        return (
          <Section key={g.id} title={g.title} sub={g.sub}>
            {g.id === 'servidor' && (
              <div className="adm-panel adm-cred__howto">
                <strong>Para mudar um valor do servidor</strong>
                <ol>
                  <li>
                    Entre no servidor por SSH e abra o arquivo:{' '}
                    {code('sudo nano /etc/comandou/deploy.env')}
                  </li>
                  <li>
                    Escreva uma linha por valor, no formato {code('NOME=valor')} (sem espaço e sem
                    aspas), e salve (Ctrl+O, Enter, Ctrl+X).
                  </li>
                  <li>
                    Rode o instalador de novo: {code(INSTALL_AGAIN)}. Ele aplica o que mudou e
                    mantém o resto.
                  </li>
                </ol>
              </div>
            )}
            <div className="adm-cred__list">
              {list.map((c) => (
                <CredentialCard
                  key={c.id}
                  def={c}
                  status={byId.get(c.id)}
                  extra={
                    c.id === 'asaas' && byId.get('asaas')?.configured
                      ? hook?.configured
                        ? 'webhook cadastrado'
                        : 'falta cadastrar o webhook'
                      : undefined
                  }
                >
                  {editor(c.id)}
                </CredentialCard>
              ))}
            </div>
          </Section>
        );
      })}

      <Section title="Cada restaurante cadastra" sub="no sistema dele, não aqui">
        <div className="adm-panel adm-rows adm-cred__tenants" id="cred-tenants">
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
  extra,
  children,
}: {
  def: CredDef;
  status: Status | undefined;
  extra?: string;
  children: ReactNode;
}) {
  const level = levelOf(status);
  const using = [inUse(status), extra].filter(Boolean).join(' · ');
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
        </span>
      </header>
      {using && (
        <p className="adm-cred__inuse">
          Em uso: <span>{using}</span>
        </p>
      )}
      {status?.unreadable && (
        <Alert tone="danger">
          A chave salva não abre com a chave mestra atual do servidor. Cole a chave de novo.
        </Alert>
      )}
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
      <details className="adm-cred__how" open={status?.configured === false}>
        <summary>Passo a passo{def.fields ? ', campos' : ''} e links</summary>
        <h4>Como conseguir</h4>
        <ol>
          {def.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {def.fields && (
          <>
            <h4>O que vai em cada campo</h4>
            <dl className="adm-cred__fields">
              {def.fields.map((f) => (
                <div key={f.name}>
                  <dt>{f.name}</dt>
                  <dd>{f.text}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        {def.check && (
          <>
            <h4>Como saber que deu certo</h4>
            <p>{def.check}</p>
          </>
        )}
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
