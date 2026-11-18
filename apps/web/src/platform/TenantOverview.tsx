import { SUBSCRIPTION_LABELS } from '@comandou/shared';
import {
  BrainCircuit,
  ChevronRight,
  CreditCard,
  Database,
  FileSignature,
  Gauge,
  IdCard,
  Receipt,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { dateTime } from '../features/format';
import { brl } from '../lib/money';
import type { AiOverview } from './AiPage';
import type { FiscalOverview } from './types';
import { useLoad } from './OverviewPages';
import { CONTRACT_STATUS } from './TenantContracts';
import { DB_STATUS } from './TenantDatabase';
import { TenantVersionCard } from './TenantVersion';
import type { ContractRow, Plan, TeamMember, TenantDetail } from './types';
import { ago, bytes, daysUntil, Dot, Level, levelFor, Meter, Tag } from './ui';

export type OverviewTarget =
  'subscription' | 'profile' | 'contract' | 'database' | 'operation' | 'usage' | 'team';

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

/**
 * Visão geral do restaurante: tudo do cliente numa tela (assinatura, uso do plano, contrato,
 * cadastro, operação, nota fiscal, IA, banco, equipe e domínios). Cada cartão leva à aba.
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
  const online = team?.filter((m) => m.activeSessions > 0).length ?? 0;
  const failures = t.usage.fiscalErrors + t.usage.messageFailures;
  const [dbLabel, dbLevel] = DB_STATUS[t.database.status] ?? [t.database.status, 'off' as Level];

  return (
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
              <dt>Cliente desde</dt>
              <dd>{day(s.startedAt)}</dd>
            </dl>
            {leftText && <Note level={leftLevel}>{leftText}</Note>}
          </>
        ) : (
          <>
            <span className="adm-card__big">Sem assinatura</span>
            <Note level="warn">Nenhum limite de plano se aplica.</Note>
          </>
        )}
      </Card>

      <Card icon={<Gauge size={16} />} title="Uso do plano" onClick={() => go('subscription')}>
        <Usage label="Equipe ativa" used={t.usage.users} max={plan?.maxUsers ?? null} />
        <Usage label="Produtos" used={t.usage.products} max={plan?.maxProducts ?? null} />
        <Usage
          label="Pedidos no mês"
          used={t.usage.ordersMonth}
          max={plan?.maxOrdersMonth ?? null}
        />
        {plan && (
          <Note>
            {[
              plan.featureFiscal ? 'nota fiscal' : null,
              plan.featureWhatsapp ? 'WhatsApp' : null,
              plan.featureCustomDomain ? 'domínio próprio' : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'sem recursos extras'}
          </Note>
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
          <dd>{p.document ?? '—'}</dd>
          <dt>Responsável</dt>
          <dd>{p.contactName ?? t.owners[0]?.name ?? '—'}</dd>
          <dt>Telefone</dt>
          <dd>{p.phone ?? '—'}</dd>
          <dt>Cobrança</dt>
          <dd>{p.billingEmail ?? '—'}</dd>
          <dt>Cidade</dt>
          <dd>{p.city ? `${p.city}${p.state ? `/${p.state}` : ''}` : '—'}</dd>
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
          <dt>Produtos ativos</dt>
          <dd>{t.usage.products}</dd>
          <dt>Falhas em 7 dias</dt>
          <dd>
            {failures ? (
              <>
                <Dot level="warn" /> {t.usage.fiscalErrors} nota · {t.usage.messageFailures}{' '}
                WhatsApp
              </>
            ) : (
              'nenhuma'
            )}
          </dd>
        </dl>
      </Card>

      <Card icon={<Receipt size={16} />} title="Nota fiscal">
        {fiscal.data === null ? (
          <Note>carregando…</Note>
        ) : !fx?.enabled ? (
          <>
            <span className="adm-card__big">Desligada</span>
            <Note>
              {plan && !plan.featureFiscal
                ? 'O plano não inclui nota fiscal.'
                : 'O restaurante ainda não ativou a emissão.'}
            </Note>
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
              <dt>Recusas (7 dias)</dt>
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
              {aiRow.calls} conversa(s) · último uso {ago(aiRow.lastAt)}
            </Note>
          </>
        )}
      </Card>

      <Card icon={<Database size={16} />} title="Banco e dados" onClick={() => go('database')}>
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
          {team ? plural(team.length, 'pessoa', 'pessoas') : '…'}
          {online > 0 && <small className="adm-ai-off"> · {online} online</small>}
        </span>
        <dl className="adm-kv">
          <dt>Dono</dt>
          <dd>{t.owners.map((o) => o.email).join(', ') || '—'}</dd>
          <dt>Criado em</dt>
          <dd>{dateTime(t.createdAt)}</dd>
        </dl>
      </Card>
    </div>
  );
}
