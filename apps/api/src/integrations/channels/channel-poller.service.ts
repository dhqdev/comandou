import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { ENV, Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { ChannelRegistry, type ChannelEvent, type PollStore } from './channel-adapter';
import { ChannelInboxService } from './channel-inbox.service';
import { ChannelMetrics } from './channel-metrics';
import { ChannelOutboxService } from './channel-outbox.service';
import { ChannelStoreStateService, STATE_SWEEP_SECONDS } from './channel-store-state.service';

/** Até 100 lojas por chamada de polling (limite do iFood no x-polling-merchants). */
export const POLL_BATCH = 100;

interface Target {
  channel: string;
  store_id: string;
  tenant_id: string;
  store_ref: string;
  credential: string;
}

export interface PollSummary {
  credentials: number;
  polled: number;
  skipped: number;
  events: number;
  acked: number;
}

/**
 * Polling dos aplicativos. Uma trava por credencial no banco central (channel_poll_leases): só
 * uma réplica busca cada credencial; se ela cair, outra assume quando a trava vence. Nunca busca
 * antes de 30 s do último polling (de qualquer réplica). Lojas em lotes de até 100. Ack só do que
 * já está gravado no banco do restaurante.
 *
 * Também faz a varredura: eventos e ações vencidos (ex.: depois de uma queda) voltam a andar.
 */
@Injectable()
export class ChannelPoller implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ChannelsPoller');
  /** Quem segura a trava: máquina, processo e um sorteio (réplicas na mesma máquina). */
  readonly holder = `${hostname().slice(0, 60)}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private timer?: NodeJS.Timeout;
  private sweepTimer?: NodeJS.Timeout;
  private running = false;
  private readonly startedAt = Date.now() / 1000;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly registry: ChannelRegistry,
    private readonly inbox: ChannelInboxService,
    private readonly outbox: ChannelOutboxService,
    private readonly metrics: ChannelMetrics,
    private readonly storeState: ChannelStoreStateService,
  ) {}

  /** Intervalo mínimo entre dois pollings da mesma credencial (30 s; menos só nos testes). */
  get minGapSeconds() {
    return this.env.NODE_ENV === 'test'
      ? this.env.CHANNELS_POLL_MIN_SECONDS
      : Math.max(30, this.env.CHANNELS_POLL_MIN_SECONDS);
  }

  onApplicationBootstrap() {
    const every = this.env.CHANNELS_POLL_SECONDS;
    if (every > 0) {
      const ms = (this.env.NODE_ENV === 'test' ? every : Math.max(30, every)) * 1000;
      this.timer = setInterval(() => void this.tick().catch(() => undefined), ms);
      this.timer.unref();
    }
    const sweep = this.env.CHANNELS_SWEEP_SECONDS;
    if (sweep > 0) {
      this.sweepTimer = setInterval(() => void this.sweep().catch(() => undefined), sweep * 1000);
      this.sweepTimer.unref();
    }
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    clearInterval(this.sweepTimer);
    // Solta as travas: outra réplica assume na hora, sem esperar vencer.
    await this.db
      .queryUnscoped('SELECT app_channel_lease_release($1)', [this.holder])
      .catch(() => undefined);
  }

  /** Uma rodada de polling de todas as credenciais. */
  async tick(): Promise<PollSummary> {
    const sum: PollSummary = { credentials: 0, polled: 0, skipped: 0, events: 0, acked: 0 };
    if (this.running) return sum;
    this.running = true;
    try {
      const targets = await this.db.queryUnscoped<Target>(
        'SELECT channel, store_id, tenant_id, store_ref, credential FROM app_channel_poll_targets()',
        [],
      );
      const byCred = new Map<string, Target[]>();
      const perChannel = new Map<string, number>();
      for (const t of targets) {
        byCred.set(t.credential, [...(byCred.get(t.credential) ?? []), t]);
        perChannel.set(t.channel, (perChannel.get(t.channel) ?? 0) + 1);
      }
      for (const a of this.registry.all()) {
        const n = perChannel.get(a.id) ?? 0;
        this.metrics.pollStores.set({ channel: a.id }, n);
        // Sem nenhum polling bem-sucedido ainda, o relógio do alerta começa quando a réplica sobe.
        if (n && !this.started.has(a.id)) {
          this.started.add(a.id);
          this.metrics.lastPoll.set({ channel: a.id }, this.startedAt);
        }
      }
      for (const [credential, list] of byCred) {
        sum.credentials++;
        const r = await this.pollCredential(credential, list);
        if (r === null) sum.skipped++;
        else {
          sum.polled++;
          sum.events += r.events;
          sum.acked += r.acked;
        }
      }
    } finally {
      this.running = false;
    }
    return sum;
  }

  private readonly started = new Set<string>();

  /** null = outra réplica segura a trava ou ainda não deu o intervalo mínimo. */
  private async pollCredential(credential: string, list: Target[]) {
    const channel = list[0]!.channel;
    const adapter = this.registry.get(channel);
    if (!adapter?.poll) return null;
    const [lease] = await this.db.queryUnscoped<{ acquired: boolean; last_poll_at: Date | null }>(
      'SELECT acquired, last_poll_at FROM app_channel_lease($1, $2, $3)',
      [credential, this.holder, this.env.CHANNELS_LEASE_SECONDS],
    );
    if (!lease?.acquired) return null;
    if (lease.last_poll_at && Date.now() - lease.last_poll_at.getTime() < this.minGapSeconds * 1000)
      return null;
    const [mark] = await this.db.queryUnscoped<{ ok: boolean }>(
      'SELECT app_channel_polled($1, $2) AS ok',
      [credential, this.holder],
    );
    if (!mark?.ok) return null;

    let events = 0;
    let acked = 0;
    let failed = false;
    for (let i = 0; i < list.length; i += POLL_BATCH) {
      const batch = list.slice(i, i + POLL_BATCH);
      const stores = new Map<string, PollStore>(
        batch.map((t) => [
          t.store_id.toLowerCase(),
          { storeId: t.store_id, tenantId: t.tenant_id, storeRef: t.store_ref },
        ]),
      );
      let got: ChannelEvent[];
      const pollBatch = { credential, stores: [...stores.values()] };
      try {
        got = await adapter.poll(pollBatch);
      } catch (e) {
        failed = true;
        this.metrics.pollErrors.inc({ channel });
        this.metrics.record(channel, 'poll', 'error');
        this.logger.warn(`polling de ${channel} falhou: ${(e as Error).message}`);
        continue;
      }
      events += got.length;
      this.metrics.record(channel, 'poll', got.length ? 'with_events' : 'empty');
      if (!got.length) continue;
      const results = await this.inbox.store(channel, got, stores);
      // Ack só do que ficou gravado (ou já estava, ou não é de nenhum restaurante nosso).
      const ackable = got.filter((e) => {
        const r = results.get(e.id);
        return r === 'stored' || r === 'duplicate' || r === 'orphan';
      });
      let ackedNow = 0;
      if (ackable.length && adapter.ack) {
        try {
          await adapter.ack(pollBatch, ackable);
          acked += ackable.length;
          ackedNow = ackable.length;
          this.metrics.acks.inc({ channel, result: 'ok' }, ackable.length);
          this.metrics.record(channel, 'ack', 'ok', ackable.length);
        } catch (e) {
          this.metrics.acks.inc({ channel, result: 'failed' }, ackable.length);
          this.metrics.record(channel, 'ack', 'failed', ackable.length);
          this.logger.warn(`ack de ${channel} falhou: ${(e as Error).message}`);
        }
      }
      const pending = got.length - ackable.length;
      if (pending) {
        this.metrics.acks.inc({ channel, result: 'held' }, pending);
        this.metrics.record(channel, 'ack', 'held', pending);
      }
      // Regra do iFood: polling com eventos tem de terminar com ack (meta ≥ 95%).
      this.metrics.record(
        channel,
        'poll_acked',
        ackedNow === got.length ? 'all' : ackedNow > 0 ? 'partial' : 'none',
      );
    }
    if (!failed) this.metrics.lastPoll.set({ channel }, Date.now() / 1000);
    return { events, acked };
  }

  /** Varredura: trata eventos e envia ações que ficaram para trás em todos os restaurantes. */
  async sweep() {
    const tenants = await this.db.queryUnscoped<{ tenant_id: string }>(
      'SELECT tenant_id FROM app_channel_tenants()',
      [],
    );
    for (const t of tenants) {
      await this.inbox.process(t.tenant_id).catch(() => undefined);
      await this.outbox.deliver(t.tenant_id).catch(() => undefined);
      // Situação das lojas nos aplicativos: no máximo a cada 5 minutos por loja.
      await this.storeState.refreshTenant(t.tenant_id, STATE_SWEEP_SECONDS).catch(() => undefined);
      // Tarefas de cada aplicativo (ex.: conferir o cardápio do iFood), cada uma com o seu ritmo.
      for (const fn of this.sweeps) await fn(t.tenant_id).catch(() => undefined);
    }
  }

  private readonly sweeps: ((tenantId: string) => Promise<unknown>)[] = [];

  /** Acrescenta uma tarefa à varredura por restaurante (ela decide se já está na hora). */
  onSweep(fn: (tenantId: string) => Promise<unknown>) {
    this.sweeps.push(fn);
  }
}
