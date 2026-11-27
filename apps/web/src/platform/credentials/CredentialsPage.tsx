import {
  Activity,
  Bot,
  Boxes,
  CloudUpload,
  CreditCard,
  Database,
  ExternalLink,
  GitBranch,
  Globe,
  KeyRound,
  Landmark,
  Lock,
  type LucideIcon,
  Mail,
  Maximize2,
  MessageCircle,
  Network,
  Package,
  ReceiptText,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  UserCog,
  Wallet,
} from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Alert, canAnimate, Modal, Skeleton } from '../../design-system';
import { api } from '../../lib/api';
import { spotlight } from '../../lib/deep-link';
import { useLoad } from '../OverviewPages';
import { ago, Dot, Level, PageHead, Section, Tile } from '../ui';
import { CREDENTIALS, CredDef, CredGroup, TENANT_CREDENTIALS } from './catalog';
import {
  AsaasEditor,
  BackblazeEditor,
  ChannelEditor,
  CustomOdEditor,
  type CustomOdApp,
  type ChannelCredState,
  FocusEditor,
  FocusState,
  GithubEditor,
  OpenRouterEditor,
  PagBankEditor,
  ResendEditor,
} from './editors';
import type { CredentialItem } from './KeyInUse';
import './credentials.css';

type Status = CredentialItem;

/** Resultado de "Conferir todas" (a chave salva usada agora no fornecedor). */
interface CheckResult {
  id: string;
  /** null = não dá para testar daqui sem efeito colateral. */
  ok: boolean | null;
  detail: string;
  ms: number;
}
interface CheckReport {
  checkedAt: string;
  results: CheckResult[];
}

interface Overview {
  keyConfigured: boolean;
  baseDomain: string;
  focus: FocusState;
  channels: Record<string, ChannelCredState>;
  customOd?: CustomOdApp[];
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

/** Ícone de cada cartão (solto, cinza: quem diz a situação é a bolinha). */
const ICONS: Record<string, LucideIcon> = {
  focus_master: ReceiptText,
  channel_od_apps: Boxes,
  openrouter_clients: Sparkles,
  openrouter_owner: Bot,
  openrouter_admin: Wallet,
  resend: Mail,
  asaas: Landmark,
  pagbank: CreditCard,
  backblaze: CloudUpload,
  github_pipeline: GitBranch,
  integrations_key: KeyRound,
  database: Database,
  platform_admin: UserCog,
  whatsapp_gateway: MessageCircle,
  whatsapp_session: Smartphone,
  traefik_provider: Network,
  host_agent: Server,
  metrics: Activity,
  crowdsec: ShieldCheck,
  dns: Globe,
  acme_email: Lock,
  update_github: RefreshCw,
  ghcr_agent: Package,
  github_deploy: Rocket,
};
const iconOf = (id: string): LucideIcon =>
  ICONS[id] ?? (id.startsWith('channel_') ? ShoppingBag : KeyRound);

/** "Focus NFe · Token Master" → nome grande e o que é, embaixo. */
function splitTitle(title: string): [string, string | null] {
  const at = title.indexOf(' · ');
  return at < 0 ? [title, null] : [title.slice(0, at), title.slice(at + 3)];
}

const code = (s: string) => <code>{s}</code>;

function levelOf(s: Status | undefined): Level {
  if (!s || s.configured === null) return 'info';
  if (s.unreadable) return 'bad';
  if (s.configured) return 'ok';
  return s.required ? 'bad' : 'off';
}

/** O que identifica a chave salva: ambiente, conta e o final dela. Nunca o valor. */
function inUse(s: Status | undefined) {
  if (!s?.configured) return null;
  return [s.detail, s.last4 ? `termina em ${s.last4}` : null].filter(Boolean).join(' · ') || null;
}

type Filter = 'all' | 'missing' | 'ok' | 'unused' | 'external';
const FILTERS: [Filter, string][] = [
  ['all', 'Todas'],
  ['missing', 'Pedem atenção'],
  ['ok', 'Em uso'],
  ['unused', 'Sem uso'],
  ['external', 'Fora daqui'],
];

/** A situação de um cartão: a bolinha, a palavra e a linha de baixo. */
interface CardState {
  level: Level;
  label: string;
  note: string;
  filter: Exclude<Filter, 'all'>;
}

function stateOf(
  def: CredDef,
  s: Status | undefined,
  check: CheckResult | undefined,
  /** Falta algo junto da chave (ex.: o webhook do Asaas). */
  pending?: string,
): CardState {
  // Salva mas recusada agora pelo fornecedor: vermelho, mesmo cadastrada.
  if (check?.ok === false)
    return { level: 'bad', label: 'Recusada', note: check.detail, filter: 'missing' };
  if (!s || s.configured === null)
    return {
      level: 'info',
      label: 'Fora daqui',
      note: def.where?.[0] ?? 'Confira no servidor',
      filter: 'external',
    };
  if (s.unreadable)
    return {
      level: 'bad',
      label: 'Cole de novo',
      note: 'Não abre com a chave mestra atual',
      filter: 'missing',
    };
  if (s.configured)
    return pending
      ? { level: 'warn', label: pending, note: inUse(s) ?? 'Cadastrada', filter: 'missing' }
      : {
          level: 'ok',
          // Conferida agora no fornecedor: a etiqueta diz que funciona.
          label: check?.ok ? 'Funcionando' : 'Em uso',
          note: inUse(s) ?? 'Cadastrada',
          filter: 'ok',
        };
  return s.required
    ? {
        level: 'bad',
        label: 'Falta',
        note: 'Necessária para o sistema funcionar',
        filter: 'missing',
      }
    : { level: 'off', label: 'Sem uso', note: 'Não cadastrada', filter: 'unused' };
}

/**
 * Super Admin › Credenciais: tudo o que o Comandou precisa de chave, token ou senha, num lugar
 * só, com o guia para subir o sistema. Cada credencial é um cartão com a situação; clicar amplia
 * numa janela com o cadastro e o passo a passo (o endereço ganha `#cred-<id>`, e as outras telas
 * abrem direto nele). As outras telas só mostram qual chave está em uso (`KeyInUse`).
 */
export function CredentialsPage() {
  const data = useLoad<Overview>('/platform/credentials');
  const o = data.data;
  const [checks, setChecks] = useState<CheckReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const checkAll = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      setChecks(await api<CheckReport>('/platform/credentials/check', { method: 'POST' }));
    } catch (e) {
      setCheckError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };
  const { hash } = useLocation();
  const navigate = useNavigate();
  const loaded = !!o;
  // Chegou de outra tela com #cred-<id>: rola até o cartão (a janela abre sozinha). Clicar num
  // cartão aqui também muda o endereço, mas aí não rola nada.
  const arrivedWith = useRef(hash);
  useEffect(() => {
    if (!loaded || !hash) return;
    const target = decodeURIComponent(hash.slice(1));
    const isCard = CREDENTIALS.some((c) => `cred-${c.id}` === target);
    if (isCard && hash !== arrivedWith.current) return;
    arrivedWith.current = '';
    document.getElementById(target)?.scrollIntoView({ block: isCard ? 'center' : 'start' });
    if (!isCard) return;
    // Chegou de outra tela para cadastrar (ex.: "Cadastrar a chave do sistema" em Tokens de IA ou
    // Chamados): a janela abre e o campo da chave pisca. O formulário carrega depois da janela,
    // então procura por até 3 s.
    let tries = 0;
    const timer = window.setInterval(() => {
      const box = document.querySelector('dialog.adm-cred-modal[open]');
      const field =
        box?.querySelector<HTMLElement>('[data-search-id="cred-campo"]') ??
        box?.querySelector<HTMLElement>('input[type="password"], input[type="text"], textarea');
      if (field || ++tries > 20) {
        window.clearInterval(timer);
        if (field) spotlight(field);
      }
    }, 150);
    return () => window.clearInterval(timer);
  }, [loaded, hash]);
  // Cartão aberto = o do endereço (#cred-<id>). O último aberto segue na janela enquanto ela fecha.
  const openId = hash.startsWith('#cred-') ? decodeURIComponent(hash.slice('#cred-'.length)) : '';
  const openDef = CREDENTIALS.find((c) => c.id === openId) ?? null;
  const lastDef = useRef<CredDef | null>(null);
  if (openDef) lastDef.current = openDef;
  const shownDef = openDef ?? lastDef.current;
  // Aberta pelo clique no cartão: a janela amplia a partir dele.
  const zoomFrom = useRef<string | null>(null);
  useEffect(() => {
    const id = zoomFrom.current;
    zoomFrom.current = null;
    if (!id || id !== openId) return;
    zoomIn(
      document.getElementById(`cred-${id}`),
      document.querySelector<HTMLElement>('dialog.adm-cred-modal[open]'),
    );
  }, [openId]);
  if (data.error) return <Alert tone="danger">{data.error}</Alert>;
  if (!o) return <Skeleton variant="page" />;
  const byId = new Map(o.items.map((i) => [i.id, i]));
  const known = o.items.filter((i) => i.configured !== null);
  const isReady = (i: Status) => !!i.configured && !i.unreadable;
  // Necessárias e opcionais separadas: 6 aplicativos de delivery que você não usa não são "falta".
  // O webhook do Asaas só conta depois da chave (ele é cadastrado junto, no mesmo cartão).
  const asaasReady = !!byId.get('asaas') && isReady(byId.get('asaas')!);
  const needed = known.filter((i) => i.required && (i.id !== 'asaas_webhook' || asaasReady));
  const optional = known.filter((i) => !i.required);
  const neededOk = needed.filter(isReady).length;
  const checkOf = new Map(checks?.results.map((r) => [r.id, r]));
  const refused = checks?.results.filter((r) => r.ok === false) ?? [];
  const tested = checks?.results.filter((r) => r.ok !== null) ?? [];
  const missing = CREDENTIALS.filter((c) => {
    const s = byId.get(c.id);
    return s?.required && (s.configured === false || s.unreadable);
  });
  const hook = byId.get('asaas_webhook');
  const hookMissing = !!hook?.required && !hook.configured && !!byId.get('asaas')?.configured;
  if (hookMissing)
    missing.push({ ...CREDENTIALS.find((c) => c.id === 'asaas')!, title: 'webhook do Asaas' });
  const external = o.items.filter((i) => i.configured === null).length;

  const states = new Map(
    CREDENTIALS.map((c) => [
      c.id,
      stateOf(
        c,
        byId.get(c.id),
        checkOf.get(c.id),
        c.id === 'asaas' && hookMissing ? 'Falta o webhook' : undefined,
      ),
    ]),
  );
  const count = (f: Filter) =>
    f === 'all'
      ? CREDENTIALS.length
      : CREDENTIALS.filter((c) => states.get(c.id)!.filter === f).length;
  const shows = (c: CredDef) => filter === 'all' || states.get(c.id)!.filter === filter;

  const open = (id: string) => navigate({ hash: `cred-${id}` }, { replace: true });
  const close = () => navigate({ hash: '' }, { replace: true });

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
      case 'channel_od_apps':
        return (
          <CustomOdEditor
            apps={o.customOd ?? []}
            keyConfigured={o.keyConfigured}
            onSaved={reload}
          />
        );
      default:
        if (id.startsWith('channel_')) {
          const channel = id.slice('channel_'.length);
          return (
            <ChannelEditor
              channel={channel}
              state={o.channels?.[channel]}
              keyConfigured={o.keyConfigured}
              onSaved={reload}
            />
          );
        }
        return null;
    }
  };

  /** Atalho para um cartão, com a bolinha da situação. */
  const jump = (id: string, name: string) => (
    <Link key={id} to={{ hash: `cred-${id}` }} className="adm-cred__jump">
      <Dot level={states.get(id)?.level ?? levelOf(byId.get(id))} />
      {name}
    </Link>
  );
  const allOk = (ids: string[]) =>
    ids.every((id) => byId.get(id)?.configured && !byId.get(id)?.unreadable);
  const panelNeeded = ['focus_master', 'openrouter_clients', 'resend', 'asaas', 'asaas_webhook'];
  const shownEditor = shownDef ? editor(shownDef.id) : null;

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
        actions={
          <button
            type="button"
            className="adm-action"
            onClick={() => void checkAll()}
            disabled={checking}
            aria-busy={checking}
            title="Usa cada chave salva no fornecedor agora, sem cobrar nem enviar nada"
          >
            <ShieldCheck size={15} /> {checking ? 'Conferindo…' : 'Conferir todas agora'}
          </button>
        }
      />
      <Section title="Situação">
        <div className="adm-grid">
          <Tile
            label="Necessárias"
            value={`${neededOk} de ${needed.length}`}
            level={missing.length ? 'bad' : 'ok'}
            sub={
              needed.length - neededOk
                ? `${needed.length - neededOk} faltando para o sistema funcionar`
                : 'todas cadastradas'
            }
          />
          <Tile
            label="Opcionais em uso"
            value={`${optional.filter(isReady).length} de ${optional.length}`}
            sub="delivery, PagBank, Backblaze, GitHub…"
          />
          <Tile
            label="Conferidas no fornecedor"
            value={checks ? `${tested.length - refused.length} de ${tested.length}` : '—'}
            level={!checks || !tested.length ? undefined : refused.length ? 'bad' : 'ok'}
            sub={
              !checks
                ? 'clique em Conferir todas agora'
                : !tested.length
                  ? 'nenhuma chave salva para conferir'
                  : refused.length
                    ? `${refused.length} recusada(s) · ${ago(checks.checkedAt)}`
                    : `todas funcionando · ${ago(checks.checkedAt)}`
            }
            onClick={checking ? undefined : () => void checkAll()}
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
            <Alert tone="warning">
              Falta cadastrar:{' '}
              {missing.map((c, i) => (
                <span key={c.title}>
                  {i > 0 && ', '}
                  <Link to={{ hash: `cred-${c.id}` }}>{c.title}</Link>
                </span>
              ))}
              .
            </Alert>
          </div>
        )}
        {checkError && <Alert tone="danger">{checkError}</Alert>}
        {refused.length > 0 && (
          <div className="adm-cred__missing">
            <Alert tone="danger">
              O fornecedor recusou agora:{' '}
              {refused.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && '; '}
                  <Link to={{ hash: `cred-${r.id}` }}>
                    {CREDENTIALS.find((c) => c.id === r.id)?.title ?? r.id}
                  </Link>{' '}
                  ({r.detail})
                </span>
              ))}
              .
            </Alert>
          </div>
        )}
        {!o.keyConfigured && (
          <Alert tone="danger">
            O servidor está sem a chave mestra (INTEGRATIONS_KEY). Nenhuma chave do painel pode ser
            salva até ela existir: rode o instalador de novo.
          </Alert>
        )}
      </Section>

      <details className="adm-panel adm-cred__guide" open={missing.length > 0 || !o.keyConfigured}>
        <summary>
          <span>
            <strong>Como funciona e a ordem para subir o sistema</strong>
            <small>o que se cadastra aqui, o que fica no servidor e os 6 passos</small>
          </span>
        </summary>
        <div className="adm-cred__intro">
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
        <ol className="adm-cred__order">
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
            <Dot level={allOk(panelNeeded) ? 'ok' : 'bad'} />
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
                {jump('openrouter_owner', 'Chave do sistema no OpenRouter')}
                {jump('openrouter_admin', 'Saldo do OpenRouter')}
                {jump('github_pipeline', 'GitHub da esteira')}
                {jump('channel_ifood', 'iFood')}
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
      </details>

      <div className="adm-chips adm-cred__filters" role="group" aria-label="Filtrar credenciais">
        {FILTERS.map(([f, name]) => (
          <button
            key={f}
            type="button"
            className="adm-chip"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {name} <span>{count(f)}</span>
          </button>
        ))}
      </div>

      {GROUPS.map((g) => {
        const all = CREDENTIALS.filter((c) => c.group === g.id);
        // Necessárias primeiro, depois as cadastradas; o resto na ordem do catálogo.
        const rank = (c: CredDef) => {
          const st = byId.get(c.id);
          return st?.required ? 0 : st?.configured ? 1 : 2;
        };
        const list = all.filter(shows).sort((a, b) => rank(a) - rank(b));
        if (!list.length) return null;
        const using = all.filter((c) => states.get(c.id)!.filter === 'ok').length;
        const tracked = all.some((c) => states.get(c.id)!.filter !== 'external');
        return (
          <Section
            key={g.id}
            title={g.title}
            sub={g.sub}
            actions={
              tracked ? (
                <span className="adm-cred__count">
                  {using} de {all.length} em uso
                </span>
              ) : undefined
            }
          >
            <div className="adm-cred-grid">
              {list.map((c) => (
                <CredTile
                  key={c.id}
                  def={c}
                  state={states.get(c.id)!}
                  required={!!byId.get(c.id)?.required}
                  onOpen={() => {
                    zoomFrom.current = c.id;
                    open(c.id);
                  }}
                />
              ))}
            </div>
          </Section>
        );
      })}
      {filter !== 'all' && count(filter) === 0 && (
        <p className="adm-cred__empty">Nenhuma credencial aqui agora.</p>
      )}

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

      <Modal
        open={!!openDef}
        onClose={close}
        size={shownEditor ? 'xl' : 'lg'}
        className="adm-cred-modal"
        title={shownDef ? <CredTitle def={shownDef} /> : ''}
      >
        {shownDef && (
          <CredentialDetail
            def={shownDef}
            status={byId.get(shownDef.id)}
            state={states.get(shownDef.id)!}
            check={checkOf.get(shownDef.id)}
            editor={shownEditor}
          />
        )}
      </Modal>
    </>
  );
}

/**
 * O cartão amplia: a janela nasce do tamanho e do lugar dele e cresce até o centro (só transform,
 * ~0,26 s, por cima do esmaecer de sempre). A folha do celular segue subindo de baixo, e o
 * Playwright e o "reduzir movimento" abrem na hora, como em toda janela.
 */
function zoomIn(from: Element | null, d: HTMLElement | null) {
  if (!from || !d || !canAnimate(d) || navigator.webdriver) return;
  // Tira o "nada de escala" da janela comum para medir e crescer daqui.
  d.getAnimations().forEach((a) => {
    const frames = (a.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
    if (frames.some((k) => 'transform' in k)) a.cancel();
  });
  const a = from.getBoundingClientRect();
  const b = d.getBoundingClientRect();
  if (!a.width || !b.width || !b.height || b.width >= innerWidth - 2) return;
  const start = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
  d.animate(
    [
      { transformOrigin: '0 0', transform: start },
      { transformOrigin: '0 0', transform: 'none' },
    ],
    { duration: 260, easing: 'cubic-bezier(.32, .72, 0, 1)' },
  );
}

function CredTitle({ def }: { def: CredDef }) {
  const Icon = iconOf(def.id);
  return (
    <span className="adm-cred-modal__title">
      <Icon size={18} aria-hidden />
      {def.title}
    </span>
  );
}

/** O cartão fechado: ícone, situação, nome, para que serve e o que está em uso. */
function CredTile({
  def,
  state,
  required,
  onOpen,
}: {
  def: CredDef;
  state: CardState;
  required: boolean;
  onOpen(): void;
}) {
  const Icon = iconOf(def.id);
  const [name, kind] = splitTitle(def.title);
  const sub = [kind, required ? 'necessária' : null].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      id={`cred-${def.id}`}
      className="adm-cred-tile"
      data-state={state.level}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <span className="adm-cred-tile__top">
        <Icon size={20} strokeWidth={1.75} aria-hidden className="adm-cred-tile__icon" />
        <span className="adm-cred-tile__state">
          <Dot level={state.level} />
          {state.label}
        </span>
      </span>
      <span className="adm-cred-tile__name">
        <strong>{name}</strong>
        {sub && <small>{sub}</small>}
      </span>
      <span className="adm-cred-tile__purpose">{def.purpose}</span>
      <span className="adm-cred-tile__foot">
        <span
          className="adm-cred-tile__note"
          data-code={state.filter === 'external' && def.where ? '' : undefined}
        >
          {state.note}
        </span>
        <Maximize2 size={14} aria-hidden className="adm-cred-tile__open" />
      </span>
    </button>
  );
}

/** A credencial ampliada: situação em cima, o cadastro à esquerda e o passo a passo ao lado. */
function CredentialDetail({
  def,
  status,
  state,
  check,
  editor,
}: {
  def: CredDef;
  status: Status | undefined;
  state: CardState;
  check?: CheckResult;
  editor: ReactNode;
}) {
  return (
    <div className="adm-cred-detail" data-cols={editor ? 2 : 1}>
      <div className="adm-cred-detail__head">
        <p className="adm-cred-detail__purpose">{def.purpose}</p>
        <div className="adm-cred-detail__state" data-state={state.level}>
          <Dot level={state.level} />
          <strong>{state.label}</strong>
          <span>{state.note}</span>
        </div>
        {check && (
          <p
            className={`adm-cred__check adm-cred__check--${check.ok === null ? 'info' : check.ok ? 'ok' : 'bad'}`}
          >
            {check.ok === null
              ? 'Não dá para testar daqui: '
              : check.ok
                ? 'Conferida agora, funcionando: '
                : 'Conferida agora, recusada: '}
            <span>{check.detail}</span>
          </p>
        )}
        {status?.unreadable && (
          <Alert tone="danger">
            A chave salva não abre com a chave mestra atual do servidor. Cole a chave de novo.
          </Alert>
        )}
      </div>
      {editor && (
        <div className="adm-cred-detail__edit">
          <h3>{status?.configured ? 'Trocar ou testar' : 'Cadastrar'}</h3>
          {editor}
        </div>
      )}
      <div className="adm-cred-detail__guide adm-cred__how">
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
        {def.group === 'servidor' && (
          <div className="adm-cred__howto">
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
                Rode o instalador de novo: {code(INSTALL_AGAIN)}. Ele aplica o que mudou e mantém o
                resto.
              </li>
            </ol>
          </div>
        )}
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
      </div>
    </div>
  );
}
