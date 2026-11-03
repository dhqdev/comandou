import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CHANNEL_LABELS,
  fromCents,
  OrderChannel,
  PAYMENT_METHOD_LABELS,
  PaymentMethod,
  toCents,
} from '@comandou/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashToken } from '../auth/session.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Linha especial do texto de impressão: o agente troca por um QR Code ESC/POS nativo.
 * Agentes antigos imprimem a linha como texto (o endereço continua legível).
 */
export const QR_MARK = '@@QR@@';

/** Forma de pagamento da NFC-e (código tPag) em palavras, como no DANFE. */
const TPAG_LABELS: Record<string, string> = {
  '01': 'Dinheiro',
  '02': 'Cheque',
  '03': 'Cartão de Crédito',
  '04': 'Cartão de Débito',
  '05': 'Crédito Loja',
  '10': 'Vale Alimentação',
  '11': 'Vale Refeição',
  '15': 'Boleto',
  '17': 'PIX',
  '90': 'Sem pagamento',
  '99': 'Outros',
};

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
      subtotal: string;
      discount: string;
      surcharge: string;
      delivery_fee: string;
      payment_hint: PaymentMethod | null;
      change_for: string | null;
    }>(
      tx,
      `SELECT o.number, o.channel, o.customer_name, tb.number AS tab_number, dt.label AS table_label, o.notes,
              o.total::text, o.delivery_address, o.customer_phone,
              o.subtotal::text, o.discount::text, o.surcharge::text, o.delivery_fee::text,
              o.payment_hint, o.change_for::text,
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
    const paid = await q<{ method: PaymentMethod; amount: string; tendered: string | null }>(
      tx,
      `SELECT method, (amount - refunded_amount)::text AS amount, tendered::text
         FROM payments WHERE order_id = $1 AND amount > refunded_amount ORDER BY created_at`,
      [orderId],
    );
    const money = (v: string) => `R$ ${Number(v).toFixed(2).replace('.', ',')}`;
    const row = (label: string, v: string) =>
      label.slice(0, WIDTH - 15).padEnd(WIDTH - 14) + money(v).padStart(14);
    const nonZero = (v: string) => Number(v) > 0;
    const out = [center('CONFERÊNCIA DE CONTA'), center('NÃO É DOCUMENTO FISCAL'), line('=')];
    out.push(`PEDIDO #${o.number}`.padEnd(WIDTH - 11) + o.local_time.padStart(11));
    const where = o.table_label
      ? `Mesa ${o.table_label}`
      : o.tab_number
        ? `Comanda ${o.tab_number}`
        : CHANNEL_LABELS[o.channel];
    out.push(where);
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
      if (i.notes) out.push(...wrap(`OBS: ${i.notes}`, '   '));
    }
    out.push(line());
    // Quebra do total: o entregador e o caixa conferem cada parte do valor.
    const extras = [o.discount, o.surcharge, o.delivery_fee].some(nonZero);
    if (extras) out.push(row('Subtotal', o.subtotal));
    if (nonZero(o.discount)) out.push(row('Desconto', `-${o.discount}`));
    if (nonZero(o.surcharge)) out.push(row('Acréscimo', o.surcharge));
    if (nonZero(o.delivery_fee)) out.push(row('Taxa de entrega', o.delivery_fee));
    out.push(row('TOTAL', o.total));
    if (paid.length) {
      out.push(line());
      let received = 0;
      for (const p of paid) {
        received += Number(p.amount);
        out.push(row(`Pago (${PAYMENT_METHOD_LABELS[p.method] ?? p.method})`, p.amount));
        if (p.tendered && Number(p.tendered) > Number(p.amount))
          out.push(row('  Troco', String(Number(p.tendered) - Number(p.amount))));
      }
      const due = Number(o.total) - received;
      if (due > 0.004) out.push(row('FALTA PAGAR', String(due)));
    } else if (o.payment_hint) {
      out.push(line(), `Pagamento na entrega: ${PAYMENT_METHOD_LABELS[o.payment_hint]}`);
      if (o.payment_hint === 'cash' && o.change_for && Number(o.change_for) > Number(o.total)) {
        out.push(row('Troco para', o.change_for));
        out.push(row('Levar de troco', String(Number(o.change_for) - Number(o.total))));
      }
    }
    if (o.notes) out.push(line(), ...wrap(`OBS DO PEDIDO: ${o.notes}`));
    out.push(line('='));
    return out.join('\n');
  }

  /**
   * DANFE da NFC-e em 42 colunas (leiaute do Manual do DANFE NFC-e, versão resumida para bobina):
   * emitente, itens, totais, pagamentos, chave de acesso, consumidor, número/protocolo e QR Code.
   */
  async fiscalReceipt(tx: Tx, documentId: string): Promise<string | null> {
    const d = await one<{
      kind: string;
      status: string;
      environment: string;
      payload: {
        items?: Record<string, string>[];
        formas_pagamento?: { forma_pagamento: string; valor_pagamento: string }[];
        cpf_destinatario?: string;
        cnpj_destinatario?: string;
        nome_destinatario?: string;
        logradouro_destinatario?: string;
        numero_destinatario?: string;
        bairro_destinatario?: string;
        municipio_destinatario?: string;
        uf_destinatario?: string;
      };
      access_key: string | null;
      number: string | null;
      series: string | null;
      protocol: string | null;
      qrcode_url: string | null;
      consult_url: string | null;
      authorized: string | null;
      total: string;
      cnpj: string | null;
      company: Record<string, string> | null;
    }>(
      tx,
      `SELECT d.kind, d.status, d.environment, d.request_payload AS payload, d.access_key, d.number, d.series,
              d.protocol, d.qrcode_url, d.consult_url, d.total::text,
              to_char(d.authorized_at AT TIME ZONE t.timezone, 'DD/MM/YYYY HH24:MI:SS') AS authorized,
              s.cnpj, s.company
         FROM fiscal_documents d JOIN tenants t ON t.id = d.tenant_id
         LEFT JOIN tenant_fiscal_settings s ON s.tenant_id = d.tenant_id
        WHERE d.id = $1`,
      [documentId],
    );
    if (!d || d.kind !== 'nfce' || d.status !== 'authorized') return null;
    const brl = (cents: number) => fromCents(cents).replace('.', ',');
    const cents = (v: string | undefined) => (v ? toCents(v) : 0);
    const row = (label: string, v: string) =>
      label.slice(0, WIDTH - 15).padEnd(WIDTH - 14) + v.padStart(14);
    const c = d.company ?? {};
    const cnpj = (d.cnpj ?? '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    const out: string[] = [];
    out.push(...wrap(String(c.nomeFantasia || c.nome || '')).map(center));
    if (c.nomeFantasia && c.nome) out.push(...wrap(String(c.nome)).map(center));
    out.push(center(`CNPJ ${cnpj}${c.inscricaoEstadual ? ` IE ${c.inscricaoEstadual}` : ''}`));
    const addr = [
      [c.logradouro, c.numero].filter(Boolean).join(', '),
      c.bairro,
      [c.municipio, c.uf].filter(Boolean).join('/'),
    ]
      .filter(Boolean)
      .join(' - ');
    if (addr) out.push(...wrap(addr).map(center));
    out.push(line('='));
    out.push(center('DANFE NFC-e - Documento Auxiliar da Nota'));
    out.push(center('Fiscal de Consumidor Eletrônica'));
    if (d.environment !== 'producao') {
      out.push(center('EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO'));
      out.push(center('SEM VALOR FISCAL'));
    }
    out.push(line());
    out.push('#  DESCRIÇÃO                                '.slice(0, WIDTH));
    out.push('   QTD UN x VL UNIT                 VL TOTAL'.slice(0, WIDTH));
    out.push(line());
    let gross = 0;
    let discount = 0;
    let other = 0;
    let taxes = 0;
    const items = d.payload.items ?? [];
    for (const i of items) {
      const total = cents(i.valor_bruto);
      gross += total;
      discount += cents(i.valor_desconto);
      other += cents(i.valor_outras_despesas) + cents(i.valor_frete);
      taxes += cents(i.valor_total_tributos);
      out.push(...wrap(`${i.numero_item} ${i.codigo_produto?.slice(0, 8) ?? ''} ${i.descricao}`));
      const unit = Number(i.valor_unitario_comercial ?? 0)
        .toFixed(2)
        .replace('.', ',');
      out.push(
        `   ${fmtQty(i.quantidade_comercial ?? '1')} ${i.unidade_comercial ?? 'UN'} x ${unit}`.padEnd(
          WIDTH - 12,
        ) + brl(total).padStart(12),
      );
    }
    out.push(line());
    out.push(row('Qtde. total de itens', String(items.length)));
    out.push(row('Valor total R$', brl(gross)));
    if (discount) out.push(row('Descontos R$', brl(discount)));
    if (other) out.push(row('Acréscimos R$', brl(other)));
    out.push(row('Valor a pagar R$', brl(gross - discount + other)));
    out.push(row('FORMA DE PAGAMENTO', 'VALOR PAGO R$'));
    for (const p of d.payload.formas_pagamento ?? [])
      out.push(
        row(TPAG_LABELS[p.forma_pagamento] ?? p.forma_pagamento, brl(cents(p.valor_pagamento))),
      );
    out.push(line());
    out.push(center('Consulte pela Chave de Acesso em'));
    if (d.consult_url) out.push(...wrap(d.consult_url).map(center));
    const key = (d.access_key ?? '').replace(/\D/g, '');
    if (key) out.push(...wrap(key.replace(/(\d{4})(?=\d)/g, '$1 ')).map(center));
    out.push(line());
    const doc = d.payload.cnpj_destinatario
      ? `CNPJ ${d.payload.cnpj_destinatario}`
      : d.payload.cpf_destinatario
        ? `CPF ${d.payload.cpf_destinatario.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')}`
        : null;
    if (!doc) out.push(center('CONSUMIDOR NÃO IDENTIFICADO'));
    else {
      out.push(
        ...wrap(
          `CONSUMIDOR - ${doc}${d.payload.nome_destinatario ? ` - ${d.payload.nome_destinatario}` : ''}`,
        ).map(center),
      );
      const dest = [
        [d.payload.logradouro_destinatario, d.payload.numero_destinatario]
          .filter(Boolean)
          .join(', '),
        d.payload.bairro_destinatario,
        [d.payload.municipio_destinatario, d.payload.uf_destinatario].filter(Boolean).join('/'),
      ]
        .filter(Boolean)
        .join(' - ');
      if (dest) out.push(...wrap(dest).map(center));
    }
    out.push(line());
    out.push(
      center(`NFC-e nº ${d.number ?? '-'} Série ${d.series ?? '-'} ${d.authorized ?? ''}`.trim()),
    );
    if (d.protocol) out.push(center(`Protocolo de autorização: ${d.protocol}`));
    if (d.authorized) out.push(center(`Data de autorização: ${d.authorized}`));
    if (d.qrcode_url) out.push(`${QR_MARK}${d.qrcode_url}`);
    if (taxes)
      out.push(
        ...wrap(`Tributos totais incidentes (Lei Federal 12.741/2012): R$ ${brl(taxes)}`).map(
          center,
        ),
      );
    out.push(line('='));
    return out.join('\n');
  }

  /**
   * Cupom da NFC-e autorizada na impressora do caixa. Automático só uma vez por nota; a
   * reimpressão (pela tela) sempre gera um trabalho novo. Sem agente ativo, não faz nada.
   */
  async enqueueFiscalReceipt(
    tenantId: string,
    documentId: string,
    by: string | null,
    reprint = false,
  ): Promise<boolean> {
    const queued = await this.db.withTenant({ tenantId }, async (tx) => {
      if (!(await this.hasActiveAgent(tx))) {
        if (reprint)
          throw new ConflictException('Nenhum agente de impressão ativo. Configure em Impressão.');
        return false;
      }
      const text = await this.fiscalReceipt(tx, documentId);
      if (!text) {
        if (reprint) throw new ConflictException('Só NFC-e autorizada tem cupom para imprimir');
        return false;
      }
      const order = await one<{ order_id: string }>(
        tx,
        `SELECT order_id FROM fiscal_documents WHERE id = $1`,
        [documentId],
      );
      const r = await one(
        tx,
        `INSERT INTO print_jobs (tenant_id, dedupe_key, kind, target, order_id, payload, created_by)
         VALUES ($1,$2,'fiscal_receipt','Caixa',$3,$4,$5) ON CONFLICT (tenant_id, dedupe_key) DO NOTHING RETURNING id`,
        [
          tenantId,
          reprint ? `fiscal:${documentId}:${randomUUID()}` : `fiscal:${documentId}`,
          order?.order_id ?? null,
          reprint ? `*** 2ª VIA ***\n${text}` : text,
          by,
        ],
      );
      return !!r;
    });
    if (queued) this.realtime.publish(tenantId, { type: 'print.changed' });
    return queued;
  }

  /** Aviso de item cancelado para o setor que produz o item (a cozinha para de fazer). */
  async enqueueItemCancel(
    tx: Tx,
    ctx: Ctx,
    orderId: string,
    itemId: string,
    reason: string,
  ): Promise<number> {
    if (!(await this.hasActiveAgent(tx))) return 0;
    const i = await one<{
      name: string;
      quantity: string;
      sector: string | null;
      options: string[];
    }>(
      tx,
      `SELECT i.name, i.quantity::text, s.name AS sector,
              COALESCE((SELECT array_agg(io.name ORDER BY io.name) FROM order_item_options io WHERE io.order_item_id = i.id), '{}') AS options
         FROM order_items i LEFT JOIN production_sectors s ON s.id = i.sector_id WHERE i.id = $1`,
      [itemId],
    );
    if (!i) return 0;
    const o = await this.orderHeader(tx, orderId);
    const where = o.table_label
      ? `Mesa ${o.table_label}`
      : o.tab_number
        ? `Comanda ${o.tab_number}`
        : CHANNEL_LABELS[o.channel];
    const text = [
      center('*** ITEM CANCELADO ***'),
      center((i.sector ?? 'Cozinha').toUpperCase()),
      line('='),
      `PEDIDO #${o.number}`.padEnd(WIDTH - 11) + o.local_time.padStart(11),
      where,
      line(),
      ...wrap(`${fmtQty(i.quantity)}x ${i.name}`),
      ...i.options.flatMap((op) => wrap(`+ ${op}`, '   ')),
      ...wrap(`MOTIVO: ${reason}`),
      line('='),
    ].join('\n');
    const r = await one(
      tx,
      `INSERT INTO print_jobs (tenant_id, dedupe_key, kind, target, order_id, payload, created_by)
       VALUES ($1,$2,'kitchen_cancel',$3,$4,$5,$6) ON CONFLICT (tenant_id, dedupe_key) DO NOTHING RETURNING id`,
      [
        ctx.tenantId,
        `order:${orderId}:item:${itemId}:cancel`,
        (i.sector ?? 'Cozinha').slice(0, 60),
        orderId,
        text,
        ctx.userId,
      ],
    );
    return r ? 1 : 0;
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
        center('COMANDOU'),
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

  /** Destinos possíveis (setores de produção ativos + "Caixa"), para o aplicativo listar as impressoras. */
  async targets(tenantId: string) {
    const rows = await this.db.withTenant({ tenantId }, (tx) =>
      q<{ name: string }>(tx, `SELECT name FROM production_sectors WHERE active ORDER BY name`),
    );
    return [...new Set([...rows.map((r) => r.name.slice(0, 60)), 'Cozinha', 'Caixa'])];
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
