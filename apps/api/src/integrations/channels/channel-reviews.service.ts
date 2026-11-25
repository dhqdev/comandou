import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { channelInfo, withArticle } from '@comandou/shared';
import { AuditService } from '../../audit/audit.service';
import { one, q } from '../../common/sql';
import { DatabaseService, type Tx } from '../../database/database.service';
import { RealtimeService } from '../../realtime/realtime.service';
import {
  ChannelHttpError,
  ChannelRegistry,
  type ChannelReview,
  type StoreRef,
} from './channel-adapter';
import { ChannelPoller } from './channel-poller.service';
import { ChannelStoresService } from './channel-stores.service';

/** Avaliação chega aos poucos: a varredura lê cada loja no máximo a cada hora. */
export const REVIEWS_SWEEP_SECONDS = 3600;
/** "Atualizar" da tela: no máximo a cada 5 minutos por loja. */
export const REVIEWS_MANUAL_SECONDS = 300;
/** Primeira leitura: 30 dias para trás; depois, desde a última leitura menos 2 dias (respostas). */
export const REVIEWS_FIRST_DAYS = 30;
export const REVIEWS_OVERLAP_DAYS = 2;

interface StoreRow {
  id: string;
  channel: string;
  store_id: string;
  name: string;
  reviews_at: Date | null;
}

const ROW = `r.id, r.channel, s.name AS "storeName", r.external_id AS "externalId",
             r.order_id AS "orderId", r.display_code AS "displayCode", r.score::float AS score,
             r.comment, r.customer_name AS "customerName", r.channel_status AS "channelStatus",
             r.can_reply AS "canReply", r.reviewed_at AS "reviewedAt", r.reply,
             r.replied_at AS "repliedAt", r.reply_from AS "replyFrom", u.name AS "repliedByName"`;

/**
 * Avaliações dos clientes nos aplicativos (ADR 0015, Fase 8). Lê com calma (a cada hora por loja),
 * liga a avaliação ao pedido do Comandou pelo id do pedido no canal e guarda a resposta da loja.
 * A resposta é sempre escrita por uma pessoa na tela: nada automático (o iFood publica a resposta
 * junto com a avaliação, para todo mundo ver).
 */
@Injectable()
export class ChannelReviewsService implements OnModuleInit {
  private readonly logger = new Logger('ChannelsReviews');

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: ChannelRegistry,
    private readonly poller: ChannelPoller,
    private readonly stores: ChannelStoresService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    this.poller.onSweep((tenantId) => this.refreshTenant(tenantId));
  }

  private async ref(tenantId: string, channel: string, storeId: string): Promise<StoreRef | null> {
    const claim = await this.db.withCentral({ tenantId }, (tx) =>
      one<{ credential: string }>(
        tx,
        `SELECT credential FROM channel_store_claims
          WHERE channel = $1 AND store_id = $2 AND approved_at IS NOT NULL`,
        [channel, storeId],
      ),
    );
    return claim ? { tenantId, storeId, credential: claim.credential } : null;
  }

  /** Lê as lojas cuja última leitura passou de `maxAgeSeconds`. Devolve quantas leu. */
  async refreshTenant(tenantId: string, maxAgeSeconds = REVIEWS_SWEEP_SECONDS) {
    const due = await this.db.withTenant({ tenantId }, (tx) =>
      q<StoreRow>(
        tx,
        `SELECT id, channel, store_id, name, reviews_at FROM channel_stores
          WHERE status = 'connected'
            AND (reviews_at IS NULL OR reviews_at < now() - make_interval(secs => $1))
          ORDER BY channel, name`,
        [maxAgeSeconds],
      ),
    );
    let read = 0;
    for (const r of due) {
      if (!this.registry.get(r.channel)?.reviews) continue;
      read++;
      await this.refreshStore(tenantId, r);
    }
    if (read) this.realtime.publish(tenantId, { type: 'channels.reviews' });
    return read;
  }

  async refreshNow(tenantId: string) {
    return { read: await this.refreshTenant(tenantId, REVIEWS_MANUAL_SECONDS) };
  }

  private async refreshStore(tenantId: string, s: StoreRow) {
    const adapter = this.registry.get(s.channel)!;
    const ref = await this.ref(tenantId, s.channel, s.store_id);
    if (!ref) return;
    const sinceMs = s.reviews_at
      ? s.reviews_at.getTime() - REVIEWS_OVERLAP_DAYS * 86_400_000
      : Date.now() - REVIEWS_FIRST_DAYS * 86_400_000;
    try {
      const reviews = await adapter.reviews!(ref, new Date(sinceMs).toISOString());
      const summary = adapter.reviewSummary ? await adapter.reviewSummary(ref) : null;
      await this.db.withTenant({ tenantId }, async (tx) => {
        for (const r of reviews) await this.save(tx, tenantId, s, r);
        await q(
          tx,
          `UPDATE channel_stores
              SET reviews_at = now(), reviews_error = NULL,
                  review_score = COALESCE($2, review_score), review_count = COALESCE($3, review_count)
            WHERE id = $1`,
          [s.id, summary?.score ?? null, summary?.count ?? null],
        );
      });
    } catch (e) {
      const err = e instanceof ChannelHttpError ? e : new ChannelHttpError(0, String(e));
      if (err.status === 403)
        await this.stores.markRevoked(tenantId, s.id, err.message).catch(() => undefined);
      this.logger.warn(`avaliações ${s.channel}: ${err.status || 'sem resposta'}`);
      await this.db.withTenant({ tenantId }, (tx) =>
        q(tx, `UPDATE channel_stores SET reviews_at = now(), reviews_error = $2 WHERE id = $1`, [
          s.id,
          `Não deu para ler as avaliações no aplicativo (${err.status || 'sem resposta'})`,
        ]),
      );
    }
  }

  /** Grava a avaliação; a resposta feita no Comandou não é apagada por uma leitura atrasada. */
  private async save(tx: Tx, tenantId: string, s: StoreRow, r: ChannelReview) {
    const order = r.orderExternalId
      ? await one<{ order_id: string; display_code: string }>(
          tx,
          `SELECT order_id, display_code FROM channel_orders WHERE channel = $1 AND external_id = $2`,
          [s.channel, r.orderExternalId],
        )
      : undefined;
    await q(
      tx,
      `INSERT INTO channel_reviews (tenant_id, channel, store_ref, store_id, external_id, order_id,
                                    external_order_id, display_code, score, comment, customer_name,
                                    channel_status, can_reply, reviewed_at, reply, replied_at,
                                    reply_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               CASE WHEN $15::text IS NULL THEN NULL ELSE 'portal' END)
       ON CONFLICT (tenant_id, channel, external_id) DO UPDATE
          SET order_id = COALESCE(channel_reviews.order_id, EXCLUDED.order_id),
              display_code = COALESCE(EXCLUDED.display_code, channel_reviews.display_code),
              score = EXCLUDED.score, comment = EXCLUDED.comment,
              channel_status = EXCLUDED.channel_status, store_ref = EXCLUDED.store_ref,
              can_reply = EXCLUDED.can_reply AND channel_reviews.reply IS NULL,
              reply = COALESCE(channel_reviews.reply, EXCLUDED.reply),
              replied_at = COALESCE(channel_reviews.replied_at, EXCLUDED.replied_at),
              reply_from = COALESCE(channel_reviews.reply_from, EXCLUDED.reply_from),
              fetched_at = now()`,
      [
        tenantId,
        s.channel,
        s.id,
        s.store_id,
        r.externalId,
        order?.order_id ?? null,
        r.orderExternalId ?? null,
        order?.display_code ?? r.orderCode ?? null,
        r.score,
        r.comment ?? null,
        r.customerName ?? null,
        r.status ?? null,
        r.canReply,
        r.createdAt,
        r.reply?.text ?? null,
        r.reply?.at ?? null,
      ],
    );
  }

  /** Tela: nota de cada loja e as avaliações (sem resposta primeiro, se pedido). */
  async list(tenantId: string, opts: { pending: boolean; limit: number }) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const reviews = await q(
        tx,
        `SELECT ${ROW}
           FROM channel_reviews r
           LEFT JOIN channel_stores s ON s.id = r.store_ref
           LEFT JOIN users u ON u.id = r.replied_by
          WHERE ($1::boolean IS FALSE OR (r.can_reply AND r.reply IS NULL))
          ORDER BY r.reviewed_at DESC LIMIT $2`,
        [opts.pending, opts.limit],
      );
      const stores = await q(
        tx,
        `SELECT s.id, s.channel, s.name, s.review_score::float AS score, s.review_count AS count,
                s.reviews_at AS "readAt", s.reviews_error AS error,
                (SELECT count(*)::int FROM channel_reviews r
                  WHERE r.store_ref = s.id AND r.can_reply AND r.reply IS NULL) AS pending,
                (SELECT round(avg(r.score), 2)::float FROM channel_reviews r
                  WHERE r.store_ref = s.id AND r.reviewed_at > now() - interval '30 days') AS "score30"
           FROM channel_stores s WHERE s.status = 'connected' ORDER BY s.channel, s.name`,
      );
      return {
        reviews,
        stores: stores.filter(
          (s) => !!this.registry.get((s as { channel: string }).channel)?.reviews,
        ),
      };
    });
  }

  /** Avaliação do pedido (gaveta do pedido). */
  async ofOrder(tenantId: string, orderId: string) {
    return this.db.withTenant({ tenantId }, (tx) =>
      q(
        tx,
        `SELECT ${ROW}
           FROM channel_reviews r
           LEFT JOIN channel_stores s ON s.id = r.store_ref
           LEFT JOIN users u ON u.id = r.replied_by
          WHERE r.order_id = $1 ORDER BY r.reviewed_at DESC`,
        [orderId],
      ),
    );
  }

  /**
   * Publica a resposta escrita pela pessoa. Uma por avaliação; sem repetir (4xx do canal volta
   * como mensagem; rede ou 5xx: a pessoa tenta de novo, e a leitura seguinte mostra se já foi).
   */
  async reply(tenantId: string, userId: string, id: string, text: string, ip?: string) {
    const r = await this.db.withTenant({ tenantId }, (tx) =>
      one<{
        channel: string;
        store_id: string;
        external_id: string;
        can_reply: boolean;
        reply: string | null;
      }>(
        tx,
        `SELECT channel, store_id, external_id, can_reply, reply FROM channel_reviews WHERE id = $1`,
        [id],
      ),
    );
    if (!r) throw new NotFoundException('Avaliação não encontrada');
    const label = channelInfo(r.channel).label;
    if (r.reply || !r.can_reply)
      throw new ConflictException(
        `Esta avaliação já foi respondida ou ${withArticle(label, 'o')} não aceita resposta`,
      );
    const adapter = this.registry.get(r.channel);
    const ref = await this.ref(tenantId, r.channel, r.store_id);
    if (!adapter?.replyReview || !ref)
      throw new ConflictException(`A loja não está ligada ${withArticle(label, 'ao')}`);
    try {
      await adapter.replyReview(ref, r.external_id, text);
    } catch (e) {
      const err = e instanceof ChannelHttpError ? e : new ChannelHttpError(0, String(e));
      if (err.status === 409) {
        await this.db.withTenant({ tenantId }, (tx) =>
          q(tx, `UPDATE channel_reviews SET can_reply = false WHERE id = $1`, [id]),
        );
        throw new ConflictException(
          `${withArticle(label, 'O')} diz que esta avaliação já foi respondida`,
        );
      }
      throw new UnprocessableEntityException(
        err.retryable
          ? `${withArticle(label, 'O')} não respondeu. Tente de novo em instantes.`
          : `${withArticle(label, 'O')} recusou a resposta (${err.status}): ${err.message}`,
      );
    }
    await this.db.withTenant({ tenantId, userId }, async (tx) => {
      await q(
        tx,
        `UPDATE channel_reviews
            SET reply = $2, replied_at = now(), replied_by = $3, reply_from = 'comandou',
                can_reply = false
          WHERE id = $1`,
        [id, text, userId],
      );
      await this.audit.record(tx, {
        tenantId,
        actorUserId: userId,
        action: 'channel.review_replied',
        entity: 'channel_review',
        entityId: id,
        data: { channel: r.channel, length: text.length },
        ip,
      });
    });
    this.realtime.publish(tenantId, { type: 'channels.reviews' });
    return { ok: true };
  }
}
