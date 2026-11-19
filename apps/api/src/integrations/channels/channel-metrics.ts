import { Injectable } from '@nestjs/common';
import { Counter, Gauge } from 'prom-client';
import { Metrics } from '../../health/metrics';

/** Métricas guardadas por hora no banco central (tabela channel_usage, migração 0096). */
export type UsageMetric = 'request' | 'poll' | 'poll_acked' | 'event' | 'ack' | 'order_lookup';
export interface UsageRow {
  channel: string;
  hour: string;
  metric: UsageMetric;
  label: string;
  count: number;
}

/**
 * Métricas dos aplicativos de delivery. Rótulos só com o canal, o endpoint (nome fixo, sem ids)
 * e o resultado: nada de loja, pedido ou cliente (privacidade e cardinalidade).
 * Os alertas ficam em infrastructure/monitoring/alerts.yml ("polling parado" é o crítico).
 */
@Injectable()
export class ChannelMetrics {
  /** Chamadas aos canais por endpoint e resultado (2xx, 4xx, 401, 429, 5xx, rede). */
  readonly requests: Counter<'channel' | 'endpoint' | 'result'>;
  /** Último polling bem-sucedido (epoch). Começa na hora em que a réplica sobe. */
  readonly lastPoll: Gauge<'channel'>;
  /** Lojas que recebem pedidos (o alerta de polling parado só vale com loja ligada). */
  readonly pollStores: Gauge<'channel'>;
  readonly pollErrors: Counter<'channel'>;
  /** Eventos recebidos: gravado, repetido, de loja desconhecida, banco indisponível. */
  readonly events: Counter<'channel' | 'result'>;
  readonly acks: Counter<'channel' | 'result'>;
  /** Eventos tratados: feito, ignorado, nova tentativa, falhou de vez. */
  readonly processed: Counter<'channel' | 'result'>;
  /** Ações enviadas: enviada, nova tentativa, falhou. */
  readonly outbox: Counter<'channel' | 'result'>;
  /** Consulta de pedido negada pelo limite de 10 por pedido. */
  readonly lookupsBlocked: Counter<'channel'>;
  readonly lastEvent: Gauge<'channel'>;

  constructor(m: Metrics) {
    const r = [m.registry];
    this.requests = new Counter({
      name: 'comandou_channel_requests_total',
      help: 'Chamadas aos aplicativos de delivery por endpoint e resultado',
      labelNames: ['channel', 'endpoint', 'result'],
      registers: r,
    });
    this.lastPoll = new Gauge({
      name: 'comandou_channel_poll_last_success_timestamp_seconds',
      help: 'Último polling bem-sucedido por canal (epoch)',
      labelNames: ['channel'],
      registers: r,
    });
    this.pollStores = new Gauge({
      name: 'comandou_channel_poll_stores',
      help: 'Lojas recebendo pedidos por canal',
      labelNames: ['channel'],
      registers: r,
    });
    this.pollErrors = new Counter({
      name: 'comandou_channel_poll_errors_total',
      help: 'Pollings que falharam',
      labelNames: ['channel'],
      registers: r,
    });
    this.events = new Counter({
      name: 'comandou_channel_events_total',
      help: 'Eventos recebidos dos aplicativos por resultado',
      labelNames: ['channel', 'result'],
      registers: r,
    });
    this.acks = new Counter({
      name: 'comandou_channel_acks_total',
      help: 'Confirmações de recebimento (ack) por resultado',
      labelNames: ['channel', 'result'],
      registers: r,
    });
    this.processed = new Counter({
      name: 'comandou_channel_events_processed_total',
      help: 'Eventos tratados pela caixa de entrada por resultado',
      labelNames: ['channel', 'result'],
      registers: r,
    });
    this.outbox = new Counter({
      name: 'comandou_channel_outbox_total',
      help: 'Ações enviadas aos aplicativos por resultado',
      labelNames: ['channel', 'result'],
      registers: r,
    });
    this.lookupsBlocked = new Counter({
      name: 'comandou_channel_order_lookups_blocked_total',
      help: 'Consultas de pedido não feitas por já terem chegado a 10',
      labelNames: ['channel'],
      registers: r,
    });
    this.lastEvent = new Gauge({
      name: 'comandou_channel_last_event_timestamp_seconds',
      help: 'Último evento recebido por canal (epoch)',
      labelNames: ['channel'],
      registers: r,
    });
  }

  /** Contagem por hora ainda não gravada (ChannelUsageService grava a cada minuto). */
  private usage = new Map<string, UsageRow>();

  /**
   * Conta para o painel (uso indevido do iFood). Rótulos fixos e curtos, nunca ids: o banco
   * recusa o que não for letra minúscula, número ou `:_|.-`.
   */
  record(channel: string, metric: UsageMetric, raw: string, n = 1) {
    if (n <= 0) return;
    const label =
      raw
        .toLowerCase()
        .replace(/[^a-z0-9:_|.-]/g, '_')
        .slice(0, 120) || 'x';
    const d = new Date();
    d.setUTCMinutes(0, 0, 0);
    const hour = d.toISOString();
    const key = `${channel}\u0000${hour}\u0000${metric}\u0000${label}`;
    const row = this.usage.get(key);
    if (row) row.count += n;
    else this.usage.set(key, { channel, hour, metric, label, count: n });
  }

  /** Entrega o que foi contado e zera (se a gravação falhar, quem chamou devolve com `restore`). */
  drain(): UsageRow[] {
    const rows = [...this.usage.values()];
    this.usage = new Map();
    return rows;
  }

  restore(rows: UsageRow[]) {
    for (const r of rows) {
      const key = `${r.channel}\u0000${r.hour}\u0000${r.metric}\u0000${r.label}`;
      const cur = this.usage.get(key);
      if (cur) cur.count += r.count;
      else this.usage.set(key, { ...r });
    }
  }

  /** Resultado de uma chamada, agrupado (sem o número exato para não abrir séries demais). */
  static resultOf(status: number): string {
    if (status === 0) return 'network';
    if (status === 401 || status === 403 || status === 429) return String(status);
    return `${Math.floor(status / 100)}xx`;
  }
}
