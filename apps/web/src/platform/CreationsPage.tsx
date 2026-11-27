import { ExternalLink, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Badge, EmptyState, Segmented, Skeleton, TextField } from '../design-system';
import { dateTime } from '../features/format';
import { SidePanel } from '../features/SidePanel';
import { useLoad } from './OverviewPages';
import { CreationPanel } from './TenantCreation';
import { PageHead, Section, Tile } from './ui';

/**
 * Super Admin › Criações (0.279, pedido do David: "deixe em algum lugar, de quando criar o
 * restaurante pelo site, o tanto de IA que usou e como foi o processo; crie uma nova aba no super
 * admin para esse controle"). Cada criação pelo site: o que a pessoa mandou, o que a IA montou,
 * quanto custou, se virou restaurante, o CNPJ/CPF e o contrato. Tocar abre o passo a passo.
 */
interface Trial {
  tenantId: string;
  slug: string;
  name: string;
  status: string;
  email: string;
  contactName: string;
  phone: string | null;
  sourceKind: string;
  sourceValue: string;
  createdAt: string;
  session: string | null;
  subscription: string | null;
  document: string | null;
  legalName: string | null;
  contractId: string | null;
  contractStatus: string | null;
  contractNumber: string | null;
  contractSignedAt: string | null;
  contractError: string | null;
  items: number | null;
  aiTokens: number;
  aiCostUsd: number;
  aiCalls: number;
}
interface Draft {
  session: string;
  firstAt: string;
  lastAt: string;
  drafts: number;
  items: number;
  sourceKind: string;
  sourceValue: string;
  storeName: string | null;
  document: string | null;
  failed: boolean;
  aiTokens: number;
  aiCostUsd: number;
}
interface Overview {
  month: { started: number; created: number; signed: number; costUsd: number };
  trials: Trial[];
  drafts: Draft[];
}
interface SessionDetail {
  generations: {
    id: string;
    sourceKind: string;
    sourceValue: string;
    status: string;
    error: string | null;
    items: number;
    model: string;
    tokens: number;
    costUsd: number;
    createdAt: string;
    store: { name?: string | null; address?: string | null; city?: string | null } | null;
    legal: { document?: string | null; legalName?: string | null } | null;
    files: string[] | null;
  }[];
  calls: {
    id: string;
    step: string | null;
    model: string;
    tokens: number;
    costUsd: number;
    ref: string | null;
    createdAt: string;
  }[];
}

type Row = { kind: 'trial'; at: string; t: Trial } | { kind: 'draft'; at: string; d: Draft };
type Filter = 'all' | 'created' | 'left' | 'pending' | 'signed';

const SOURCE: Record<string, string> = {
  compose: 'Campo único',
  site: 'Site',
  maps: 'Google Maps',
  text: 'Itens escritos',
  menu: 'Cardápio enviado',
  none: 'Sem cardápio',
};
const CONTRACT: Record<string, [string, 'neutral' | 'warning' | 'success' | 'danger' | 'info']> = {
  draft: ['Contrato gerado', 'neutral'],
  sent: ['Esperando o cliente', 'warning'],
  client_signed: ['Cliente assinou: falta você', 'info'],
  signed: ['Assinado', 'success'],
  cancelled: ['Cancelado', 'danger'],
};
const FILE_LABEL: Record<string, string> = {
  logo: 'logo',
  menu: 'cardápio',
  cover: 'capa',
  document: 'documento',
  other: 'arquivo',
};
const STEP_LABEL: Record<string, string> = {
  conversa: 'Ler o texto e os links',
  anexo: 'Ler foto ou PDF',
  site: 'Montar o site',
  cardapio: 'Ler o cardápio enviado',
  estoque: 'Sugerir o estoque',
};

const usd = (n: number) =>
  `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const compact = (n: number) =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const doc = (d: string | null) =>
  !d
    ? null
    : d.length === 14
      ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
      : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function CreationsPage() {
  const { data, error } = useLoad<Overview>('/platform/site/creations');
  const [filter, setFilter] = useState<Filter>('all');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<Row | null>(null);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const all: Row[] = [
      ...data.trials.map((t) => ({ kind: 'trial' as const, at: t.createdAt, t })),
      ...data.drafts.map((d) => ({ kind: 'draft' as const, at: d.lastAt, d })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    const q = fold(term.trim());
    return all.filter((r) => {
      if (filter === 'created' && r.kind !== 'trial') return false;
      if (filter === 'left' && r.kind !== 'draft') return false;
      if (
        filter === 'pending' &&
        !(
          r.kind === 'trial' &&
          r.t.contractStatus &&
          ['draft', 'sent', 'client_signed'].includes(r.t.contractStatus)
        )
      )
        return false;
      if (
        filter === 'signed' &&
        !(
          r.kind === 'trial' &&
          (r.t.contractStatus === 'signed' || r.t.contractStatus === 'client_signed')
        )
      )
        return false;
      if (!q) return true;
      const hay =
        r.kind === 'trial'
          ? `${r.t.name} ${r.t.email} ${r.t.slug} ${r.t.document ?? ''} ${r.t.sourceValue}`
          : `${r.d.storeName ?? ''} ${r.d.sourceValue} ${r.d.document ?? ''}`;
      return fold(hay).includes(q);
    });
  }, [data, filter, term]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  const m = data?.month;
  const conv = m && m.started > 0 ? Math.round((m.created / m.started) * 100) : null;
  return (
    <>
      <PageHead
        page
        title="Criações pelo site"
        sub="Cada restaurante que começou a ser criado no comandou.com: o que a pessoa mandou, o que a IA montou, quanto custou e o contrato."
      />
      {!data ? (
        <Skeleton variant="cards" />
      ) : (
        <>
          <div className="adm-grid">
            <Tile
              label="Começaram neste mês"
              value={m!.started}
              sub="visitas que mandaram algo para a IA"
            />
            <Tile
              label="Viraram restaurante"
              value={m!.created}
              sub={conv === null ? 'neste mês' : `${conv}% das que começaram`}
            />
            <Tile label="Contratos assinados" value={m!.signed} sub="pelo cliente, neste mês" />
            <Tile
              label="IA da criação no mês"
              value={usd(m!.costUsd)}
              sub={
                m!.created
                  ? `${usd(m!.costUsd / m!.created)} por restaurante criado`
                  : 'chave do sistema'
              }
            />
          </div>
          <Section title="Criações" sub={`${rows.length} na lista`}>
            <div className="adm-creations__tools">
              <Segmented<Filter>
                label="Mostrar"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'Todas' },
                  { value: 'created', label: 'Viraram restaurante' },
                  { value: 'left', label: 'Não terminaram' },
                  { value: 'pending', label: 'Contrato pendente' },
                  { value: 'signed', label: 'Assinados' },
                ]}
              />
              <TextField
                label="Pesquisar"
                wrapClass="adm-creations__search"
                aria-label="Pesquisar por nome, e-mail, CNPJ ou o que a pessoa mandou"
                leading={<Search size={16} />}
                placeholder="Pesquisar"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </div>
            {rows.length === 0 ? (
              <EmptyState title="Nenhuma criação com esse filtro" />
            ) : (
              <ul className="adm-creations">
                {rows.map((r) =>
                  r.kind === 'trial' ? (
                    <li key={`t-${r.t.tenantId}`}>
                      <button type="button" className="adm-creation" onClick={() => setOpen(r)}>
                        <span className="adm-creation__dot" data-tone="on" aria-hidden />
                        <span className="adm-creation__main">
                          <strong>{r.t.name}</strong>
                          <span className="adm-creation__meta">
                            {r.t.email} · {SOURCE[r.t.sourceKind] ?? r.t.sourceKind}
                            {r.t.items ? ` · ${r.t.items} itens` : ''}
                            {r.t.document
                              ? ` · ${r.t.document.length === 14 ? 'CNPJ' : 'CPF'} ${doc(r.t.document)}`
                              : ' · sem CNPJ/CPF'}
                          </span>
                        </span>
                        <span className="adm-creation__side">
                          {r.t.contractStatus ? (
                            <Badge tone={CONTRACT[r.t.contractStatus]?.[1] ?? 'neutral'}>
                              {CONTRACT[r.t.contractStatus]?.[0] ?? r.t.contractStatus}
                            </Badge>
                          ) : (
                            <Badge tone="neutral">
                              {r.t.contractError ? 'Contrato com erro' : 'Sem contrato'}
                            </Badge>
                          )}
                          <span className="adm-creation__cost">{usd(r.t.aiCostUsd)}</span>
                          <span className="adm-creation__at">{dateTime(r.t.createdAt)}</span>
                        </span>
                      </button>
                    </li>
                  ) : (
                    <li key={`d-${r.d.session}`}>
                      <button type="button" className="adm-creation" onClick={() => setOpen(r)}>
                        <span
                          className="adm-creation__dot"
                          data-tone={r.d.failed ? 'bad' : 'off'}
                          aria-hidden
                        />
                        <span className="adm-creation__main">
                          <strong>{r.d.storeName ?? 'Sem nome ainda'}</strong>
                          <span className="adm-creation__meta">
                            {SOURCE[r.d.sourceKind] ?? r.d.sourceKind} · “
                            {r.d.sourceValue.slice(0, 80)}”
                            {r.d.items ? ` · ${r.d.items} itens` : ''}
                          </span>
                        </span>
                        <span className="adm-creation__side">
                          <Badge tone={r.d.failed ? 'danger' : 'neutral'}>
                            {r.d.failed ? 'IA falhou' : 'Não terminou'}
                          </Badge>
                          <span className="adm-creation__cost">{usd(r.d.aiCostUsd)}</span>
                          <span className="adm-creation__at">{dateTime(r.d.lastAt)}</span>
                        </span>
                      </button>
                    </li>
                  ),
                )}
              </ul>
            )}
          </Section>
        </>
      )}
      <SidePanel
        open={!!open}
        size="xl"
        title={open?.kind === 'trial' ? open.t.name : (open?.d.storeName ?? 'Criação')}
        onClose={() => setOpen(null)}
      >
        {open?.kind === 'trial' && <TrialDetail t={open.t} />}
        {open?.kind === 'draft' && <DraftDetail session={open.d.session} />}
      </SidePanel>
    </>
  );
}

function TrialDetail({ t }: { t: Trial }) {
  const c = t.contractStatus ? CONTRACT[t.contractStatus] : null;
  return (
    <div className="adm-stack">
      <dl className="adm-creation__facts">
        <div>
          <dt>Restaurante</dt>
          <dd>
            <Link to={`/restaurantes/${t.tenantId}`}>
              {t.name} <ExternalLink size={13} aria-hidden />
            </Link>{' '}
            <span className="adm-sub">{t.slug}</span>
          </dd>
        </div>
        <div>
          <dt>Quem criou</dt>
          <dd>
            {t.contactName} · {t.email}
            {t.phone ? ` · ${t.phone}` : ''}
          </dd>
        </div>
        <div>
          <dt>CNPJ/CPF</dt>
          <dd>
            {doc(t.document) ?? 'não informado'}
            {t.legalName ? ` · ${t.legalName}` : ''}
          </dd>
        </div>
        <div>
          <dt>Contrato</dt>
          <dd>
            {c ? (
              <>
                <Badge tone={c[1]}>{c[0]}</Badge> {t.contractNumber}
                {t.contractSignedAt ? ` · assinado em ${dateTime(t.contractSignedAt)}` : ''}{' '}
                <Link to={`/restaurantes/${t.tenantId}?aba=contrato`}>Abrir contrato</Link>
              </>
            ) : t.contractError ? (
              <span className="adm-creation__err">{t.contractError}</span>
            ) : (
              'ainda não gerado (sai quando o restaurante fica pronto e tem CNPJ/CPF)'
            )}
          </dd>
        </div>
        <div>
          <dt>O que mandou</dt>
          <dd className="adm-creation__quote">
            {SOURCE[t.sourceKind] ?? t.sourceKind}
            {t.sourceValue ? `: “${t.sourceValue}”` : ''}
          </dd>
        </div>
      </dl>
      <CreationPanel id={t.tenantId} />
    </div>
  );
}

function DraftDetail({ session }: { session: string }) {
  const { data, error } = useLoad<SessionDetail>(`/platform/site/creations/session/${session}`);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <Skeleton variant="detail" />;
  const total = data.calls.reduce(
    (a, c) => ({ tokens: a.tokens + c.tokens, cost: a.cost + c.costUsd }),
    { tokens: 0, cost: 0 },
  );
  const last = data.generations[data.generations.length - 1];
  return (
    <div className="adm-stack">
      <div className="adm-grid">
        <Tile
          label="Gasto da IA"
          value={usd(total.cost)}
          sub={`${compact(total.tokens)} tokens · ${data.calls.length} chamada(s)`}
        />
        <Tile
          label="Itens montados"
          value={last?.items ?? 0}
          sub={last?.store?.name ?? 'sem nome'}
        />
        <Tile
          label="CNPJ/CPF"
          value={doc(last?.legal?.document ?? null) ?? '—'}
          sub={
            last?.legal?.legalName ?? (last?.store?.address ? last.store.address : 'sem endereço')
          }
        />
      </div>
      <div className="adm-panel">
        <div className="adm-panel__head">Passo a passo</div>
        <ol className="adm-timeline">
          {data.calls.map((c) => (
            <li key={c.id}>
              <span className="adm-timeline__at">{dateTime(c.createdAt)}</span>
              <span>
                <strong>{STEP_LABEL[c.step ?? ''] ?? c.step ?? 'IA'}</strong>
                {c.ref ? ` · ${c.ref}` : ''}
                <span className="adm-sub">
                  {' '}
                  {c.model} · {compact(c.tokens)} tokens · {usd(c.costUsd)}
                </span>
              </span>
            </li>
          ))}
          {data.generations
            .filter((g) => g.status === 'failed')
            .map((g) => (
              <li key={g.id} className="adm-timeline__bad">
                <span className="adm-timeline__at">{dateTime(g.createdAt)}</span>
                <span>
                  <strong>Falhou</strong> · {g.error ?? 'sem detalhe'}
                </span>
              </li>
            ))}
        </ol>
        {last?.files?.length ? (
          <p className="adm-sub" style={{ padding: '0 16px 14px' }}>
            Arquivos lidos: {last.files.map((f) => FILE_LABEL[f] ?? f).join(', ')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
