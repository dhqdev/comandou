import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { channelInfo } from '@comandou/shared';
import { one, q } from '../../common/sql';
import { DatabaseService, type Tx } from '../../database/database.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { addDays } from '../ifood/ifood-finance';
import {
  ChannelHttpError,
  ChannelRegistry,
  type ChannelPayout,
  type ChannelSaleFinance,
  type StoreRef,
} from './channel-adapter';
import { ChannelPoller } from './channel-poller.service';
import { ChannelStoresService } from './channel-stores.service';

/** O financeiro do aplicativo muda devagar: a varredura lê no máximo a cada 6 horas por loja. */
export const FINANCE_SWEEP_SECONDS = 6 * 3600;
/** "Atualizar agora" da tela: no máximo a cada 5 minutos por loja. */
export const FINANCE_MANUAL_SECONDS = 300;
/** Vendas: os últimos 8 dias (limite do iFood por chamada). Repasses: 35 dias para trás e à frente. */
export const SALES_DAYS = 8;
export const PAYOUT_DAYS = 35;
/** Repasse pago pelo aplicativo há 2 dias ou mais e ainda aberto no Financeiro: baixa sozinho. */
export const PAID_GRACE_DAYS = 2;

const TZ = `COALESCE((SELECT timezone FROM tenants WHERE id = app_current_tenant()), 'America/Sao_Paulo')`;
const CATEGORY = 'Repasse de vendas';

interface StoreRow {
  id: string;
  channel: string;
  store_id: string;
  name: string;
  finance_at: Date | null;
}

interface PayoutRow {
  id: string;
  amount: string;
  expected_date: string;
  status: ChannelPayout['status'];
  entry_id: string | null;
  entry_status: 'open' | 'paid' | 'cancelled' | null;
  entry_amount: string | null;
  entry_due: string | null;
}

const ddmm = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

/** "Repasse iFood 03/11 a 09/11 · Loja Centro" (até 200 letras). */
export function payoutDescription(channel: string, p: ChannelPayout, store: string) {
  const label = channelInfo(channel).label;
  const what = /ANTECIP|ANTICIP/i.test(p.kind) ? 'Antecipação' : 'Repasse';
  const period =
    p.periodStart && p.periodEnd
      ? p.periodStart === p.periodEnd
        ? ` ${ddmm(p.periodStart)}`
        : ` ${ddmm(p.periodStart)} a ${ddmm(p.periodEnd)}`
      : '';
  return `${what} ${label}${period} · ${store}`.slice(0, 200);
}

/**
 * Repasse dos aplicativos (ADR 0015, Fase 7). Lê com calma a API financeira de cada loja (vendas
 * dos últimos 8 dias e repasses de 35 dias para trás e para a frente), grava o que cada pedido
 * rende e cada repasse, e mantém uma conta a receber "Repasse de vendas" por repasse no
 * Financeiro: fica fora do DRE (a venda já entrou pelo pedido) e a Conciliação bancária confere
 * com o extrato pelo valor e pela data. Nada de dado bancário: só período, data, valor e situação.
 */
@Injectable()
export class ChannelFinanceService implements OnModuleInit {
  private readonly logger = new Logger('ChannelsFinance');

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: ChannelRegistry,
    private readonly poller: ChannelPoller,
    private readonly stores: ChannelStoresService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    this.poller.onSweep((tenantId) => this.refreshTenant(tenantId));
  }

  private async ref(tenantId: string, r: StoreRow): Promise<StoreRef | null> {
    const claim = await this.db.withCentral({ tenantId }, (tx) =>
      one<{ credential: string }>(
        tx,
        `SELECT credential FROM channel_store_claims WHERE channel = $1 AND store_id = $2`,
        [r.channel, r.store_id],
      ),
    );
    return claim ? { tenantId, storeId: r.store_id, credential: claim.credential } : null;
  }

  /** Lê as lojas ligadas cuja última leitura passou de `maxAgeSeconds`. Devolve quantas leu. */
  async refreshTenant(tenantId: string, maxAgeSeconds = FINANCE_SWEEP_SECONDS) {
    const due = await this.db.withTenant({ tenantId }, (tx) =>
      q<StoreRow>(
        tx,
        `SELECT id, channel, store_id, name, finance_at FROM channel_stores
          WHERE status = 'connected'
            AND (finance_at IS NULL OR finance_at < now() - make_interval(secs => $1))
          ORDER BY channel, name`,
        [maxAgeSeconds],
      ),
    );
    let read = 0;
    for (const r of due) {
      const adapter = this.registry.get(r.channel);
      if (!adapter?.financePayouts && !adapter?.financeSales) continue;
      read++;
      await this.refreshStore(tenantId, r);
    }
    if (read) this.realtime.publish(tenantId, { type: 'channels.finance' });
    return read;
  }

  /** "Atualizar agora" da tela (no máximo a cada 5 minutos por loja). */
  async refreshNow(tenantId: string) {
    const read = await this.refreshTenant(tenantId, FINANCE_MANUAL_SECONDS);
    return { read };
  }

  private async refreshStore(tenantId: string, r: StoreRow) {
    const adapter = this.registry.get(r.channel)!;
    const ref = await this.ref(tenantId, r);
    if (!ref) return;
    try {
      const today = await this.db.withTenant({ tenantId }, (tx) =>
        one<{ d: string }>(
          tx,
          `SELECT to_char((now() AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS d`,
        ),
      );
      const d = today!.d;
      const payouts = adapter.financePayouts
        ? await adapter.financePayouts(ref, addDays(d, -PAYOUT_DAYS), addDays(d, PAYOUT_DAYS))
        : [];
      const sales = adapter.financeSales
        ? await adapter.financeSales(ref, addDays(d, -(SALES_DAYS - 1)), d)
        : [];
      await this.db.withTenant({ tenantId }, async (tx) => {
        await this.saveSales(tx, r.channel, sales);
        for (const p of payouts) await this.savePayout(tx, tenantId, r, p, d);
        await q(
          tx,
          `UPDATE channel_stores SET finance_at = now(), finance_error = NULL WHERE id = $1`,
          [r.id],
        );
      });
    } catch (e) {
      const err = e instanceof ChannelHttpError ? e : new ChannelHttpError(0, String(e));
      if (err.status === 403)
        await this.stores.markRevoked(tenantId, r.id, err.message).catch(() => undefined);
      this.logger.warn(`financeiro ${r.channel}: ${err.status || 'sem resposta'}`);
      await this.db.withTenant({ tenantId }, (tx) =>
        q(tx, `UPDATE channel_stores SET finance_at = now(), finance_error = $2 WHERE id = $1`, [
          r.id,
          `Não deu para ler o financeiro no aplicativo (${err.status || 'sem resposta'})`,
        ]),
      );
    }
  }

  /** O que cada pedido rende, nos pedidos que o Comandou recebeu (os outros são ignorados). */
  private async saveSales(tx: Tx, channel: string, sales: ChannelSaleFinance[]) {
    if (!sales.length) return;
    await q(
      tx,
      `UPDATE channel_orders co
          SET fin_gross = s.gross, fin_net = s.net, fin_fees = s.fees, fin_entries = s.entries,
              fin_at = now()
         FROM jsonb_to_recordset($2::jsonb)
              AS s(id text, gross numeric, net numeric, fees numeric, entries jsonb)
        WHERE co.channel = $1 AND co.external_id = s.id`,
      [
        channel,
        JSON.stringify(
          sales.map((s) => ({
            id: s.externalId,
            gross: s.gross,
            net: s.net,
            fees: s.fees,
            entries: s.entries,
          })),
        ),
      ],
    );
  }

  /**
   * Grava o repasse e mantém a conta a receber dele. A conta só é trocada enquanto está aberta
   * (valor ou data mudou: cancela a antiga e abre outra, porque valor e vencimento não se editam);
   * paga ou cancelada pela pessoa, fica como está.
   */
  private async savePayout(tx: Tx, tenantId: string, s: StoreRow, p: ChannelPayout, today: string) {
    const row = await one<PayoutRow>(
      tx,
      `INSERT INTO channel_payouts (tenant_id, channel, store_ref, store_id, external_id, kind,
                                    period_start, period_end, expected_date, amount, original_amount,
                                    original_date, anticipation_fee, status, channel_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (tenant_id, channel, external_id) DO UPDATE
          SET kind = EXCLUDED.kind, period_start = EXCLUDED.period_start,
              period_end = EXCLUDED.period_end, expected_date = EXCLUDED.expected_date,
              amount = EXCLUDED.amount, original_amount = EXCLUDED.original_amount,
              original_date = EXCLUDED.original_date, anticipation_fee = EXCLUDED.anticipation_fee,
              status = EXCLUDED.status, channel_status = EXCLUDED.channel_status,
              store_ref = EXCLUDED.store_ref, fetched_at = now()
       RETURNING id, amount::text, to_char(expected_date, 'YYYY-MM-DD') AS expected_date, status,
                 entry_id, NULL::text AS entry_status, NULL::text AS entry_amount,
                 NULL::text AS entry_due`,
      [
        tenantId,
        s.channel,
        s.id,
        s.store_id,
        p.externalId,
        p.kind,
        p.periodStart ?? null,
        p.periodEnd ?? null,
        p.expectedDate,
        p.amount,
        p.originalAmount ?? null,
        p.originalDate ?? null,
        p.anticipationFee ?? null,
        p.status,
        p.channelStatus ?? null,
      ],
    );
    const pr = row!;
    const entry = pr.entry_id
      ? await one<{ status: PayoutRow['entry_status']; amount: string; due: string }>(
          tx,
          `SELECT status, amount::text, to_char(due_date, 'YYYY-MM-DD') AS due
             FROM finance_entries WHERE id = $1`,
          [pr.entry_id],
        )
      : null;
    const wanted = p.status !== 'failed' && Number(p.amount) > 0;

    if (entry && entry.status !== 'open') return;
    if (entry && !wanted) {
      await q(
        tx,
        `UPDATE finance_entries SET status = 'cancelled', cancel_reason = $2 WHERE id = $1`,
        [
          pr.entry_id,
          p.status === 'failed'
            ? `O ${channelInfo(s.channel).label} avisou que o repasse não foi feito`
            : `O ${channelInfo(s.channel).label} zerou este repasse`,
        ],
      );
      return;
    }
    if (!wanted) return;

    let entryId = pr.entry_id;
    const same = entry && Number(entry.amount) === Number(p.amount) && entry.due === p.expectedDate;
    if (!same) {
      if (entry)
        await q(
          tx,
          `UPDATE finance_entries SET status = 'cancelled', cancel_reason = $2 WHERE id = $1`,
          [pr.entry_id, `O ${channelInfo(s.channel).label} mudou o valor ou a data do repasse`],
        );
      const created = await one<{ id: string }>(
        tx,
        `INSERT INTO finance_entries (tenant_id, kind, description, category, counterparty, amount, due_date)
         VALUES ($1, 'receivable', $2, $3, $4, $5, $6) RETURNING id`,
        [
          tenantId,
          payoutDescription(s.channel, p, s.name),
          CATEGORY,
          channelInfo(s.channel).label,
          p.amount,
          p.expectedDate,
        ],
      );
      entryId = created!.id;
      await q(tx, `UPDATE channel_payouts SET entry_id = $2 WHERE id = $1`, [pr.id, entryId]);
    }
    // Pago pelo aplicativo há uns dias e ninguém conferiu: dá baixa na data do pagamento. A
    // Conciliação bancária ainda liga a linha do extrato a esta conta paga.
    if (p.status === 'paid' && p.expectedDate <= addDays(today, -PAID_GRACE_DAYS))
      await q(
        tx,
        `UPDATE finance_entries SET status = 'paid', paid_at = $2, paid_method = 'transfer'
          WHERE id = $1 AND status = 'open'`,
        [entryId, p.expectedDate],
      );
  }

  /** Aba "Aplicativos" do Financeiro: repasses do período, o que os pedidos renderam e as lojas. */
  async summary(tenantId: string, from: string, to: string) {
    if (from > to) throw new BadRequestException('Período inválido');
    return this.db.withTenant({ tenantId }, async (tx) => {
      const payouts = await q(
        tx,
        `SELECT p.id, p.channel, s.name AS "storeName", p.kind,
                to_char(p.period_start, 'YYYY-MM-DD') AS "periodStart",
                to_char(p.period_end, 'YYYY-MM-DD') AS "periodEnd",
                to_char(p.expected_date, 'YYYY-MM-DD') AS "expectedDate",
                p.amount::text, p.original_amount::text AS "originalAmount",
                to_char(p.original_date, 'YYYY-MM-DD') AS "originalDate",
                p.anticipation_fee::text AS "anticipationFee", p.status,
                p.entry_id AS "entryId", e.status AS "entryStatus",
                EXISTS (SELECT 1 FROM bank_reconciliations br WHERE br.entry_id = p.entry_id) AS reconciled
           FROM channel_payouts p
           LEFT JOIN channel_stores s ON s.id = p.store_ref
           LEFT JOIN finance_entries e ON e.id = p.entry_id
          WHERE p.expected_date BETWEEN $1 AND $2
          ORDER BY p.expected_date DESC, p.channel, s.name
          LIMIT 300`,
        [from, to],
      );
      const sales = await q(
        tx,
        `SELECT co.channel, count(*)::int AS orders,
                count(*) FILTER (WHERE co.fin_net IS NOT NULL)::int AS closed,
                COALESCE(sum(co.customer_total), 0)::text AS "customerTotal",
                COALESCE(sum(co.fin_gross) FILTER (WHERE co.fin_net IS NOT NULL), 0)::text AS gross,
                COALESCE(sum(co.fin_fees), 0)::text AS fees,
                COALESCE(sum(co.fin_net), 0)::text AS net
           FROM channel_orders co JOIN orders o ON o.id = co.order_id
          WHERE (o.created_at AT TIME ZONE ${TZ})::date BETWEEN $1 AND $2
            AND o.status NOT IN ('awaiting','cancelled')
          GROUP BY co.channel ORDER BY co.channel`,
        [from, to],
      );
      const stores = await q(
        tx,
        `SELECT id, channel, name, finance_at AS "financeAt", finance_error AS "financeError"
           FROM channel_stores WHERE status = 'connected' ORDER BY channel, name`,
      );
      return {
        payouts,
        sales,
        stores: stores.filter((s) => {
          const a = this.registry.get((s as { channel: string }).channel);
          return !!(a?.financePayouts || a?.financeSales);
        }),
      };
    });
  }

  /** O que um pedido de aplicativo rende (para a gaveta do pedido, com permissão do Financeiro). */
  async order(tenantId: string, orderId: string) {
    const r = await this.db.withTenant({ tenantId }, (tx) =>
      one(
        tx,
        `SELECT channel, fin_gross::text AS gross, fin_net::text AS net, fin_fees::text AS fees,
                fin_entries AS entries, fin_at AS "updatedAt"
           FROM channel_orders WHERE order_id = $1`,
        [orderId],
      ),
    );
    if (!r) throw new NotFoundException('Pedido de aplicativo não encontrado');
    return r;
  }
}
