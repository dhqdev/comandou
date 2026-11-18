import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../../common/context';
import { one, q } from '../../common/sql';
import { DatabaseService, type Tx } from '../../database/database.service';
import type { AuthenticatedUser } from '../../tenancy/tenant.types';

/** Quem age quando a mudança vem do aplicativo (sem usuário da equipe). */
export const CHANNEL_ACTOR: AuthenticatedUser = {
  id: '',
  name: 'Aplicativo de delivery',
  email: '',
  role: 'manager',
  sessionId: '',
};

export function channelCtx(tenantId: string): Ctx {
  return { tenantId, userId: null, user: CHANNEL_ACTOR };
}

export interface StoreRow {
  id: string;
  channel: string;
  store_id: string;
  name: string;
  ifood_connection_id: string | null;
  receive_orders: boolean;
  auto_accept: boolean;
  status: 'connected' | 'revoked';
}

export const STORE_COLUMNS = `id, channel, store_id, name, ifood_connection_id, receive_orders, auto_accept, status`;

/**
 * Lojas dos aplicativos ligadas ao restaurante. Cada loja fica registrada também no banco central
 * (channel_store_claims): uma loja do aplicativo nunca entra em dois restaurantes, e o polling sabe
 * de quem é cada evento sem abrir todos os bancos.
 */
@Injectable()
export class ChannelStoresService {
  private readonly syncs: ((tenantId: string) => Promise<void>)[] = [];

  constructor(private readonly db: DatabaseService) {}

  /** Um canal com lojas ligadas fora daqui (iFood) se registra para trazê-las (idempotente). */
  onSync(fn: (tenantId: string) => Promise<void>) {
    this.syncs.push(fn);
  }

  async sync(tenantId: string) {
    for (const fn of this.syncs) await fn(tenantId).catch(() => undefined);
  }

  get(tx: Tx, id: string) {
    return one<StoreRow>(tx, `SELECT ${STORE_COLUMNS} FROM channel_stores WHERE id = $1`, [id]);
  }

  byStoreId(tx: Tx, channel: string, storeId: string) {
    return one<StoreRow>(
      tx,
      `SELECT ${STORE_COLUMNS} FROM channel_stores WHERE channel = $1 AND store_id = $2`,
      [channel, storeId],
    );
  }

  /**
   * Liga (ou religa) uma loja. `credential` diz quem busca os eventos dela ('ifood:central', ou
   * uma por loja). Recebimento de pedidos começa desligado: o restaurante liga na tela.
   */
  async connect(
    tenantId: string,
    userId: string | null,
    s: {
      channel: string;
      storeId: string;
      name: string;
      credential: string;
      ifoodConnectionId?: string | null;
    },
  ) {
    const storeId = s.storeId.trim().toLowerCase();
    const existing = await this.db.withTenant({ tenantId }, (tx) =>
      this.byStoreId(tx, s.channel, storeId),
    );
    const id = existing?.id ?? randomUUID();
    await this.claim(tenantId, s.channel, storeId, id, s.credential);
    return this.db.withTenant({ tenantId, userId }, async (tx) => {
      const row = await one<StoreRow>(
        tx,
        `INSERT INTO channel_stores (id, tenant_id, channel, store_id, name, ifood_connection_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, channel, store_id) DO UPDATE
           SET name = EXCLUDED.name, status = 'connected', last_error = NULL,
               ifood_connection_id = COALESCE(EXCLUDED.ifood_connection_id,
                                              channel_stores.ifood_connection_id)
         RETURNING ${STORE_COLUMNS}`,
        [
          id,
          tenantId,
          s.channel,
          storeId,
          s.name.slice(0, 160),
          s.ifoodConnectionId ?? null,
          userId,
        ],
      );
      return row!;
    });
  }

  /** Reserva a loja no banco central (recusa se for de outro restaurante). */
  private async claim(
    tenantId: string,
    channel: string,
    storeId: string,
    storeRef: string,
    credential: string,
  ) {
    const mine = await this.db.withCentral({ tenantId }, async (tx) => {
      await q(
        tx,
        `INSERT INTO channel_store_claims (channel, store_id, tenant_id, store_ref, credential)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (channel, store_id) DO NOTHING`,
        [channel, storeId, tenantId, storeRef, credential],
      );
      // O RLS só deixa ver e mudar a reserva deste restaurante.
      return one(
        tx,
        `UPDATE channel_store_claims SET store_ref = $3, credential = $4
          WHERE channel = $1 AND store_id = $2 RETURNING 1`,
        [channel, storeId, storeRef, credential],
      );
    });
    if (!mine)
      throw new ConflictException(
        'Essa loja do aplicativo já está ligada a outro restaurante. Fale com o suporte do Comandou.',
      );
  }

  /** Ligar ou desligar o recebimento de pedidos e o aceite automático. */
  async setOptions(
    tenantId: string,
    userId: string,
    id: string,
    o: { receiveOrders?: boolean; autoAccept?: boolean },
  ) {
    const row = await this.db.withTenant({ tenantId, userId }, (tx) =>
      one<StoreRow>(
        tx,
        `UPDATE channel_stores SET receive_orders = COALESCE($2, receive_orders),
                auto_accept = COALESCE($3, auto_accept)
          WHERE id = $1 RETURNING ${STORE_COLUMNS}`,
        [id, o.receiveOrders ?? null, o.autoAccept ?? null],
      ),
    );
    if (!row) throw new NotFoundException('Loja do aplicativo não encontrada');
    // O polling lê do banco central: sem recebimento, a loja sai da busca na próxima rodada.
    await this.db.withCentral({ tenantId }, (tx) =>
      q(
        tx,
        `UPDATE channel_store_claims SET receive_orders = $3 WHERE channel = $1 AND store_id = $2`,
        [row.channel, row.store_id, row.receive_orders && row.status === 'connected'],
      ),
    );
    return row;
  }

  /** A loja revogou o acesso (403): para de buscar e mostra o motivo na tela. */
  async markRevoked(tenantId: string, id: string, reason: string) {
    const row = await this.db.withTenant({ tenantId }, (tx) =>
      one<StoreRow>(
        tx,
        `UPDATE channel_stores SET status = 'revoked', last_error = $2 WHERE id = $1
         RETURNING ${STORE_COLUMNS}`,
        [id, reason.slice(0, 300)],
      ),
    );
    if (row)
      await this.db.withCentral({ tenantId }, (tx) =>
        q(
          tx,
          `UPDATE channel_store_claims SET receive_orders = false WHERE channel = $1 AND store_id = $2`,
          [row.channel, row.store_id],
        ),
      );
  }

  async disconnect(tenantId: string, userId: string, id: string) {
    const row = await this.db.withTenant({ tenantId, userId }, (tx) =>
      one<StoreRow>(tx, `DELETE FROM channel_stores WHERE id = $1 RETURNING ${STORE_COLUMNS}`, [
        id,
      ]),
    );
    if (!row) throw new NotFoundException('Loja do aplicativo não encontrada');
    await this.release(tenantId, row.channel, row.store_id);
    return row;
  }

  async release(tenantId: string, channel: string, storeId: string) {
    await this.db.withCentral({ tenantId }, (tx) =>
      q(tx, `DELETE FROM channel_store_claims WHERE channel = $1 AND store_id = $2`, [
        channel,
        storeId,
      ]),
    );
  }
}
