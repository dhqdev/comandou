import { formatDocument, ROLE_LABELS, SUBSCRIPTION_LABELS } from '@comandou/shared';
import {
  BrainCircuit,
  Check,
  ChevronRight,
  CreditCard,
  Database,
  FileSignature,
  IdCard,
  Minus,
  Receipt,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { brl } from '../lib/money';
import type { AiOverview } from './AiPage';
import type { FiscalOverview } from './types';
import { useLoad } from './OverviewPages';
import { maskPhone } from './NewTenant';
import { CONTRACT_STATUS } from './TenantContracts';
import { DB_STATUS } from './TenantDatabase';
import { TenantVersionCard } from './TenantVersion';
import type { ContractRow, Plan, TeamMember, TenantDetail } from './types';
import { ago, bytes, daysUntil, Dot, Level, levelFor, Meter, Tag } from './ui';

export type OverviewTarget =
  'subscription' | 'profile' | 'contract' | 'database' | 'operation' | 'usage' | 'team';

/** Função de cada pessoa na equipe: os mesmos nomes da tela Equipe do restaurante. */
export const ROLE: Record<string, string> = ROLE_LABELS;

/** "Online" é quem mexeu no sistema nos últimos 15 minutos (o mesmo número da aba Consumo). */
export const ONLINE_MS = 15 * 60_000;
export const isOnline = (m: { lastSeenAt: string | null }, now = Date.now()) =>
  !!m.lastSeenAt && now - new Date(m.lastSeenAt).getTime() < ONLINE_MS;

const SUB_LEVEL: Record<string, Level> = {
  trialing: 'info',
  active: 'ok',
  past_due: 'warn',
  cancelled: 'off',
};

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Card({
  icon,
  title,
  onClick,
  children,
}: {
  icon: ReactNode;
  title: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const head = (
    <span className="adm-card__head">
      {icon}
      {title}
      {onClick && <ChevronRight size={16} className="adm-card__go" />}
    </span>
  );
  return onClick ? (
    <button type="button" className="adm-card" onClick={onClick}>
      {head}
      {children}
    </button>
  ) : (
    <div className="adm-card">
      {head}
      {children}
    </div>
  );
}

function Note({ level, children }: { level?: Level; children: ReactNode }) {
  return (
    <span
      className={`adm-card__note ${level === 'warn' || level === 'bad' ? `adm-card__note--${level}` : ''}`}
    >
      {children}
    </span>
  );
}

/** Uso de um recurso contra o limite do plano (null = sem limite). */
function Usage({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? (used / max) * 100 : null;
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <dl className="adm-kv">
        <dt>{label}</dt>
        <dd>
          {used.toLocaleString('pt-BR')}
          <span className="adm-ai-off">
            {' '}
            / {max === null ? 'sem limite' : max.toLocaleString('pt-BR')}
          </span>
        </dd>
      </dl>
      {pct !== null && <Meter percent={pct} />}
    </div>
  );
}

/** Serviços do plano (Super Admin › Preço): o que o restaurante tem ou não. */
const PLAN_SERVICES: {
  key: 'featureFiscal' | 'featureWhatsapp' | 'featureCustomDomain';
  label: string;
}[] = [
  { key: 'featureFiscal', label: 'Nota fiscal' },
  { key: 'featureWhatsapp', label: 'WhatsApp' },
  { key: 'featureCustomDomain', label: 'Domínio próprio' },
];

/**
 * Visão geral do restaurante (refeita na 0.267.0, pedido do David): uma faixa com os números que
 * importam (situação, pedidos, equipe, IA e notas) e os cartões de cada assunto, que levam à aba.
 * Sem o cartão de endereços nem o de limites do plano (o valor único não tem limites).
 */
export function TenantOverview({
  t,
  team,
  plans,
  go,
}: {
  t: TenantDetail;
  team: TeamMember[] | null;
  plans: Plan[];
  go: (tab: OverviewTarget) => void;
}) {
  const navigate = useNavigate();
  const contracts = useLoad<ContractRow[]>(`/platform/tenants/${t.id}/contracts`);
  const fiscal = useLoad<FiscalOverview>('/platform/fiscal');
  const ai = useLoad<AiOverview>('/platform/ai');

  const s = t.subscription;
  const plan = plans.find((p) => p.id === s?.planId) ?? null;
  const p = t.profile;

  // Assinatura: quanto tempo falta do teste ou do período pago.
  const until = s?.status === 'trialing' ? s.trialEndsAt : (s?.currentPeriodEnd ?? null);
  const left = daysUntil(until);
  const leftLevel: Level = left === null ? 'off' : left < 0 ? 'bad' : left <= 7 ? 'warn' : 'ok';
  const leftText =
    left === null
      ? s && s.status !== 'cancelled'
        ? 'sem data de vencimento registrada'
        : null
      : left < 0
        ? `venceu há ${plural(-left, 'dia', 'dias')}`
        : left === 0
          ? 'vence hoje'
          : `${s?.status === 'trialing' ? 'teste acaba' : 'vence'} em ${plural(left, 'dia', 'dias')}`;

  const lastContract = contracts.data?.[0] ?? null;
  const missing = [
    !p.legalName && 'razão social',
    !p.document && 'CPF/CNPJ',
    !p.contactName && 'responsável',
    !p.phone && 'telefone',
    !p.billingEmail && 'e-mail de cobrança',
  ].filter(Boolean) as string[];

  const fx = fiscal.data?.tenants.find((x) => x.id === t.id)?.fiscal ?? null;
  const fxCert = fiscal.data?.tenants.find((x) => x.id === t.id)?.certificateAlert ?? null;
  const aiRow = ai.data?.tenants.find((x) => x.id === t.id) ?? null;
  // Equipe com acesso (quem foi removido não conta) e quem mexeu nos últimos 15 minutos.
  const active = team?.filter((m) => m.status === 'active' && !m.disabledAt) ?? [];
  const online = active.filter((m) => isOnline(m)).length;
  const lastSeen =
    team
      ?.map((m) => m.lastSeenAt)
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null;
  const [dbLabel, dbLevel] = DB_STATUS[t.database.status] ?? [t.database.status, 'off' as Level];

  return (
    <div className="adm-ov">
      <dl className="adm-ov-kpis">
        <div>
          <dt>Assinatura</dt>
          <dd>
            {s ? (
              <span className="adm-ov-state">
                <Dot level={SUB_LEVEL[s.status] ?? 'off'} /> {SUBSCRIPTION_LABELS[s.status]}
              </span>
            ) : (
              'Sem assinatura'
            )}
          </dd>
          <small data-level={leftLevel}>{leftText ?? (plan ? brl(plan.priceMonthly) : '—')}</small>
        </div>
        <div>
          <dt>Pedidos no mês</dt>
          <dd>{t.usage.ordersMonth.toLocaleString('pt-BR')}</dd>
          <small>
            {t.usage.lastOrderAt ? `último ${ago(t.usage.lastOrderAt)}` : 'nenhum pedido ainda'}
          </small>
        </div>
        <div>
          <dt>Equipe</dt>
          <dd>{team ? active.length : '…'}</dd>
          <small>
            {online > 0
              ? `${online} online agora`
              : lastSeen
                ? `acesso ${ago(lastSeen)}`
                : 'ninguém entrou'}
          </small>
        </div>
        <div>
          <dt>IA no mês</dt>
          <dd>
            {aiRow
              ? `${(aiRow.tokens / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
              : '—'}
          </dd>
          <small>
            {aiRow
              ? aiRow.limit > 0
                ? `${aiRow.percent ?? 0}% do limite`
                : 'sem limite'
              : 'tokens'}
          </small>
        </div>
        <div>
          <dt>Notas (30 dias)</dt>
          <dd>{fx?.enabled ? fx.authorized30d.toLocaleString('pt-BR') : '—'}</dd>
          <small data-level={fx && fx.failed7d > 0 ? 'warn' : undefined}>
            {!fx?.enabled
              ? 'emissão desligada'
              : fx.failed7d > 0
                ? `${fx.failed7d} recusada(s) em 7 dias`
                : 'sem recusas'}
          </small>
        </div>
      </dl>
      <div className="adm-cards">
        <Card icon={<CreditCard size={16} />} title="Assinatura" onClick={() => go('subscription')}>
          {s ? (
            <>
              <span
                className="adm-card__big"
                style={{ display: 'flex', gap: 8, alignItems: 'center' }}
              >
                {plan?.name ?? 'Plano removido'}
                <Tag level={SUB_LEVEL[s.status]}>{SUBSCRIPTION_LABELS[s.status]}</Tag>
              </span>
              <dl className="adm-kv">
                <dt>Mensalidade</dt>
                <dd>{plan ? brl(plan.priceMonthly) : '—'}</dd>
                <dt>{s.status === 'trialing' ? 'Teste até' : 'Pago até'}</dt>
                <dd>{day(until)}</dd>
                <dt>Assinatura desde</dt>
                <dd>{day(s.startedAt)}</dd>
              </dl>
              {plan && (
                <ul className="adm-ov-services" aria-label="Serviços do plano">
                  {PLAN_SERVICES.map((x) => (
                    <li key={x.key} data-on={plan[x.key] || undefined}>
                      {plan[x.key] ? (
                        <Check size={13} aria-hidden />
                      ) : (
                        <Minus size={13} aria-hidden />
                      )}
                      {x.label}
                    </li>
                  ))}
                </ul>
              )}
              {leftText && <Note level={leftLevel}>{leftText}</Note>}
            </>
          ) : (
            <>
              <span className="adm-card__big">Sem assinatura</span>
              <Note level="warn">Nenhum limite de plano se aplica.</Note>
            </>
          )}
        </Card>

        <Card icon={<FileSignature size={16} />} title="Contrato" onClick={() => go('contract')}>
          {contracts.data === null ? (
            <Note>carregando…</Note>
          ) : lastContract ? (
            <>
              <span className="adm-card__big">{lastContract.number}</span>
              <dl className="adm-kv">
                <dt>Situação</dt>
                <dd>
                  <Dot level={CONTRACT_STATUS[lastContract.status][1]} />{' '}
                  {CONTRACT_STATUS[lastContract.status][0]}
                </dd>
                <dt>Plano</dt>
                <dd>
                  {lastContract.planName} · {brl(lastContract.priceMonthly)}
                </dd>
                <dt>Assinado</dt>
                <dd>{lastContract.signedAt ? day(lastContract.signedAt) : '—'}</dd>
              </dl>
              {contracts.data.length > 1 && (
                <Note>{plural(contracts.data.length, 'contrato', 'contratos')} no histórico</Note>
              )}
            </>
          ) : (
            <>
              <span className="adm-card__big">Nenhum contrato</span>
              <Note level="warn">Gere e envie o contrato para o cliente assinar.</Note>
            </>
          )}
        </Card>

        <Card icon={<IdCard size={16} />} title="Cadastro e contato" onClick={() => go('profile')}>
          <span className="adm-card__big">{p.legalName ?? t.name}</span>
          <dl className="adm-kv">
            <dt>CPF/CNPJ</dt>
            <dd>{p.document ? formatDocument(p.document) : '—'}</dd>
            <dt>Responsável</dt>
            <dd>{p.contactName ?? t.owners[0]?.name ?? '—'}</dd>
            <dt>Telefone</dt>
            <dd>{p.phone ? maskPhone(p.phone) : '—'}</dd>
            <dt>E-mail de cobrança</dt>
            <dd className="adm-clip" title={p.billingEmail ?? undefined}>
              {p.billingEmail ?? '—'}
            </dd>
            <dt>Cidade</dt>
            <dd>{p.city ? `${p.city}${p.state ? `/${p.state}` : ''}` : '—'}</dd>
            {/* O dono também muda estes dados (Conta › Dados do restaurante): quando foi. */}
            <dt>Atualizado</dt>
            <dd>{p.updatedAt ? ago(p.updatedAt) : '—'}</dd>
          </dl>
          {missing.length > 0 && <Note level="warn">Falta: {missing.join(', ')}</Note>}
        </Card>

        <Card icon={<ShoppingBag size={16} />} title="Operação" onClick={() => go('operation')}>
          <span className="adm-card__big">
            {plural(t.usage.ordersMonth, 'pedido', 'pedidos')} no mês
          </span>
          <dl className="adm-kv">
            <dt>Último pedido</dt>
            <dd>{t.usage.lastOrderAt ? ago(t.usage.lastOrderAt) : 'nenhum'}</dd>
            <dt>WhatsApp que falhou (7 dias)</dt>
            <dd>
              {t.usage.messageFailures ? <Dot level="warn" /> : null} {t.usage.messageFailures}
            </dd>
          </dl>
          {t.usage.messageFailures > 0 && <Note level="warn">Veja o detalhe na aba Operação.</Note>}
        </Card>

        <Card icon={<Receipt size={16} />} title="Nota fiscal" onClick={() => go('operation')}>
          {fiscal.data === null ? (
            <Note>{fiscal.error ? 'indisponível' : 'carregando…'}</Note>
          ) : !fx?.enabled ? (
            <>
              <span className="adm-card__big">Desligada</span>
              {fx && (fx.authorized30d > 0 || fx.failed7d > 0) ? (
                <>
                  <dl className="adm-kv">
                    <dt>Autorizadas (30 dias)</dt>
                    <dd>{fx.authorized30d}</dd>
                    <dt>Recusadas (7 dias)</dt>
                    <dd>{fx.failed7d}</dd>
                  </dl>
                  <Note>Emitiu notas e depois desligou a emissão.</Note>
                </>
              ) : (
                <Note>
                  {plan && !plan.featureFiscal
                    ? 'O plano não inclui nota fiscal.'
                    : 'O restaurante ainda não ligou a emissão.'}
                </Note>
              )}
            </>
          ) : (
            <>
              <span className="adm-card__big">
                {fx.environment === 'producao' ? 'Produção' : 'Homologação'}
                {fx.nfeEnabled ? ' · NFC-e e NF-e' : ' · NFC-e'}
              </span>
              <dl className="adm-kv">
                <dt>Autorizadas (30 dias)</dt>
                <dd>{fx.authorized30d}</dd>
                <dt>Recusadas (7 dias)</dt>
                <dd>{fx.failed7d}</dd>
                <dt>Certificado até</dt>
                <dd>{day(fx.certificateValidUntil)}</dd>
              </dl>
              {fxCert && (
                <Note level={fxCert === 'expired' ? 'bad' : 'warn'}>
                  {fxCert === 'expired' ? 'Certificado vencido' : 'Certificado vence em breve'}
                </Note>
              )}
            </>
          )}
        </Card>

        <Card
          icon={<BrainCircuit size={16} />}
          title="Assistente de IA"
          onClick={() => navigate('/tokens')}
        >
          {ai.data === null ? (
            <Note>{ai.error ? 'indisponível' : 'carregando…'}</Note>
          ) : !aiRow || !aiRow.enabled ? (
            <>
              <span className="adm-card__big">Desligado</span>
              <Note>O restaurante não usa o assistente.</Note>
            </>
          ) : (
            <>
              <span className="adm-card__big">
                {aiRow.tokens.toLocaleString('pt-BR')}{' '}
                <small className="adm-ai-off">tokens no mês</small>
              </span>
              <Usage label="Limite do mês" used={aiRow.tokens} max={aiRow.limit || null} />
              <Note level={levelFor(aiRow.percent, 80, 100)}>
                {plural(aiRow.calls, 'resposta da IA', 'respostas da IA')} no mês · último uso{' '}
                {ago(aiRow.lastAt)}
              </Note>
            </>
          )}
        </Card>

        <Card icon={<Database size={16} />} title="Banco de dados" onClick={() => go('database')}>
          <span className="adm-card__big">
            {t.database.kind === 'dedicated' ? 'Banco próprio' : 'Banco central'}
          </span>
          <dl className="adm-kv">
            <dt>Situação</dt>
            <dd>
              <Dot level={dbLevel} /> {dbLabel}
            </dd>
            <dt>Tamanho</dt>
            <dd>{t.database.sizeBytes === null ? '—' : bytes(t.database.sizeBytes)}</dd>
            <dt>Último backup</dt>
            <dd>
              {t.database.lastBackup
                ? `${ago(t.database.lastBackup.finishedAt ?? t.database.lastBackup.startedAt)}${t.database.lastBackup.status === 'failed' ? ' (falhou)' : ''}`
                : 'nenhum'}
            </dd>
          </dl>
        </Card>

        <TenantVersionCard tenantId={t.id} />

        <Card icon={<Users size={16} />} title="Equipe e acesso" onClick={() => go('team')}>
          <span className="adm-card__big">
            {team ? plural(active.length, 'pessoa', 'pessoas') : '…'}
            {online > 0 && <small className="adm-ai-off"> · {online} online agora</small>}
          </span>
          <dl className="adm-kv">
            <dt>{t.owners.length > 1 ? 'Donos' : 'Dono'}</dt>
            <dd className="adm-clip">{t.owners.map((o) => o.name).join(', ') || '—'}</dd>
            {t.owners.length > 0 && (
              <>
                <dt>E-mail de entrada</dt>
                <dd className="adm-clip" title={t.owners.map((o) => o.email).join(', ')}>
                  {t.owners.map((o) => o.email).join(', ')}
                </dd>
              </>
            )}
            <dt>Último acesso</dt>
            <dd>{lastSeen ? `${ago(lastSeen)}` : 'ninguém entrou ainda'}</dd>
            {team && team.length > active.length && (
              <>
                <dt>Sem acesso</dt>
                <dd>{team.length - active.length}</dd>
              </>
            )}
          </dl>
        </Card>
      </div>
    </div>
  );
}
