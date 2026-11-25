import { Injectable, NotFoundException } from '@nestjs/common';
import {
  IFOOD_HOMOLOGATION_STEPS,
  IFOOD_USAGE_RULES,
  type HomologationStep,
  usageReport,
} from '@comandou/shared';
import { ChannelCredentials } from '../integrations/channels/channel-credentials.service';
import { PlatformDb, platformAudit } from './platform-db.service';
import type { Actor } from './platform.service';

/** Roteiro de homologação de cada aplicativo (os outros entram nas próximas fases). */
export const HOMOLOGATION: Record<string, readonly HomologationStep[]> = {
  ifood: IFOOD_HOMOLOGATION_STEPS,
};

export interface HomologationMark {
  done: boolean;
  note?: string | null;
}

/**
 * Super Admin › Aplicativos: o uso dos aplicativos de delivery contra as regras de uso indevido
 * (ack, erro por endpoint, consultas por pedido) e o roteiro de homologação, passo a passo.
 * Só contagens e horários: nada de loja, pedido ou cliente.
 */
@Injectable()
export class PlatformChannelsService {
  constructor(
    private readonly db: PlatformDb,
    private readonly creds: ChannelCredentials,
  ) {}

  /** As contagens das últimas `hours` horas (hora cheia atual inclusa), por canal. */
  async usage(hours: number) {
    const rows = await this.db.query<{
      channel: string;
      metric: string;
      label: string;
      count: string;
    }>(
      `SELECT channel, metric, label, sum(count)::bigint AS count
         FROM channel_usage
        WHERE hour >= date_trunc('hour', now()) - make_interval(hours => $1::int - 1)
        GROUP BY 1, 2, 3`,
      [hours],
    );
    const live = await this.db.query<{ credential: string; stores: number; last_poll_at: Date }>(
      'SELECT * FROM platform_channel_live()',
    );
    const creds = await this.creds.status(Object.keys(HOMOLOGATION));

    const channels = [
      ...new Set([...Object.keys(HOMOLOGATION), ...rows.map((r) => r.channel)]),
    ].sort();
    return {
      hours,
      rules: IFOOD_USAGE_RULES,
      channels: channels.map((channel) => {
        const mine = rows.filter((r) => r.channel === channel);
        const credential = creds[channel];
        return {
          channel,
          credential: credential
            ? { configured: credential.configured, mode: credential.mode ?? null }
            : null,
          report: usageReport(
            mine.map((r) => ({ metric: r.metric, label: r.label, count: Number(r.count) })),
          ),
          live: live
            .filter((l) => l.credential.split(':')[0] === channel)
            .map((l) => ({
              credential: l.credential,
              stores: l.stores,
              lastPollAt: l.last_poll_at?.toISOString() ?? null,
            })),
        };
      }),
    };
  }

  /** O roteiro de cada aplicativo, com o que a equipe já marcou. */
  async homologation() {
    const rows = await this.db.query<{
      channel: string;
      step: string;
      done_at: Date | null;
      note: string | null;
      updated_at: Date;
      done_by_name: string | null;
    }>(
      `SELECT h.channel, h.step, h.done_at, h.note, h.updated_at, a.name AS done_by_name
         FROM platform_channel_homologation h
         LEFT JOIN platform_admins a ON a.id = h.done_by`,
    );
    return Object.entries(HOMOLOGATION).map(([channel, steps]) => ({
      channel,
      steps: steps.map((s) => {
        const r = rows.find((x) => x.channel === channel && x.step === s.id);
        return {
          ...s,
          doneAt: r?.done_at?.toISOString() ?? null,
          doneBy: r?.done_at ? (r.done_by_name ?? null) : null,
          note: r?.note ?? null,
          updatedAt: r?.updated_at.toISOString() ?? null,
        };
      }),
    }));
  }

  /** Marca (ou desmarca) um passo e guarda a observação. Fica no registro do painel. */
  async mark(channel: string, step: string, b: HomologationMark, a: Actor) {
    const def = HOMOLOGATION[channel]?.find((s) => s.id === step);
    if (!def) throw new NotFoundException('Passo não encontrado');
    const note = b.note?.trim() ? b.note.trim() : null;
    await this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO platform_channel_homologation (channel, step, done_at, done_by, note)
         VALUES ($1, $2, CASE WHEN $3 THEN now() END, CASE WHEN $3 THEN $4::uuid END, $5)
         ON CONFLICT (channel, step) DO UPDATE
           SET done_at = CASE WHEN $3 THEN COALESCE(platform_channel_homologation.done_at, now()) END,
               done_by = CASE WHEN $3 THEN COALESCE(platform_channel_homologation.done_by, $4::uuid) END,
               note = $5, updated_at = now()`,
        [channel, step, b.done, a.admin.id, note],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.channel_homologation',
        entity: 'channel',
        entityId: channel,
        data: { step, title: def.title, done: b.done },
        ip: a.ip,
      });
    });
    return this.homologation();
  }

  /**
   * Lojas ligadas só pelo código (Keeta, 99Food, Rappi, Open Delivery, iFood centralizado), à
   * espera de alguém conferir que são mesmo do restaurante. Até aprovar, nada acontece com elas.
   */
  async pendingStores() {
    const rows = await this.db.query<{
      channel: string;
      store_id: string;
      store_name: string | null;
      tenant_id: string;
      tenant_name: string;
      slug: string;
      created_at: Date;
    }>(
      `SELECT c.channel, c.store_id, c.store_name, c.tenant_id, t.name AS tenant_name, t.slug,
              c.created_at
         FROM channel_store_claims c JOIN tenants t ON t.id = c.tenant_id
        WHERE c.approved_at IS NULL
        ORDER BY c.created_at
        LIMIT 200`,
    );
    return rows.map((r) => ({
      channel: r.channel,
      storeId: r.store_id,
      storeName: r.store_name,
      tenant: { id: r.tenant_id, name: r.tenant_name, slug: r.slug },
      createdAt: r.created_at.toISOString(),
    }));
  }

  /**
   * Aprova (a loja passa a funcionar) ou recusa (a reserva sai: a loja fica livre para o dono de
   * verdade e o restaurante vê "não aprovada"). Fica no registro do painel.
   */
  async decideStore(channel: string, storeId: string, approve: boolean, a: Actor) {
    await this.db.tx(async (c) => {
      const r = approve
        ? await c.query<{ tenant_id: string }>(
            `UPDATE channel_store_claims SET approved_at = now(), approved_by = $3
              WHERE channel = $1 AND store_id = $2 AND approved_at IS NULL
             RETURNING tenant_id`,
            [channel, storeId, a.admin.name.slice(0, 160)],
          )
        : await c.query<{ tenant_id: string }>(
            `DELETE FROM channel_store_claims
              WHERE channel = $1 AND store_id = $2 AND approved_at IS NULL
             RETURNING tenant_id`,
            [channel, storeId],
          );
      const row = r.rows[0];
      if (!row) throw new NotFoundException('Loja não está esperando aprovação');
      await platformAudit(c, {
        adminId: a.admin.id,
        action: approve ? 'platform.channel_store_approved' : 'platform.channel_store_rejected',
        entity: 'tenant',
        entityId: row.tenant_id,
        data: { channel, storeId },
        ip: a.ip,
      });
    });
    return this.pendingStores();
  }
}
