import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CHANNEL_LABELS, OrderChannel } from '@pedemais/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashToken } from '../auth/session.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';

/** Tempo que um agente tem para confirmar a impressão antes de o trabalho voltar para a fila. */
export const PRINT_LEASE_SECONDS = 60;
export const PRINT_MAX_ATTEMPTS = 5;
const WIDTH = 42;

export const JOB_SELECT = `
  SELECT j.id, j.kind, j.target, j.status, j.attempts, j.order_id AS "orderId", o.number AS "orderNumber",
         j.last_error AS "lastError", j.created_at AS "createdAt", j.done_at AS "doneAt",
         a.name AS "agentName"
    FROM print_jobs j
    LEFT JOIN orders o ON o.id = j.order_id
    LEFT JOIN print_agents a ON a.id = j.claimed_by`;

interface TicketItem {
  name: string;
  quantity: string;
  notes: string | null;
  options: string[];
}

const line = (ch = '-') => ch.repeat(WIDTH);
const center = (s: string) => {
  const t = s.slice(0, WIDTH);
  return ' '.repeat(Math.floor((WIDTH - t.length) / 2)) + t;
};
const fmtQty = (q: string) => q.replace(/\.?0+$/, '');
const wrap = (s: string, indent = '') => {
  const out: string[] = [];
  let cur = '';
  for (const w of s.split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > WIDTH - indent.length) {
      out.push(indent + cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(indent + cur);
  return out;
};

/**
 * Fila de impressão. Os trabalhos ficam no banco (fonte da verdade) e o agente local de cada
 * restaurante busca, imprime e confirma. A impressão nunca bloqueia o pedido: se não houver
 * agente ativo, nada é enfileirado; se a impressora falhar, o trabalho volta para a fila
 * (até PRINT_MAX_ATTEMPTS) e aparece como falha na tela de impressão.
 */
@Injectable()
export class PrintingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService,
  ) {}

  newAgentToken() {
    const token = `pma_${randomBytes(32).toString('base64url')}`;
    return { token, hash: hashToken(token) };
  }

  private async hasActiveAgent(tx: Tx) {
    return !!(await one(tx, `SELECT 1 FROM print_agents WHERE active LIMIT 1`));
  }

  private async orderHeader(tx: Tx, orderId: string) {
    const o = await one<{
      number: number;
      channel: OrderChannel;
      customer_name: string | null;
      tab_number: number | null;
      table_label: string | null;
      notes: string | null;
      created_at: Date;
      timezone: string;
      total: string;
      delivery_address: string | null;
      customer_phone: string | null;
      local_time: string;
    }>(
      tx,
      `SELECT o.number, o.channel, o.customer_name, tb.number AS tab_number, dt.label AS table_label, o.notes,
              o.total::text, o.delivery_address, o.customer_phone,
              to_char(o.created_at AT TIME ZONE t.timezone, 'DD/MM HH24:MI') AS local_time
         FROM orders o JOIN tenants t ON t.id = o.tenant_id
         LEFT JOIN tabs tb ON tb.id = o.tab_id LEFT JOIN dining_tables dt ON dt.id = tb.table_id
        WHERE o.id = $1`,
      [orderId],
    );
    if (!o) throw new NotFoundException('Pedido não encontrado');
    return o;
  }

  private async items(tx: Tx, orderId: string, sectorId?: string | null) {
    return q<TicketItem & { sector_id: string | null; sector_name: string | null; total: string }>(
      tx,
      `SELECT i.name, i.quantity::text, i.notes, i.total::text, i.sector_id, s.name AS sector_name,
              COALESCE((SELECT array_agg(io.name ORDER BY io.name) FROM order_item_options io WHERE io.order_item_id = i.id), '{}') AS options
         FROM order_items i LEFT JOIN production_sectors s ON s.id = i.sector_id
        WHERE i.order_id = $1 AND i.status <> 'cancelled'
          AND ($2::boolean IS FALSE OR i.sector_id IS NOT DISTINCT FROM $3::uuid)
        ORDER BY i.created_at, i.id`,
      [orderId, sectorId !== undefined, sectorId ?? null],
    );
  }

  private async kitchenTicket(
    tx: Tx,
    orderId: string,
    sectorId: string | null,
    sectorName: string,
  ) {
    const o = await this.orderHeader(tx, orderId);
    const items = await this.items(tx, orderId, sectorId);
    const where = o.table_label
      ? `Mesa ${o.table_label}`
      : o.tab_number
        ? `Comanda ${o.tab_number}`
        : CHANNEL_LABELS[o.channel];
    const out = [
      center(sectorName.toUpperCase()),
      line('='),
      `PEDIDO #${o.number}`.padEnd(WIDTH - 11) + o.local_time.padStart(11),
      where + (o.customer_name ? ` - ${o.customer_name}` : ''),
      line(),
    ];
    for (const i of items) {
      out.push(...wrap(`${fmtQty(i.quantity)}x ${i.name}`));
      for (const op of i.options) out.push(...wrap(`+ ${op}`, '   '));
      if (i.notes) out.push(...wrap(`OBS: ${i.notes}`, '   '));
    }
    if (o.notes) out.push(line(), ...wrap(`OBS DO PEDIDO: ${o.notes}`));
    out.push(line('='));
    return { text: out.join('\n'), count: items.length };
  }

  private async receipt(tx: Tx, orderId: string) {
    const o = await this.orderHeader(tx, orderId);
    const items = await this.items(tx, orderId);
    const money = (v: string) => `R$ ${v.replace('.', ',')}`;
    const out = [center('CONFERÊNCIA DE CONTA'), center('NÃO É DOCUMENTO FISCAL'), line('=')];
    out.push(`PEDIDO #${o.number}`.padEnd(WIDTH - 11) + o.local_time.padStart(11));
    if (o.customer_name) out.push(`Cliente: ${o.customer_name}`);
    if (o.channel === 'delivery') {
      if (o.customer_phone) out.push(`Tel: ${o.customer_phone}`);
      if (o.delivery_address) out.push(...wrap(`Entrega: ${o.delivery_address}`));
    }
    out.push(line());
    for (const i of items) {
      const left = `${fmtQty(i.quantity)}x ${i.name}`.slice(0, WIDTH - 13);
      out.push(left.padEnd(WIDTH - 12) + money(i.total).padStart(12));
      for (const op of i.options) out.push(...wrap(`+ ${op}`, '   '));
    }
    out.push(line(), 'TOTAL'.padEnd(WIDTH - 14) + money(o.total).padStart(14), line('='));
    return out.join('\n');
  }

  /** Enfileira as comandas de cozinha de um pedido novo, uma por setor. Sem agente ativo, não faz nada. */
  async enqueueKitchenTickets(tx: Tx, ctx: Ctx, orderId: string): Promise<number> {
    if (!(await this.hasActiveAgent(tx))) return 0;
    const sectors = await q<{ sector_id: string | null; name: string | null }>(
      tx,
      `SELECT DISTINCT i.sector_id, s.name FROM order_items i LEFT JOIN production_sectors s ON s.id = i.sector_id
        WHERE i.order_id = $1 AND i.status <> 'cancelled'`,
      [orderId],
    );
    let n = 0;
    for (const s of sectors) {
      const name = s.name ?? 'Cozinha';
      const t = await this.kitchenTicket(tx, orderId, s.sector_id, name);
      if (!t.count) continue;
      const r = await one(
        tx,
        `INSERT INTO print_jobs (tenant_id, dedupe_key, kind, target, order_id, payload, created_by)
         VALUES ($1,$2,'kitchen_ticket',$3,$4,$5,$6) ON CONFLICT (tenant_id, dedupe_key) DO NOTHING RETURNING id`,
        [
          ctx.tenantId,
          `order:${orderId}:sector:${s.sector_id ?? 'none'}`,
          name.slice(0, 60),
          orderId,
          t.text,
          ctx.userId,
        ],
      );
      if (r) n++;
    }
    return n;
  }

  /** Reimpressão (comanda de cozinha) ou conferência de conta, sob demanda. */
  async printOrder(ctx: Ctx, orderId: string, kind: 'kitchen' | 'receipt') {
    const res = await this.db.withTenant(ctx, async (tx) => {
      if (!(await this.hasActiveAgent(tx)))
        throw new ConflictException('Nenhum agente de impressão ativo. Configure em Impressão.');
      const o = await one(tx, `SELECT id FROM orders WHERE id = $1`, [orderId]);
      if (!o) throw new NotFoundException('Pedido não encontrado');
      const jobs: { target: string; payload: string; kind: string }[] = [];
      if (kind === 'receipt') {
        jobs.push({ target: 'Caixa', payload: await this.receipt(tx, orderId), kind: 'receipt' });
      } else {
        const sectors = await q<{ sector_id: string | null; name: string | null }>(
          tx,
          `SELECT DISTINCT i.sector_id, s.name FROM order_items i LEFT JOIN production_sectors s ON s.id = i.sector_id
            WHERE i.order_id = $1 AND i.status <> 'cancelled'`,
          [orderId],
        );
        for (const s of sectors) {
          const name = s.name ?? 'Cozinha';
          const t = await this.kitchenTicket(tx, orderId, s.sector_id, name);
          if (t.count)
            jobs.push({
              target: name,
              payload: `*** REIMPRESSÃO ***\n${t.text}`,
              kind: 'kitchen_ticket',
            });
        }
      }
      const ids: string[] = [];
      for (const j of jobs) {
        const r = await one<{ id: string }>(
          tx,
          `INSERT INTO print_jobs (tenant_id, dedupe_key, kind, target, order_id, payload, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            ctx.tenantId,
            `order:${orderId}:${j.kind}:${randomUUID()}`,
            j.kind,
            j.target.slice(0, 60),
            orderId,
            j.payload,
            ctx.userId,
          ],
        );
        ids.push(r!.id);
      }
      return q(tx, `${JOB_SELECT} WHERE j.id = ANY($1::uuid[])`, [ids]);
    });
    this.realtime.publish(ctx.tenantId, { type: 'print.changed' });
    return res;
  }

  async testPage(ctx: Ctx, target: string) {
    const res = await this.db.withTenant(ctx, async (tx) => {
      const text = [
        center('PEDEMAIS'),
        center('Teste de impressão'),
        line(),
        `Destino: ${target}`,
        line(),
      ].join('\n');
      const r = await one<{ id: string }>(
        tx,
        `INSERT INTO print_jobs (tenant_id, dedupe_key, kind, target, payload, created_by)
         VALUES ($1,$2,'test',$3,$4,$5) RETURNING id`,
        [ctx.tenantId, `test:${randomUUID()}`, target, text, ctx.userId],
      );
      return one(tx, `${JOB_SELECT} WHERE j.id = $1`, [r!.id]);
    });
    this.realtime.publish(ctx.tenantId, { type: 'print.changed' });
    return res;
  }

  // ----------------------------------------------------------- lado do agente
  /** Identifica o agente pelo token (só o hash fica no banco). */
  async agentFor(tenantId: string, token: string) {
    if (!token || token.length > 200) return undefined;
    return this.db.withTenant({ tenantId }, (tx) =>
      one<{ id: string; name: string }>(
        tx,
        `SELECT id, name FROM print_agents WHERE token_hash = $1 AND active`,
        [hashToken(token)],
      ),
    );
  }

  heartbeat(tenantId: string, agentId: string, ip: string | undefined, version?: string) {
    return this.db.withTenant({ tenantId }, (tx) =>
      q(
        tx,
        `UPDATE print_agents SET last_seen_at = now(), last_ip = $2, version = COALESCE($3, version) WHERE id = $1`,
        [agentId, ip ?? null, version ?? null],
      ),
    );
  }

  /**
   * Reserva até `limit` trabalhos. SKIP LOCKED: dois agentes nunca pegam o mesmo trabalho.
   * Trabalho reservado e não confirmado em PRINT_LEASE_SECONDS volta a ficar disponível.
   */
  async claim(tenantId: string, agentId: string, limit: number) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      await q(tx, `UPDATE print_agents SET last_seen_at = now() WHERE id = $1`, [agentId]);
      await q(
        tx,
        `UPDATE print_jobs SET status = 'failed', last_error = 'Sem confirmação do agente'
          WHERE status = 'printing' AND claimed_at < now() - make_interval(secs => $1) AND attempts >= $2`,
        [PRINT_LEASE_SECONDS, PRINT_MAX_ATTEMPTS],
      );
      return q(
        tx,
        `UPDATE print_jobs SET status = 'printing', attempts = attempts + 1, claimed_by = $1, claimed_at = now()
          WHERE id IN (
            SELECT id FROM print_jobs
             WHERE attempts < $3
               AND (status = 'queued' OR (status = 'printing' AND claimed_at < now() - make_interval(secs => $4)))
             ORDER BY created_at, id LIMIT $2 FOR UPDATE SKIP LOCKED)
          RETURNING id, kind, target, payload, attempts`,
        [agentId, limit, PRINT_MAX_ATTEMPTS, PRINT_LEASE_SECONDS],
      );
    });
  }

  async result(tenantId: string, agentId: string, jobId: string, ok: boolean, error?: string) {
    const r = await this.db.withTenant({ tenantId }, (tx) =>
      one(
        tx,
        `UPDATE print_jobs
            SET status = CASE WHEN $3 THEN 'done' WHEN attempts >= $5 THEN 'failed' ELSE 'queued' END,
                done_at = CASE WHEN $3 THEN now() ELSE NULL END,
                last_error = CASE WHEN $3 THEN NULL ELSE $4 END
          WHERE id = $1 AND claimed_by = $2 AND status = 'printing'
          RETURNING id, status`,
        [jobId, agentId, ok, error?.slice(0, 300) ?? 'Falha na impressora', PRINT_MAX_ATTEMPTS],
      ),
    );
    if (!r) throw new ConflictException('Trabalho não está reservado para este agente');
    this.realtime.publish(tenantId, { type: 'print.changed' });
    return r;
  }
}
