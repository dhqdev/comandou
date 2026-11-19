import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  toCents,
  type ChannelAction,
  type ChannelCancelReason,
  type DisputeAlternative,
} from '@comandou/shared';
import { AuditService } from '../../audit/audit.service';
import { one, q } from '../../common/sql';
import { DatabaseService, type Tx } from '../../database/database.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { ChannelRegistry, type ChannelDispute, type ChannelSettlement } from './channel-adapter';
import { ChannelOutboxService } from './channel-outbox.service';

export type DisputeDecision =
  | { decision: 'accept'; reason?: string }
  | { decision: 'reject'; reason: string }
  | {
      decision: 'alternative';
      alternativeId: string;
      amount?: string;
      minutes?: number;
      timeReason?: string;
    };

interface DisputeRow {
  id: string;
  order_id: string;
  channel: string;
  external_id: string;
  kind: string;
  status: string;
  expires_at: Date | null;
  alternatives: DisputeAlternative[];
  accept_reasons: string[];
}

/**
 * Negociação com o cliente do aplicativo (ADR 0015, Fase 3). O aplicativo avisa (evento
 * `order.dispute`), a tela mostra o pedido do cliente com o prazo e uma PESSOA responde: o iFood
 * recomenda não automatizar aceite nem recusa. A resposta sai pela caixa de saída, sem duplicar.
 */
@Injectable()
export class ChannelDisputesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly registry: ChannelRegistry,
    private readonly outbox: ChannelOutboxService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Grava (ou atualiza, enquanto ninguém respondeu) a negociação que o aplicativo abriu. */
  async openInTx(
    tx: Tx,
    tenantId: string,
    orderId: string,
    channel: string,
    d: ChannelDispute | null | undefined,
  ): Promise<string | undefined> {
    if (!d?.externalId) return 'Negociação sem identificação: confira no aplicativo';
    await q(
      tx,
      `INSERT INTO channel_disputes (tenant_id, order_id, channel, external_id, kind, message,
                                     expires_at, timeout_action, alternatives, accept_reasons)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tenant_id, channel, external_id) DO UPDATE
         SET message = EXCLUDED.message, expires_at = EXCLUDED.expires_at,
             timeout_action = EXCLUDED.timeout_action, alternatives = EXCLUDED.alternatives,
             accept_reasons = EXCLUDED.accept_reasons
         WHERE channel_disputes.status = 'open'`,
      [
        tenantId,
        orderId,
        channel,
        d.externalId,
        d.kind,
        d.message ?? null,
        d.expiresAt ?? null,
        d.timeoutAction ?? null,
        JSON.stringify(d.alternatives ?? []),
        JSON.stringify(d.acceptReasons ?? []),
      ],
    );
    return undefined;
  }

  /** O aplicativo encerrou a negociação (respondida, expirada ou resolvida por ele). */
  async settleInTx(
    tx: Tx,
    channel: string,
    s: ChannelSettlement | null | undefined,
  ): Promise<string | undefined> {
    if (!s?.externalId) return undefined;
    const row = await one(
      tx,
      `UPDATE channel_disputes SET status = 'settled', outcome = $3, settled_at = now()
        WHERE channel = $1 AND external_id = $2 AND status <> 'settled' RETURNING id`,
      [channel, s.externalId, s.outcome],
    );
    return row ? undefined : 'Negociação encerrada que não estava aqui';
  }

  /** Resposta de uma pessoa: grava a decisão e a manda ao aplicativo pela caixa de saída. */
  async decide(
    tenantId: string,
    userId: string,
    id: string,
    b: DisputeDecision,
    ip?: string,
  ): Promise<{ ok: true; status: string }> {
    const r = await this.db.withTenant({ tenantId, userId }, async (tx) => {
      const d = await one<DisputeRow>(
        tx,
        `SELECT id, order_id, channel, external_id, kind, status, expires_at, alternatives,
                accept_reasons
           FROM channel_disputes WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!d) throw new NotFoundException('Negociação não encontrada');
      if (d.status !== 'open') throw new ConflictException('Esta negociação já foi respondida');
      if (d.expires_at && d.expires_at.getTime() <= Date.now())
        throw new ConflictException('O prazo para responder acabou: o aplicativo já decidiu');
      const { action, payload, status } = this.plan(d, b);
      await q(
        tx,
        `UPDATE channel_disputes SET status = $2, decision = $3, decided_by = $4, decided_at = now()
          WHERE id = $1`,
        [d.id, status, JSON.stringify(payload), userId],
      );
      const queued = await this.outbox.enqueueInTx(
        tx,
        tenantId,
        d.order_id,
        action,
        { disputeId: d.external_id, ...payload },
        `:${d.id}`,
      );
      if (!queued) throw new ConflictException('Pedido sem ligação com o aplicativo');
      await this.audit.record(tx, {
        tenantId,
        actorUserId: userId,
        action: 'channel.dispute_decision',
        entity: 'order',
        entityId: d.order_id,
        data: { channel: d.channel, kind: d.kind, decision: b.decision },
        ip,
      });
      return { orderId: d.order_id, status };
    });
    this.realtime.publish(tenantId, { type: 'order.changed', orderId: r.orderId });
    return { ok: true, status: r.status };
  }

  /** Confere a resposta contra o que o aplicativo ofereceu e monta o que vai para ele. */
  private plan(d: DisputeRow, b: DisputeDecision) {
    const bad = (m: string) => new UnprocessableEntityException(m);
    if (b.decision === 'accept') {
      const reasons = d.accept_reasons ?? [];
      const reason = b.reason?.trim();
      if (reasons.length && (!reason || !reasons.includes(reason)))
        throw bad('Escolha um dos motivos que o aplicativo aceita');
      return {
        action: 'dispute_accept' as ChannelAction,
        status: 'accepted',
        payload: reason ? { reason } : {},
      };
    }
    if (b.decision === 'reject') {
      const reason = b.reason.trim();
      if (!reason) throw bad('Diga ao cliente por que não dá');
      return { action: 'dispute_reject' as ChannelAction, status: 'rejected', payload: { reason } };
    }
    const alt = (d.alternatives ?? []).find((a) => a.id === b.alternativeId);
    if (!alt) throw bad('Proposta que o aplicativo não ofereceu');
    if (alt.type === 'ADDITIONAL_TIME') {
      if (!b.minutes) throw bad('Escolha quantos minutos a mais');
      if (alt.minutes?.length && !alt.minutes.includes(b.minutes))
        throw bad('Tempo que o aplicativo não aceita');
      if (alt.reasons?.length && (!b.timeReason || !alt.reasons.includes(b.timeReason)))
        throw bad('Escolha o motivo do atraso');
      return {
        action: 'dispute_alternative' as ChannelAction,
        status: 'alternative',
        payload: {
          alternativeId: alt.id,
          type: alt.type,
          minutes: b.minutes,
          ...(b.timeReason ? { timeReason: b.timeReason } : {}),
        },
      };
    }
    if (!b.amount) throw bad('Informe o valor da proposta');
    const cents = toCents(b.amount);
    if (cents <= 0) throw bad('O valor precisa ser maior que zero');
    if (alt.maxAmount && cents > toCents(alt.maxAmount))
      throw bad(`O aplicativo aceita propor até R$ ${alt.maxAmount.replace('.', ',')}`);
    return {
      action: 'dispute_alternative' as ChannelAction,
      status: 'alternative',
      payload: {
        alternativeId: alt.id,
        type: alt.type,
        amount: b.amount,
        amountCents: cents,
      },
    };
  }

  /**
   * Motivos de cancelamento que o aplicativo aceita para este pedido (o iFood tem lista por
   * pedido). Sem o recurso no canal ou com o canal fora do ar: lista vazia (a tela pede o texto).
   */
  async cancelReasons(
    tenantId: string,
    userId: string,
    orderId: string,
  ): Promise<ChannelCancelReason[]> {
    const link = await this.db.withTenant({ tenantId, userId }, (tx) =>
      one<{ channel: string; external_id: string; store_id: string | null }>(
        tx,
        `SELECT c.channel, c.external_id, s.store_id
           FROM channel_orders c LEFT JOIN channel_stores s ON s.id = c.store_ref
          WHERE c.order_id = $1`,
        [orderId],
      ),
    );
    if (!link) throw new NotFoundException('Pedido não veio de aplicativo');
    const adapter = this.registry.get(link.channel);
    if (!adapter?.cancellationReasons || !link.store_id) return [];
    const claim = await this.db.withCentral({ tenantId }, (tx) =>
      one<{ credential: string }>(
        tx,
        `SELECT credential FROM channel_store_claims WHERE channel = $1 AND store_id = $2`,
        [link.channel, link.store_id],
      ),
    );
    if (!claim) return [];
    try {
      return await adapter.cancellationReasons({
        tenantId,
        storeId: link.store_id,
        credential: claim.credential,
        externalOrderId: link.external_id,
      });
    } catch {
      return [];
    }
  }
}
