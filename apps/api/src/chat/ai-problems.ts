import {
  CHANNEL_STORE_STATE_LABELS,
  channelInfo,
  ORDER_STATUS_LABELS,
  type ChannelStoreState,
  type OrderStatus,
} from '@comandou/shared';
import { one, q } from '../common/sql';
import type { Tx } from '../database/database.service';

/**
 * "Problemas agora" do assistente da equipe (0.270, pedido do David: "quero que ele veja tudo no
 * sistema, se deu algum problema que ele consiga me ajudar"). Cada função olha uma parte do
 * restaurante e devolve o que trava a operação ou o dinheiro, com o link da tela que resolve.
 * Quem chama decide pela permissão de quem pergunta e roda tudo numa transação só (com
 * SAVEPOINT por parte, para uma falha não derrubar as outras).
 *
 * Só contagens, números de pedido e nomes da loja: nada de nome, telefone ou e-mail de cliente.
 */
export interface Problem {
  /** urgente: trava a venda, o cliente ou o dinheiro agora; atencao: pede uma olhada hoje. */
  level: 'urgente' | 'atencao';
  text: string;
  /** Tela que resolve (com `?foco=` ou `?abrir=`, leva direto e o lugar pisca ou abre). */
  to?: string;
}

/** "há 25 min", "há 3 h", "há 10 dias". */
export function ago(d: Date | string, now = new Date()): string {
  const min = Math.max(0, Math.round((now.getTime() - new Date(d).getTime()) / 60000));
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

/** Texto que veio de fora (SEFAZ, impressora, aplicativo): uma linha, sem marcação, curto. */
export function cleanText(s: string | null | undefined, max = 140): string {
  return (s ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[[\]()*_`<>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Pedidos: parados há horas, esperando aceite, cancelamento pedido, sem pagamento e Pix. */
export async function orderProblems(tx: Tx, now = new Date()): Promise<Problem[]> {
  const r = await one<{
    stuck: number;
    stuck_list: {
      id: string;
      number: number;
      status: OrderStatus;
      payment_status: string;
      moved_at: string;
    }[];
    awaiting: number;
    awaiting_since: Date | null;
    cancel_req: number;
    unpaid: number;
    pix_check: number;
    pix_refund: number;
  }>(
    tx,
    `WITH stuck AS (
       SELECT id, number, status, payment_status, coalesce(updated_at, created_at) AS moved_at
         FROM orders
        WHERE status IN ('new', 'in_production', 'ready', 'dispatched')
          AND (scheduled_for IS NULL OR scheduled_for < now())
          AND coalesce(updated_at, created_at) < now() - interval '3 hours'
     ), waiting AS (
       SELECT created_at FROM orders
        WHERE status = 'awaiting'
          AND created_at BETWEEN now() - interval '1 day' AND now() - interval '5 minutes'
          AND (scheduled_for IS NULL OR scheduled_for < now())
          AND NOT (pay_online IS NOT NULL AND payment_status <> 'paid')
          AND coalesce(pix_status, '') <> 'waiting'
     )
     SELECT (SELECT count(*)::int FROM stuck) AS stuck,
            (SELECT coalesce(json_agg(s ORDER BY s.moved_at), '[]'::json)
               FROM (SELECT * FROM stuck ORDER BY moved_at LIMIT 3) s) AS stuck_list,
            (SELECT count(*)::int FROM waiting) AS awaiting,
            (SELECT min(created_at) FROM waiting) AS awaiting_since,
            (SELECT count(*)::int FROM orders WHERE status = 'cancel_requested') AS cancel_req,
            (SELECT count(*)::int FROM orders
              WHERE status = 'completed' AND payment_status <> 'paid' AND fiado_at IS NULL
                AND created_at > now() - interval '30 days') AS unpaid,
            (SELECT count(*)::int FROM orders WHERE pix_status = 'submitted') AS pix_check,
            (SELECT count(*)::int FROM orders WHERE pix_status = 'refund_due') AS pix_refund`,
  );
  if (!r) return [];
  const out: Problem[] = [];
  if (r.awaiting)
    out.push({
      level: 'urgente',
      text: `${plural(r.awaiting, 'pedido do cardápio esperando', 'pedidos do cardápio esperando')} alguém aceitar (o mais antigo ${ago(r.awaiting_since!, now)}): o cliente está esperando. Aceite ou recuse na coluna Em análise do PDV.`,
      to: '/',
    });
  if (r.cancel_req)
    out.push({
      level: 'urgente',
      text: `${plural(r.cancel_req, 'pedido com cancelamento pedido', 'pedidos com cancelamento pedido')} esperando aprovação (o garçom pediu; quem tem permissão aprova ou recusa no detalhe do pedido).`,
      to: '/pedidos',
    });
  if (r.stuck) {
    const list = r.stuck_list
      .map(
        (o) =>
          `#${o.number} (${ORDER_STATUS_LABELS[o.status] ?? o.status}${o.payment_status === 'paid' ? ', pago' : ', a pagar'}, parado ${ago(o.moved_at, now)}: /pedidos?abrir=${o.id})`,
      )
      .join('; ');
    out.push({
      level: 'urgente',
      text: `${plural(r.stuck, 'pedido parado', 'pedidos parados')} há mais de 3 horas sem andar: ${list}${r.stuck > 3 ? '; e outros' : ''}. Provavelmente já saíram e ninguém concluiu: abra cada um, receba o que falta e conclua (ou cancele, se não aconteceu). Pedido parado deixa o PDV cheio e as vendas do dia erradas.`,
      to: '/pedidos',
    });
  }
  if (r.pix_check)
    out.push({
      level: 'urgente',
      text: `${plural(r.pix_check, 'comprovante de Pix', 'comprovantes de Pix')} do cardápio esperando conferência: confira no banco e aprove ou recuse no pedido.`,
      to: '/pedidos',
    });
  if (r.pix_refund)
    out.push({
      level: 'atencao',
      text: `${plural(r.pix_refund, 'Pix para devolver', 'Pix para devolver')} ao cliente (pedido cancelado depois de pago): devolva e marque no pedido.`,
      to: '/pedidos',
    });
  if (r.unpaid)
    out.push({
      level: 'atencao',
      text: `${plural(r.unpaid, 'pedido concluído sem pagamento', 'pedidos concluídos sem pagamento')} nos últimos 30 dias (aba Concluídos em aberto de Pedidos): receba ou lance como fiado.`,
      to: '/pedidos',
    });
  return out;
}

/**
 * Nota fiscal: recusadas, presas e em contingência; para quem configura (`manage`), também o
 * certificado, o CSC e a homologação.
 */
export async function fiscalProblems(tx: Tx, manage = true, now = new Date()): Promise<Problem[]> {
  const r = await one<{
    enabled: boolean | null;
    environment: string | null;
    cert_until: string | null;
    csc_prod: boolean | null;
    bad: number;
    bad_id: string | null;
    bad_msg: string | null;
    stuck: number;
    contingency: number;
  }>(
    tx,
    `SELECT s.enabled, s.environment, s.certificate_valid_until::text AS cert_until,
            s.csc_prod_set AS csc_prod,
            (SELECT count(*)::int FROM fiscal_documents
              WHERE status IN ('rejected', 'error') AND created_at > now() - interval '7 days') AS bad,
            (SELECT id FROM fiscal_documents
              WHERE status IN ('rejected', 'error') AND created_at > now() - interval '7 days'
              ORDER BY created_at DESC LIMIT 1) AS bad_id,
            (SELECT coalesce(sefaz_message, last_error) FROM fiscal_documents
              WHERE status IN ('rejected', 'error') AND created_at > now() - interval '7 days'
              ORDER BY created_at DESC LIMIT 1) AS bad_msg,
            (SELECT count(*)::int FROM fiscal_documents
              WHERE status IN ('pending', 'processing') AND created_at < now() - interval '30 minutes'
                AND created_at > now() - interval '7 days') AS stuck,
            (SELECT count(*)::int FROM fiscal_documents
              WHERE contingency AND contingency_settled_at IS NULL) AS contingency
       FROM (SELECT 1) one LEFT JOIN tenant_fiscal_settings s ON true LIMIT 1`,
  );
  if (!r) return [];
  const out: Problem[] = [];
  if (r.bad)
    out.push({
      level: 'urgente',
      text: `${plural(r.bad, 'nota recusada ou com erro', 'notas recusadas ou com erro')} nos últimos 7 dias${r.bad_msg ? `; a última: "${cleanText(r.bad_msg)}"` : ''}. Abra a nota para ver o que corrigir e emitir de novo.`,
      to: r.bad_id ? `/fiscal/nota/${r.bad_id}` : '/fiscal/nfce',
    });
  if (r.stuck)
    out.push({
      level: 'atencao',
      text: `${plural(r.stuck, 'nota presa', 'notas presas')} em processamento há mais de 30 min (a SEFAZ não respondeu): abra e consulte de novo.`,
      to: '/fiscal/nfce',
    });
  if (r.contingency)
    out.push({
      level: 'atencao',
      text: `${plural(r.contingency, 'nota emitida em contingência', 'notas emitidas em contingência')} ainda sem envio à SEFAZ: o sistema manda sozinho quando a SEFAZ voltar; confira em Notas emitidas.`,
      to: '/fiscal/nfce',
    });
  if (r.enabled && manage) {
    if (r.cert_until) {
      const days = Math.floor(
        (new Date(`${r.cert_until.slice(0, 10)}T23:59:59-03:00`).getTime() - now.getTime()) /
          86400000,
      );
      if (days < 0)
        out.push({
          level: 'urgente',
          text: `O certificado digital A1 venceu em ${r.cert_until.slice(0, 10).split('-').reverse().join('/')}: nenhuma nota sai até enviar o certificado novo (pedido à contabilidade ou à certificadora).`,
          to: '/fiscal/configuracao?foco=secao-focus',
        });
      else if (days <= 30)
        out.push({
          level: 'atencao',
          text: `O certificado digital A1 vence em ${days} dia(s) (${r.cert_until.slice(0, 10).split('-').reverse().join('/')}): renove antes para a nota não parar.`,
          to: '/fiscal/configuracao?foco=secao-focus',
        });
    } else
      out.push({
        level: 'urgente',
        text: 'Nota fiscal ligada sem certificado digital A1: envie o certificado para emitir.',
        to: '/fiscal/configuracao?foco=secao-focus',
      });
    if (r.environment === 'producao' && !r.csc_prod)
      out.push({
        level: 'urgente',
        text: 'NFC-e em produção sem o CSC de produção (o código que a SEFAZ dá): sem ele a NFC-e é recusada.',
        to: '/fiscal/configuracao?foco=campo-csc',
      });
    if (r.environment !== 'producao')
      out.push({
        level: 'atencao',
        text: 'A nota fiscal está em homologação (teste): as notas não valem. Quando os testes derem certo, passe para produção.',
        to: '/fiscal/configuracao?foco=secao-emissao',
      });
  }
  return out;
}

/** Impressão: computadores desligados, fila parada e impressões que falharam. */
export async function printProblems(tx: Tx): Promise<Problem[]> {
  const r = await one<{
    agents: number;
    online: number;
    stuck: number;
    failed: number;
    failed_msg: string | null;
  }>(
    tx,
    `SELECT (SELECT count(*)::int FROM print_agents WHERE active) AS agents,
            (SELECT count(*)::int FROM print_agents
              WHERE active AND last_seen_at > now() - interval '2 minutes') AS online,
            (SELECT count(*)::int FROM print_jobs
              WHERE status IN ('queued', 'printing')
                AND created_at BETWEEN now() - interval '1 day' AND now() - interval '3 minutes') AS stuck,
            (SELECT count(*)::int FROM print_jobs
              WHERE status = 'failed' AND created_at > now() - interval '1 day') AS failed,
            (SELECT last_error FROM print_jobs
              WHERE status = 'failed' AND created_at > now() - interval '1 day'
              ORDER BY created_at DESC LIMIT 1) AS failed_msg`,
  );
  if (!r) return [];
  const out: Problem[] = [];
  if (r.agents && !r.online)
    out.push({
      level: 'urgente',
      text: `Nenhum computador de impressão online (${r.agents} cadastrado(s)): a cozinha e o caixa não recebem papel. Ligue o computador da loja e abra o aplicativo Comandou Impressão.`,
      to: '/impressao?foco=secao-agentes',
    });
  if (r.stuck)
    out.push({
      level: 'urgente',
      text: `${plural(r.stuck, 'impressão parada', 'impressões paradas')} na fila há mais de 3 min${r.agents ? '' : ' e nenhum computador de impressão conectado'}: confira se a impressora está ligada, com papel e no computador certo.`,
      to: '/impressao?foco=secao-fila',
    });
  if (r.failed)
    out.push({
      level: 'atencao',
      text: `${plural(r.failed, 'impressão falhou', 'impressões falharam')} nas últimas 24 h${r.failed_msg ? `; a última: "${cleanText(r.failed_msg)}"` : ''}. Dá para mandar de novo pela fila.`,
      to: '/impressao?foco=secao-fila',
    });
  return out;
}

/** WhatsApp: avisos que não saíram. A conexão (QR Code) quem confere é o serviço, no gateway. */
export async function messagingProblems(
  tx: Tx,
): Promise<{ problems: Problem[]; qrEnabled: boolean }> {
  const r = await one<{
    enabled: boolean | null;
    provider: string | null;
    failed: number;
    failed_msg: string | null;
  }>(
    tx,
    `SELECT s.enabled, s.provider,
            (SELECT count(*)::int FROM message_outbox
              WHERE status = 'failed' AND created_at > now() - interval '1 day') AS failed,
            (SELECT last_error FROM message_outbox
              WHERE status = 'failed' AND created_at > now() - interval '1 day'
              ORDER BY created_at DESC LIMIT 1) AS failed_msg
       FROM (SELECT 1) one LEFT JOIN tenant_messaging_settings s ON true LIMIT 1`,
  );
  const problems: Problem[] = [];
  if (r?.failed)
    problems.push({
      level: 'atencao',
      text: `${plural(r.failed, 'mensagem automática do WhatsApp não saiu', 'mensagens automáticas do WhatsApp não saíram')} nas últimas 24 h${r.failed_msg ? `; a última: "${cleanText(r.failed_msg)}"` : ''}.`,
      to: '/whatsapp?foco=secao-avisos',
    });
  return { problems, qrEnabled: !!r?.enabled && (r.provider ?? 'baileys') === 'baileys' };
}

/** Como está a conexão do WhatsApp da loja (QR Code), já lida no gateway. */
export function whatsappProblem(status: string | null, reconnecting?: boolean): Problem | null {
  if (!status || status === 'connected') return null;
  if (status === 'connecting' && reconnecting)
    return {
      level: 'atencao',
      text: 'O WhatsApp da loja caiu e está religando sozinho; se passar de alguns minutos, leia o QR Code de novo.',
      to: '/whatsapp?foco=secao-qr',
    };
  return {
    level: 'urgente',
    text: 'O WhatsApp da loja está desconectado: os avisos ao cliente, a IA do WhatsApp e os lembretes não saem. Leia o QR Code de novo com o celular da loja (WhatsApp › Aparelhos conectados).',
    to: '/whatsapp?foco=secao-qr',
  };
}

/** Aplicativos de delivery: loja desligada, com erro ou pausada, itens sem vínculo e negociações. */
export async function channelProblems(tx: Tx): Promise<Problem[]> {
  const stores = await q<{
    channel: string;
    name: string | null;
    status: string;
    error: string | null;
    state: ChannelStoreState | null;
    pause_until: Date | null;
  }>(
    tx,
    `SELECT channel, name, status, coalesce(state_error, last_error) AS error,
            channel_state AS state, pause_until
       FROM channel_stores
      WHERE status = 'revoked' OR state_error IS NOT NULL OR last_error IS NOT NULL
         OR channel_state IN ('error', 'warning', 'paused')
      ORDER BY channel LIMIT 5`,
  );
  const r = await one<{ unlinked: number; disputes: number; dispute_order: string | null }>(
    tx,
    `SELECT (SELECT count(*)::int FROM channel_orders
              WHERE unlinked_items > 0 AND created_at > now() - interval '7 days') AS unlinked,
            (SELECT count(*)::int FROM channel_disputes WHERE status = 'open') AS disputes,
            (SELECT order_id FROM channel_disputes WHERE status = 'open'
              ORDER BY created_at LIMIT 1) AS dispute_order`,
  );
  const out: Problem[] = [];
  if (r?.disputes)
    out.push({
      level: 'urgente',
      text: `${plural(r.disputes, 'negociação de aplicativo', 'negociações de aplicativo')} esperando resposta (o cliente pediu para cancelar ou mudar o pedido; se ninguém responder, o aplicativo decide sozinho).`,
      to: r.dispute_order ? `/pedidos?abrir=${r.dispute_order}` : '/integracoes',
    });
  for (const s of stores) {
    const app = channelInfo(s.channel).label;
    const loja = s.name ? ` (${cleanText(s.name, 40)})` : '';
    if (s.status === 'revoked')
      out.push({
        level: 'urgente',
        text: `A loja do ${app}${loja} foi desligada do Comandou: os pedidos de lá não entram. Ligue de novo em Aplicativos de delivery.`,
        to: '/integracoes',
      });
    else if (s.error)
      out.push({
        level: 'urgente',
        text: `A loja do ${app}${loja} está com erro: "${cleanText(s.error)}".`,
        to: '/integracoes',
      });
    else if (s.state)
      out.push({
        level: s.state === 'paused' ? 'atencao' : 'urgente',
        text: `A loja do ${app}${loja} está ${CHANNEL_STORE_STATE_LABELS[s.state]?.toLowerCase() ?? s.state} no aplicativo${s.state === 'paused' && s.pause_until ? ` até ${new Date(s.pause_until).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}` : ''}.`,
        to: '/integracoes',
      });
  }
  if (r?.unlinked)
    out.push({
      level: 'atencao',
      text: `${plural(r.unlinked, 'pedido de aplicativo chegou', 'pedidos de aplicativo chegaram')} com item sem vínculo com o cardápio nos últimos 7 dias (não baixa estoque nem vai certo para a cozinha): ligue os itens.`,
      to: '/integracoes?foco=secao-sem-vinculo',
    });
  return out;
}

/** Pagamento online (PagBank): devolução que ficou para fazer. */
export async function paymentProblems(tx: Tx): Promise<Problem[]> {
  const r = await one<{ refund: number }>(
    tx,
    `SELECT count(*)::int AS refund FROM online_charges WHERE status = 'refund_due'`,
  );
  return r?.refund
    ? [
        {
          level: 'atencao',
          text: `${plural(r.refund, 'pagamento online para devolver', 'pagamentos online para devolver')} ao cliente (cancelado ou pago a mais): a devolução não saiu sozinha; confira no pedido.`,
          to: '/pedidos',
        },
      ]
    : [];
}

/** Caixa aberto desde ontem (esqueceram de fechar). */
export async function cashProblems(tx: Tx, now = new Date()): Promise<Problem[]> {
  const rows = await q<{ id: string; number: number; name: string | null; opened_at: Date }>(
    tx,
    `SELECT s.id, s.number, r.name, s.opened_at FROM cash_sessions s
       LEFT JOIN cash_registers r ON r.id = s.register_id
      WHERE s.status = 'open' AND s.opened_at < now() - interval '18 hours'
      ORDER BY s.opened_at LIMIT 3`,
  );
  return rows.map((s) => ({
    level: 'atencao' as const,
    text: `Caixa ${s.name ? `${cleanText(s.name, 40)} ` : ''}nº ${s.number} aberto ${ago(s.opened_at, now)}: feche o caixa do dia anterior (confere o dinheiro e manda o dia para o Financeiro).`,
    to: `/caixa?sessao=${s.id}&foco=sessao-${s.id}`,
  }));
}

/** Salão e atendimento: mesa chamando, reserva para confirmar e cliente sem resposta no chat. */
export async function floorProblems(
  tx: Tx,
  o: { tables: boolean; reservations: boolean; chats: boolean; agent: boolean },
  now = new Date(),
): Promise<Problem[]> {
  const r = await one<{
    calls: { label: string; kind: string; at: string }[];
    pending: number;
    pending_next: Date | null;
    chats: number;
    handoff: number;
  }>(
    tx,
    `SELECT (SELECT coalesce(json_agg(c ORDER BY c.at), '[]'::json) FROM (
               SELECT t.label, tc.kind, tc.created_at AS at FROM table_calls tc
                 JOIN dining_tables t ON t.id = tc.table_id
                WHERE tc.status = 'open'
                  AND tc.created_at BETWEEN now() - interval '6 hours' AND now() - interval '3 minutes'
                ORDER BY tc.created_at LIMIT 4) c) AS calls,
            (SELECT count(*)::int FROM reservations
              WHERE status = 'pending' AND starts_at BETWEEN now() - interval '1 hour'
                AND now() + interval '1 day') AS pending,
            (SELECT min(starts_at) FROM reservations
              WHERE status = 'pending' AND starts_at BETWEEN now() - interval '1 hour'
                AND now() + interval '1 day') AS pending_next,
            (SELECT count(*)::int FROM store_chats
              WHERE status = 'open' AND last_sender = 'customer'
                AND last_message_at BETWEEN now() - interval '1 day' AND now() - interval '5 minutes'
                AND (staff_read_at IS NULL OR last_message_at > staff_read_at)) AS chats,
            (SELECT count(*)::int FROM ai_customer_chats WHERE paused_until > now()) AS handoff`,
  );
  if (!r) return [];
  const out: Problem[] = [];
  if (o.tables && r.calls.length)
    out.push({
      level: 'urgente',
      text: `Mesa chamando e ninguém atendeu: ${r.calls.map((c) => `${cleanText(c.label, 30)} (${c.kind === 'bill' ? 'pediu a conta' : 'chamou o garçom'}, ${ago(c.at, now)})`).join('; ')}.`,
      to: '/mesas',
    });
  if (o.reservations && r.pending)
    out.push({
      level: 'atencao',
      text: `${plural(r.pending, 'reserva esperando confirmação', 'reservas esperando confirmação')} para as próximas 24 h (a primeira às ${new Date(r.pending_next!).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}): confirme e escolha a mesa.`,
      to: '/reservas',
    });
  if (o.chats && r.chats)
    out.push({
      level: 'urgente',
      text: `${plural(r.chats, 'cliente esperando resposta', 'clientes esperando resposta')} na conversa do cardápio online (botão Chat do topo, aba Clientes).`,
    });
  if (o.agent && r.handoff)
    out.push({
      level: 'atencao',
      text: `A IA do WhatsApp chamou alguém da equipe em ${plural(r.handoff, 'conversa', 'conversas')} e está quieta nelas por um tempo: responda pelo WhatsApp da loja.`,
      to: '/assistente-ia',
    });
  return out;
}

/** Entregas na rua há muito tempo. */
export async function deliveryProblems(tx: Tx): Promise<Problem[]> {
  const r = await one<{ late: number }>(
    tx,
    `SELECT count(*)::int AS late FROM deliveries
      WHERE status = 'out' AND dispatched_at < now() - interval '90 minutes'`,
  );
  return r?.late
    ? [
        {
          level: 'atencao',
          text: `${plural(r.late, 'entrega na rua', 'entregas na rua')} há mais de 1 h 30: veja no mapa se o entregador está a caminho ou se esqueceu de concluir (dá para concluir pelo painel).`,
          to: '/entregas',
        },
      ]
    : [];
}

/** Avisos do sistema que esta pessoa ainda não leu (custo que subiu, limite de IA…). */
export async function noticeProblems(tx: Tx, userId: string): Promise<Problem[]> {
  const rows = await q<{ title: string; body: string | null }>(
    tx,
    `SELECT title, body FROM chat_notices
      WHERE user_id = $1 AND read_at IS NULL AND created_at > now() - interval '3 days'
        AND kind IN ('system', 'ai')
      ORDER BY created_at DESC LIMIT 3`,
    [userId],
  );
  return rows.map((n) => ({
    level: 'atencao' as const,
    text: `Aviso não lido: "${cleanText(n.title, 100)}"${n.body ? ` (${cleanText(n.body, 120)})` : ''} (botão Chat do topo, aba Avisos).`,
  }));
}

/** Assinatura: bloqueada, em atraso, teste acabando ou contrato para renovar (do aviso do topo). */
export function billingProblem(n: {
  level: string;
  blockReason?: string | null;
  openInvoices?: number;
  daysLeft?: number | null;
  status?: string;
  contractPhase?: string;
  trial?: { daysLeft: number } | null;
}): Problem | null {
  if (n.level === 'blocked')
    return {
      level: 'urgente',
      text: 'A assinatura do restaurante está bloqueada: pague a fatura em aberto (ou fale com o Comandou) para liberar.',
      to: '/plano',
    };
  if (n.level === 'warning')
    return {
      level: 'urgente',
      text: `Mensalidade em aberto${n.openInvoices ? ` (${plural(n.openInvoices, 'fatura', 'faturas')})` : ''}${n.daysLeft !== null && n.daysLeft !== undefined ? `; o acesso vale por mais ${n.daysLeft} dia(s)` : ''}: pague para o sistema não bloquear.`,
      to: '/plano',
    };
  if (n.level === 'info' && n.trial)
    return {
      level: 'atencao',
      text: `O teste grátis acaba em ${n.trial.daysLeft} dia(s): fale com o Comandou para continuar.`,
      to: '/plano',
    };
  if (n.level === 'info' && (n.contractPhase === 'renewal' || n.contractPhase === 'expired'))
    return {
      level: 'atencao',
      text: `O contrato com o Comandou ${n.contractPhase === 'expired' ? 'venceu' : 'está para vencer'}: assine a renovação.`,
      to: '/plano',
    };
  return null;
}

/** Roda uma parte dentro da transação sem deixar um erro derrubar as outras. */
export async function safely<T>(tx: Tx, name: string, fn: () => Promise<T>, empty: T): Promise<T> {
  const sp = `ai_${name.replace(/\W/g, '_')}`;
  await q(tx, `SAVEPOINT ${sp}`);
  try {
    const v = await fn();
    await q(tx, `RELEASE SAVEPOINT ${sp}`);
    return v;
  } catch {
    await q(tx, `ROLLBACK TO SAVEPOINT ${sp}`);
    return empty;
  }
}

/** Urgente primeiro, na ordem em que vieram. */
export function sortProblems(list: Problem[]): Problem[] {
  return [
    ...list.filter((p) => p.level === 'urgente'),
    ...list.filter((p) => p.level !== 'urgente'),
  ];
}
