import { SUBSCRIPTION_LABELS } from '@comandou/shared';
import { useState } from 'react';
import { Alert, Button, Modal, Spinner } from '../design-system';
import { dateTime } from '../features/format';
import { brl } from '../lib/money';
import { useLoad } from './OverviewPages';
import type { AuditRow, Plan } from './types';
import { Dot, Level } from './ui';

/**
 * Registro de tudo o que muda no painel (tabela platform_audit_log). Não tem mais tela própria no
 * menu: o que é de um restaurante aparece na aba Histórico dele; o que é do painel (entradas,
 * configurações, servidor) fica em Conta › Registro do painel.
 */

type Group = 'assinatura' | 'contrato' | 'acesso' | 'cadastro' | 'sistema' | 'ia' | 'painel';

export const GROUP_LABELS: Record<Group, string> = {
  assinatura: 'Assinatura e cobrança',
  contrato: 'Contrato',
  acesso: 'Acesso e equipe',
  cadastro: 'Cadastro',
  sistema: 'Banco e versão',
  ia: 'IA',
  painel: 'Painel',
};

/** Nome de cada ação em português e o grupo dela (para o filtro do Histórico). */
export const ACTIONS: Record<string, [string, Group]> = {
  // Painel (sem restaurante)
  'platform.login': ['Entrou no painel', 'painel'],
  'platform.login_failed': ['Tentativa de entrar recusada', 'painel'],
  'platform.logout': ['Saiu do painel', 'painel'],
  'platform.admin_created': ['Administrador criado', 'painel'],
  'platform.admin_reset': ['Acesso do administrador refeito', 'painel'],
  'platform.password_reset_requested': ['Pediu código para trocar a senha', 'painel'],
  'platform.password_reset': ['Trocou a senha do painel', 'painel'],
  'platform.plan_created': ['Plano criado', 'painel'],
  'platform.plan_updated': ['Preço ou plano alterado', 'painel'],
  'platform.quote_created': ['Orçamento gerado', 'painel'],
  'platform.quote_settings_saved': ['Valores padrão do orçamento salvos', 'painel'],
  'platform.contract_settings_saved': ['Modelo e dados do contrato salvos', 'painel'],
  'platform.billing_settings_updated': ['Regras de cobrança alteradas', 'painel'],
  'platform.billing_tested': ['Testou a conexão com o Asaas', 'painel'],
  'platform.billing_webhook_registered': ['Aviso do Asaas cadastrado', 'painel'],
  'platform.billing_webhook_token_viewed': ['Viu o token do aviso do Asaas', 'painel'],
  'platform.online_pay.settings_updated': ['Pagamentos pelo app: ajustes salvos', 'painel'],
  'platform.online_pay.application_created': ['Aplicativo do PagBank criado', 'painel'],
  'platform.ai_settings_updated': ['Ajustes do assistente de IA salvos', 'painel'],
  'platform.channel_homologation': ['Homologação de aplicativo: passo atualizado', 'painel'],
  'platform.backup_settings_updated': ['Ajustes do backup salvos', 'painel'],
  'platform.backup_requested': ['Pediu um backup agora', 'painel'],
  'platform.restore_test_requested': ['Pediu um teste de restauração', 'painel'],
  'platform.db_server.created': ['Servidor de banco cadastrado', 'painel'],
  'platform.db_server.updated': ['Servidor de banco alterado', 'painel'],
  'platform.db_server.removed': ['Servidor de banco removido', 'painel'],
  'platform.stack.created': ['Stack de destino cadastrada', 'painel'],
  'platform.stack.updated': ['Stack de destino alterada', 'painel'],
  'platform.stack.removed': ['Stack de destino removida', 'painel'],
  'platform.receiver.enabled': ['Ligou o recebimento de restaurantes', 'painel'],
  'platform.receiver.disabled': ['Desligou o recebimento de restaurantes', 'painel'],
  'platform.reception.opened': ['Abriu um recebimento de restaurante', 'painel'],
  'platform.pipeline_settings_updated': ['Ajustes da esteira de chamados salvos', 'painel'],
  'platform.ticket_created': ['Chamado criado', 'painel'],
  'platform.ticket_approved': ['Chamado aprovado', 'painel'],
  'platform.ticket_rejected': ['Chamado recusado', 'painel'],
  'platform.ticket_cancelled': ['Chamado cancelado', 'painel'],
  'platform.tenant_version.held': ['Versão nova segurada para os restaurantes', 'painel'],
  'platform.server.cleanup': ['Limpeza no servidor', 'painel'],
  'platform.server.service_restarted': ['Reiniciou um serviço', 'painel'],
  'platform.server.logs_viewed': ['Viu os logs de um serviço', 'painel'],
  'platform.server.component_updated': ['Atualizou um componente do servidor', 'painel'],
  'platform.server.system_update_started': ['Atualizou o sistema', 'painel'],
  'credentials.save': ['Credencial salva', 'painel'],
  'credentials.remove': ['Credencial removida', 'painel'],
  'mail.settings_saved': ['Ajustes de e-mail salvos', 'painel'],
  'mail.test_sent': ['E-mail de teste enviado', 'painel'],
  'mail.lifecycle_set': ['Aviso automático de e-mail alterado', 'painel'],
  'mail.sample_sent': ['Modelo de e-mail enviado de exemplo', 'painel'],
  'site.settings_saved': ['Ajustes do cadastro pelo site salvos', 'painel'],
  'site_ai.settings_saved': ['Ajustes do site com IA salvos', 'painel'],
  // Assinatura e cobrança
  'platform.subscription_changed': ['Assinatura alterada', 'assinatura'],
  'platform.billing_mode_changed': ['Forma de cobrança alterada', 'assinatura'],
  'platform.billing_charge_now': ['Gerou a cobrança agora', 'assinatura'],
  'platform.billing_invoice_created': ['Fatura avulsa criada', 'assinatura'],
  'platform.billing_invoice_cancelled': ['Fatura cancelada', 'assinatura'],
  'platform.billing_invoice_synced': ['Fatura conferida no Asaas', 'assinatura'],
  'platform.billing_paid': ['Fatura paga', 'assinatura'],
  'platform.billing_paid_undone': ['Pagamento desfeito', 'assinatura'],
  'platform.billing_payment_reverted': ['Pagamento estornado no Asaas', 'assinatura'],
  'platform.billing_blocked': ['Bloqueado por falta de pagamento', 'assinatura'],
  'platform.billing_unblocked': ['Desbloqueado', 'assinatura'],
  'platform.online_pay.tenant_fee': ['Taxa própria dos pagamentos pelo app', 'assinatura'],
  'tenant.plan_upgraded': ['Restaurante mudou para um plano maior', 'assinatura'],
  'tenant.plan_downgraded': ['Restaurante mudou para um plano menor', 'assinatura'],
  'tenant.plan_downgrade_scheduled': ['Restaurante agendou um plano menor', 'assinatura'],
  'tenant.plan_downgrade_cancelled': ['Restaurante desistiu do plano menor', 'assinatura'],
  'tenant.billing_pay_method': ['Restaurante trocou a forma de pagar', 'assinatura'],
  'tenant.billing_card_saved': ['Restaurante cadastrou cartão', 'assinatura'],
  'tenant.billing_card_removed': ['Restaurante removeu o cartão', 'assinatura'],
  // Contrato
  'platform.contract_created': ['Contrato gerado', 'contrato'],
  'platform.contract_link': ['Link de assinatura gerado', 'contrato'],
  'platform.contract_sent': ['Contrato enviado', 'contrato'],
  'platform.contract_renotified': ['Aviso do contrato reenviado', 'contrato'],
  'platform.contract_signed': ['Cliente assinou o contrato', 'contrato'],
  'platform.contract_countersigned': ['Comandou assinou o contrato', 'contrato'],
  'platform.contract_countersign_denied': ['Assinatura da Comandou recusada', 'contrato'],
  'platform.contract_cancelled': ['Contrato cancelado', 'contrato'],
  // Acesso e equipe
  'platform.tenant.support_access': ['Abriu o sistema do restaurante', 'acesso'],
  'platform.tenant.sessions_revoked': ['Encerrou sessões', 'acesso'],
  'platform.tenant.cache_cleared': ['Limpou o cache', 'sistema'],
  'platform.user.password_reset': ['Redefiniu a senha de alguém', 'acesso'],
  'platform.tenant.suspended': ['Restaurante suspenso', 'acesso'],
  'platform.tenant.reactivated': ['Restaurante reativado', 'acesso'],
  // Cadastro
  'platform.tenant_created': ['Restaurante criado', 'cadastro'],
  'platform.tenant_provision_failed': ['Falha ao criar o restaurante', 'cadastro'],
  'platform.demo_created': ['Restaurante de demonstração criado', 'cadastro'],
  'site.trial_created': ['Teste grátis criado pelo site', 'cadastro'],
  'platform.tenant.renamed': ['Restaurante renomeado', 'cadastro'],
  'platform.tenant.profile_updated': ['Cadastro e contato alterados', 'cadastro'],
  'tenant.profile_updated': ['Dados do restaurante alterados pelo dono', 'cadastro'],
  'tenant.owner_updated': ['Dono alterou os próprios dados', 'cadastro'],
  'platform.domain_removed': ['Domínio próprio removido', 'cadastro'],
  'platform.tenant.kitchen_created': ['Cozinha criada', 'cadastro'],
  'platform.tenant.kitchen_updated': ['Cozinha alterada', 'cadastro'],
  'platform.tenant.kitchen_display': ['Tela da cozinha alterada', 'cadastro'],
  // Banco e versão
  'platform.tenant_database.retry': ['Tentou criar o banco de novo', 'sistema'],
  'platform.tenant_database.move_requested': ['Pediu banco próprio', 'sistema'],
  'platform.tenant_database.transfer_requested': ['Pediu troca de servidor do banco', 'sistema'],
  'platform.tenant.delete_requested': ['Pediu para excluir o restaurante', 'sistema'],
  'platform.tenant.delete_denied': ['Exclusão recusada', 'sistema'],
  'platform.tenant.deleted': ['Restaurante excluído', 'sistema'],
  'platform.tenant.migration_requested': ['Pediu migração para outro servidor', 'sistema'],
  'platform.tenant.migration_cancelled': ['Migração cancelada', 'sistema'],
  'platform.tenant.migrated': ['Migrado para outro servidor', 'sistema'],
  'platform.tenant.copied': ['Copiado para outro servidor', 'sistema'],
  'platform.tenant.received': ['Recebido de outro servidor', 'sistema'],
  'platform.tenant_version.upgrade': ['Versão do sistema atualizada', 'sistema'],
  'platform.tenant_version.scheduled': ['Atualização de versão agendada', 'sistema'],
  'platform.tenant_version.unscheduled': ['Agendamento de versão cancelado', 'sistema'],
  // IA
  'platform.ai_tenant_updated': ['Assistente de IA do restaurante alterado', 'ia'],
  'platform.ai_tokens_granted': ['Tokens de IA doados', 'ia'],
  'platform.ai_tokens_removed': ['Tokens de IA retirados', 'ia'],
};

const FAIL = new Set([
  'platform.login_failed',
  'platform.tenant_provision_failed',
  'platform.contract_countersign_denied',
  'platform.tenant.delete_denied',
  'platform.billing_blocked',
  'platform.billing_payment_reverted',
]);
const STRONG = new Set([
  'platform.tenant.suspended',
  'platform.user.password_reset',
  'platform.tenant.support_access',
  'platform.tenant.sessions_revoked',
  'platform.tenant.delete_requested',
  'platform.tenant.deleted',
  'platform.contract_cancelled',
  'platform.billing_paid_undone',
  'platform.server.cleanup',
  'platform.server.service_restarted',
  'credentials.save',
  'credentials.remove',
]);

/** "platform.server.vm_reboot" e outras ações montadas na hora caem num nome genérico. */
export function actionLabel(action: string) {
  const known = ACTIONS[action]?.[0];
  if (known) return known;
  if (action.startsWith('platform.server.vm_'))
    return `Ação na VM (${action.slice('platform.server.vm_'.length).replace(/_/g, ' ')})`;
  return action;
}
const groupOf = (action: string): Group => ACTIONS[action]?.[1] ?? 'painel';

const PROFILE_FIELDS: Record<string, string> = {
  name: 'nome',
  email: 'e-mail de entrada',
  legalName: 'razão social',
  document: 'CPF/CNPJ',
  contactName: 'responsável',
  phone: 'telefone',
  billingEmail: 'e-mail de cobrança',
  zip: 'CEP',
  city: 'cidade',
  state: 'UF',
  address: 'endereço',
};
const BILLING_TYPE: Record<string, string> = {
  PIX: 'Pix',
  BOLETO: 'boleto',
  CREDIT_CARD: 'cartão',
  pix: 'Pix',
  boleto: 'boleto',
  card: 'cartão',
};
/** Rótulo dos campos comuns; o resto (ids, hashes, objetos) não aparece. */
const KEY_LABELS: Record<string, string> = {
  reason: 'Motivo',
  email: 'E-mail',
  adminEmail: 'Dono',
  name: 'Nome',
  slug: 'Endereço',
  number: 'Contrato',
  to: 'Para',
  from: 'De',
  planName: 'Plano',
  planCode: 'Plano',
  service: 'Serviço',
  hostname: 'Domínio',
  database: 'Banco',
  stack: 'Stack',
  version: 'Versão',
  note: 'Observação',
  kind: 'Tipo',
  mode: 'Modo',
  status: 'Situação',
  description: 'Descrição',
  dueDate: 'Vencimento',
  signer: 'Assinou',
  error: 'Erro',
  count: 'Quantidade',
  id: '',
};
const HIDDEN = /(^id$|Id$|hash|Sha256|token|secret|password|^ip$|^c$|^b$|^by$)/i;

const day = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Data e hora; o ano só aparece quando não é o deste ano. */
const when = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });
};

function generic(data: Record<string, unknown>) {
  return Object.entries(data)
    .filter(([k, v]) => v !== null && v !== '' && typeof v !== 'object' && !HIDDEN.test(k))
    .filter(([k]) => KEY_LABELS[k] !== '')
    .map(([k, v]) => {
      const text = typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v);
      return KEY_LABELS[k] ? `${KEY_LABELS[k]}: ${text}` : `${k}: ${text}`;
    })
    .join(' · ');
}

/** O que aconteceu, em uma linha, a partir dos dados gravados com a ação. */
export function describe(a: AuditRow, plans: Plan[] = []): string {
  const d = (a.data ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null);
  const planName = (id: unknown) =>
    typeof id === 'string' ? (plans.find((p) => p.id === id)?.name ?? 'outro plano') : null;
  switch (a.action) {
    case 'platform.subscription_changed': {
      const side = (s: unknown) => {
        if (!s || typeof s !== 'object') return 'sem assinatura';
        const x = s as { planId?: string | null; status?: string };
        const st = SUBSCRIPTION_LABELS[x.status as keyof typeof SUBSCRIPTION_LABELS] ?? x.status;
        return [planName(x.planId), st].filter(Boolean).join(' · ');
      };
      const notes = str('notes');
      return `${side(d.from)} → ${side(d.to)}${notes ? ` · ${notes}` : ''}`;
    }
    case 'platform.tenant.support_access':
      return str('as') ? `Entrou como ${str('as')}` : '';
    case 'platform.user.password_reset':
      return typeof d.sessionsRevoked === 'number'
        ? `${plural(d.sessionsRevoked, 'sessão encerrada', 'sessões encerradas')}`
        : '';
    case 'platform.tenant.cache_cleared':
      return typeof d.screens === 'number'
        ? plural(d.screens, 'tela aberta recarregada', 'telas abertas recarregadas')
        : '';
    case 'platform.tenant.sessions_revoked':
      return typeof d.count === 'number'
        ? plural(d.count, 'sessão encerrada', 'sessões encerradas')
        : '';
    case 'platform.channel_homologation':
      return `${str('title') ?? str('step') ?? ''}${d.done === true ? ' · feito' : d.done === false ? ' · a fazer' : ''}`;
    case 'platform.tenant.renamed':
      return `${str('from') ?? '?'} → ${str('to') ?? '?'}`;
    case 'tenant.plan_upgraded':
    case 'tenant.plan_downgraded':
    case 'tenant.plan_downgrade_scheduled':
      return [
        str('from') && str('to') ? `${str('from')} → ${str('to')}` : (str('to') ?? str('from')),
        d.charge ? `cobrou ${brl(String(d.charge))} da diferença` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'tenant.billing_pay_method':
      return str('method') ? `Agora paga por ${BILLING_TYPE[str('method')!] ?? str('method')}` : '';
    case 'tenant.profile_updated':
    case 'tenant.owner_updated': {
      const f = Array.isArray(d.fields) ? (d.fields as string[]) : [];
      const renamed = str('from') && str('to') ? ` · ${str('from')} → ${str('to')}` : '';
      return f.length ? `Campos: ${f.map((k) => PROFILE_FIELDS[k] ?? k).join(', ')}${renamed}` : '';
    }
    case 'platform.tenant.profile_updated': {
      const f = Array.isArray(d.fields) ? (d.fields as string[]) : [];
      return f.length ? `Campos: ${f.map((k) => PROFILE_FIELDS[k] ?? k).join(', ')}` : '';
    }
    case 'platform.tenant_version.upgrade':
      return `v${str('from') ?? '?'} → v${str('to') ?? '?'}${d.scheduled ? ' (agendada)' : ''}`;
    case 'platform.tenant_version.scheduled':
      return `Para v${str('to') ?? '?'}${str('at') ? ` em ${dateTime(str('at')!)}` : ''}`;
    case 'platform.billing_paid':
      return [
        d.manual ? 'baixa manual' : 'pelo Asaas',
        str('billingType') ? (BILLING_TYPE[str('billingType')!] ?? str('billingType')) : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'platform.billing_mode_changed':
      return d.mode === 'asaas' ? 'Cobrança automática (Asaas)' : 'Cobrança manual';
    case 'platform.billing_invoice_created':
      return [
        str('description'),
        str('amount') ? brl(str('amount')!) : null,
        str('dueDate') ? `vence ${day(str('dueDate')!)}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'platform.billing_invoice_cancelled':
      return d.reason === 'covered_by_paid_period'
        ? 'Período já estava pago'
        : str('reason')
          ? `Motivo: ${str('reason')}`
          : '';
    case 'platform.ai_tokens_granted':
    case 'platform.ai_tokens_removed':
      return [
        typeof d.delta === 'number' ? `${Math.abs(d.delta).toLocaleString('pt-BR')} tokens` : null,
        typeof d.balanceAfter === 'number'
          ? `saldo ${d.balanceAfter.toLocaleString('pt-BR')}`
          : null,
        str('note'),
      ]
        .filter(Boolean)
        .join(' · ');
    case 'platform.online_pay.tenant_fee':
      return d.fee === null || d.fee === undefined ? 'Volta à taxa padrão' : `Taxa: ${generic(d)}`;
    case 'platform.contract_created':
      return [
        str('number'),
        str('planName'),
        d.priceMonthly ? `${brl(String(d.priceMonthly))}/mês` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'platform.contract_sent':
      return `${str('number') ?? ''}${str('to') ? ` para ${str('to')}` : ''}`;
    case 'platform.contract_signed':
    case 'platform.contract_countersigned':
      return `${str('number') ?? ''}${str('signer') ? ` · ${str('signer')}` : ''}`;
    case 'platform.tenant_created':
    case 'platform.demo_created':
      return [str('adminEmail') ? `Dono: ${str('adminEmail')}` : null, str('slug')]
        .filter(Boolean)
        .join(' · ');
    case 'platform.login_failed':
      return [
        str('email'),
        d.reason === 'code' ? 'código errado' : d.reason === 'no_code' ? 'sem código' : null,
        d.reason === 'credentials' ? 'e-mail ou senha errados' : null,
      ]
        .filter(Boolean)
        .join(' · ');
    default:
      return generic(d);
  }
}

/** Quem fez: o administrador, o próprio restaurante ou o sistema sozinho. */
function who(a: AuditRow) {
  if (a.adminName) return a.adminName;
  if (a.action.startsWith('tenant.') || a.action.startsWith('site.trial')) {
    const by = (a.data as Record<string, unknown> | null)?.by;
    return typeof by === 'string' ? `${by} (restaurante)` : 'Restaurante';
  }
  if (a.action === 'platform.contract_signed') return 'Cliente';
  return 'Automático';
}

export function AuditTable({
  rows,
  plans,
  showTenant,
}: {
  rows: AuditRow[];
  plans?: Plan[];
  showTenant?: boolean;
}) {
  if (!rows.length) return <div className="adm-empty">Nada registrado ainda</div>;
  return (
    <div className="adm-rows">
      {rows.map((a) => {
        const text = describe(a, plans);
        const level: Level = FAIL.has(a.action) ? 'bad' : STRONG.has(a.action) ? 'warn' : 'off';
        return (
          <div key={a.id} className="adm-row">
            <Dot level={level} />
            <span className="adm-row__main">
              <span className="adm-row__title">{actionLabel(a.action)}</span>
              <span className="adm-row__meta">
                {[
                  who(a),
                  showTenant ? a.tenantSlug : null,
                  text || null,
                  a.ip ? `IP ${a.ip}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <span className="adm-row__side">{when(a.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}

const PAGE = 100;

/** Aba Histórico do restaurante: tudo o que o painel, o restaurante e o sistema fizeram nele. */
export function TenantHistory({ tenantId, plans }: { tenantId: string; plans: Plan[] }) {
  const [limit, setLimit] = useState(PAGE);
  const [group, setGroup] = useState<Group | 'all'>('all');
  const { data, error } = useLoad<AuditRow[]>(
    `/platform/audit?tenantId=${tenantId}&limit=${limit}`,
  );
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data)
    return (
      <div className="adm-panel adm-panel__body">
        <Spinner />
      </div>
    );
  const counts = new Map<Group, number>();
  for (const a of data) counts.set(groupOf(a.action), (counts.get(groupOf(a.action)) ?? 0) + 1);
  const shown = group === 'all' ? data : data.filter((a) => groupOf(a.action) === group);
  const chips = (Object.keys(GROUP_LABELS) as Group[]).filter((g) => counts.get(g));
  return (
    <div className="adm-stack">
      {chips.length > 1 && (
        <div className="adm-chips" role="group" aria-label="Filtrar o histórico">
          <button
            type="button"
            className="adm-chip"
            aria-pressed={group === 'all'}
            onClick={() => setGroup('all')}
          >
            Tudo <span>{data.length}</span>
          </button>
          {chips.map((g) => (
            <button
              key={g}
              type="button"
              className="adm-chip"
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
            >
              {GROUP_LABELS[g]} <span>{counts.get(g)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="adm-panel">
        <AuditTable rows={shown} plans={plans} />
      </div>
      {data.length >= limit && limit < 500 && (
        <div>
          <Button variant="secondary" onClick={() => setLimit((n) => Math.min(n + PAGE * 2, 500))}>
            Carregar mais
          </Button>
        </div>
      )}
      <p className="adm-sub" style={{ whiteSpace: 'normal' }}>
        Tudo o que mudou neste restaurante pelo painel, pela cobrança e pelo próprio restaurante
        (plano e forma de pagar). Os pedidos e o dia a dia da loja ficam no sistema dele.
      </p>
    </div>
  );
}

/** Conta › Registro do painel: entradas, ajustes e ações no servidor (sem restaurante). */
export function PanelLogModal({ onClose }: { onClose: () => void }) {
  const { data, error } = useLoad<AuditRow[]>('/platform/audit?scope=platform&limit=200');
  return (
    <Modal open title="Registro do painel" size="lg" onClose={onClose}>
      <p className="adm-sub" style={{ whiteSpace: 'normal', marginTop: 0 }}>
        Quem entrou no painel, ajustes salvos e ações no servidor. O que é de um restaurante fica na
        aba Histórico dele.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      {!data ? <Spinner /> : <AuditTable rows={data} />}
    </Modal>
  );
}
