import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../audit/audit.service';
import { one, q } from '../../common/sql';
import { DatabaseService } from '../../database/database.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { StoreService } from '../../store/store.service';
import { ChannelHttpError, ChannelRegistry, type StoreRef } from './channel-adapter';
import { ChannelStoresService } from './channel-stores.service';

/** A tela lê a situação no máximo uma vez por minuto; a varredura, a cada 5 minutos. */
export const STATE_SCREEN_SECONDS = 60;
export const STATE_SWEEP_SECONDS = 300;
/** Horários mudam pouco: no máximo a cada 6 horas. */
export const HOURS_SECONDS = 6 * 3600;

interface Row {
  id: string;
  channel: string;
  store_id: string;
  name: string;
  status: 'connected' | 'revoked';
  receive_orders: boolean;
  pause_id: string | null;
  pause_by_store: boolean;
  follow_store_open: boolean;
  state_at: Date | null;
  hours_at: Date | null;
}

const ROW = `id, channel, store_id, name, status, receive_orders, pause_id, pause_by_store,
             follow_store_open, state_at, hours_at`;

/**
 * Loja aberta, fechada ou pausada nos aplicativos (ADR 0015, Fase 4). Lê a situação com calma
 * (o iFood mede a taxa de erro do status), pausa e reabre pelo canal e segue o "Loja aberta" do
 * Comandou: fechar a loja aqui pausa nos aplicativos com `follow_store_open`, reabrir tira a pausa
 * que o Comandou fez (nunca a que o restaurante fez no portal).
 */
@Injectable()
export class ChannelStoreStateService implements OnModuleInit {
  private readonly logger = new Logger('ChannelsStoreState');

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: ChannelRegistry,
    private readonly stores: ChannelStoresService,
    private readonly store: StoreService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    this.store.onOpenChanged((tenantId, userId, isOpen) =>
      this.followStoreOpen(tenantId, userId, isOpen),
    );
  }

  private async ref(tenantId: string, r: Row): Promise<StoreRef | null> {
    const claim = await this.db.withCentral({ tenantId }, (tx) =>
      one<{ credential: string }>(
        tx,
        `SELECT credential FROM channel_store_claims WHERE channel = $1 AND store_id = $2`,
        [r.channel, r.store_id],
      ),
    );
    return claim ? { tenantId, storeId: r.store_id, credential: claim.credential } : null;
  }

  private rows(tenantId: string, where = 'TRUE', args: unknown[] = []) {
    return this.db.withTenant({ tenantId }, (tx) =>
      q<Row>(tx, `SELECT ${ROW} FROM channel_stores WHERE ${where} ORDER BY channel, name`, args),
    );
  }

  /**
   * Atualiza a situação das lojas ligadas cuja leitura passou de `maxAgeSeconds`. Uma por vez e
   * sem repetir na hora: a próxima varredura é a repetição.
   */
  async refreshTenant(tenantId: string, maxAgeSeconds = STATE_SCREEN_SECONDS) {
    const due = await this.rows(
      tenantId,
      `status = 'connected' AND (state_at IS NULL OR state_at < now() - make_interval(secs => $1))`,
      [maxAgeSeconds],
    );
    let changed = false;
    for (const r of due) changed = (await this.refreshRow(tenantId, r)) || changed;
    if (changed) this.realtime.publish(tenantId, { type: 'channels.changed' });
  }

  /** Lê a situação (e, de vez em quando, os horários) de uma loja. Devolve se mudou algo. */
  private async refreshRow(tenantId: string, r: Row): Promise<boolean> {
    const adapter = this.registry.get(r.channel);
    if (!adapter?.storeStatus) return false;
    const ref = await this.ref(tenantId, r);
    if (!ref) return false;
    try {
      const s = await adapter.storeStatus(ref);
      const hoursDue =
        adapter.openingHours &&
        (!r.hours_at || Date.now() - r.hours_at.getTime() > HOURS_SECONDS * 1000);
      const hours = hoursDue ? await adapter.openingHours!(ref).catch(() => null) : null;
      // A pausa que o Comandou fez e já não existe no canal (venceu ou tiraram no portal) sai daqui.
      const pauseGone = !!r.pause_id && s.pause?.id !== r.pause_id;
      await this.db.withTenant({ tenantId }, (tx) =>
        q(
          tx,
          `UPDATE channel_stores
              SET channel_state = $2, state_title = $3, state_detail = $4, state_at = now(),
                  state_error = NULL,
                  pause_id = CASE WHEN $5 THEN NULL ELSE pause_id END,
                  pause_by_store = CASE WHEN $5 THEN false ELSE pause_by_store END,
                  pause_until = $6::timestamptz, pause_reason = $7,
                  opening_hours = COALESCE($8::jsonb, opening_hours),
                  hours_at = CASE WHEN $8::jsonb IS NULL THEN hours_at ELSE now() END
            WHERE id = $1`,
          [
            r.id,
            s.state,
            s.title ?? null,
            s.detail ?? null,
            pauseGone,
            s.pause?.until ?? null,
            s.pause?.reason?.slice(0, 200) ?? null,
            hours ? JSON.stringify(hours) : null,
          ],
        ),
      );
      return true;
    } catch (e) {
      const err = e instanceof ChannelHttpError ? e : new ChannelHttpError(0, String(e));
      if (err.status === 403)
        await this.stores.markRevoked(tenantId, r.id, err.message).catch(() => undefined);
      await this.db.withTenant({ tenantId }, (tx) =>
        q(tx, `UPDATE channel_stores SET state_at = now(), state_error = $2 WHERE id = $1`, [
          r.id,
          `Não deu para ler a situação no aplicativo (${err.status || 'sem resposta'})`,
        ]),
      );
      return true;
    }
  }

  /** Pausa a loja no aplicativo (minutos = null: até reabrir, no máximo do canal). */
  async pause(
    tenantId: string,
    userId: string | null,
    id: string,
    o: { minutes: number | null; reason: string; byStore?: boolean },
    ip?: string,
  ) {
    const [r] = await this.rows(tenantId, 'id = $1', [id]);
    if (!r) throw new NotFoundException('Loja do aplicativo não encontrada');
    if (r.status !== 'connected')
      throw new ConflictException('Loja sem autorização no aplicativo: ligue de novo');
    const adapter = this.registry.get(r.channel);
    if (!adapter?.pauseStore) throw new BadRequestException('Este aplicativo não aceita pausa');
    const ref = await this.ref(tenantId, r);
    if (!ref) throw new ConflictException('Loja do aplicativo desligada');
    // Já pausada pelo Comandou: troca pela nova (tira a anterior antes).
    if (r.pause_id && adapter.resumeStore)
      await this.callOrThrow(() => adapter.resumeStore!(ref, r.pause_id!));
    const max = adapter.maxPauseMinutes ?? 24 * 60;
    const minutes = Math.min(o.minutes ?? max, max);
    const until = new Date(Date.now() + minutes * 60_000).toISOString();
    const pauseId = await this.callOrThrow(() =>
      adapter.pauseStore!(ref, { id: randomUUID(), reason: o.reason, until }),
    );
    await this.db.withTenant({ tenantId, userId }, async (tx) => {
      await q(
        tx,
        `UPDATE channel_stores
            SET pause_id = $2, pause_until = $3, pause_reason = $4, pause_by_store = $5,
                channel_state = 'paused', state_error = NULL
          WHERE id = $1`,
        [r.id, pauseId, until, o.reason.slice(0, 200), !!o.byStore],
      );
      await this.audit.record(tx, {
        tenantId,
        actorUserId: userId,
        action: 'channel.store_paused',
        entity: 'channel_store',
        entityId: r.id,
        data: { channel: r.channel, minutes, byStore: !!o.byStore },
        ip,
      });
    });
    this.realtime.publish(tenantId, { type: 'channels.changed' });
    return { ok: true, until };
  }

  /** Tira a pausa que o Comandou fez. Sem pausa nossa: nada a fazer. */
  async resume(tenantId: string, userId: string | null, id: string, ip?: string) {
    const [r] = await this.rows(tenantId, 'id = $1', [id]);
    if (!r) throw new NotFoundException('Loja do aplicativo não encontrada');
    const adapter = this.registry.get(r.channel);
    if (r.pause_id && adapter?.resumeStore) {
      const ref = await this.ref(tenantId, r);
      if (!ref) throw new ConflictException('Loja do aplicativo desligada');
      await this.callOrThrow(() => adapter.resumeStore!(ref, r.pause_id!));
    }
    await this.db.withTenant({ tenantId, userId }, async (tx) => {
      await q(
        tx,
        `UPDATE channel_stores
            SET pause_id = NULL, pause_until = NULL, pause_reason = NULL, pause_by_store = false,
                state_at = NULL, state_error = NULL
          WHERE id = $1`,
        [r.id],
      );
      await this.audit.record(tx, {
        tenantId,
        actorUserId: userId,
        action: 'channel.store_resumed',
        entity: 'channel_store',
        entityId: r.id,
        data: { channel: r.channel },
        ip,
      });
    });
    // Lê de novo agora (state_at zerado): a tela mostra a situação real do aplicativo.
    await this.refreshTenant(tenantId, 0).catch(() => undefined);
    this.realtime.publish(tenantId, { type: 'channels.changed' });
    return { ok: true };
  }

  /**
   * "Loja aberta" do Comandou mudou: fecha (pausa) ou reabre nos aplicativos que seguem a loja.
   * Falha não desfaz o que a pessoa fez aqui: fica o aviso na loja do aplicativo.
   */
  async followStoreOpen(tenantId: string, userId: string | null, isOpen: boolean) {
    const list = await this.rows(
      tenantId,
      `status = 'connected' AND receive_orders AND follow_store_open`,
    );
    for (const r of list) {
      try {
        if (!isOpen && !r.pause_id)
          await this.pause(tenantId, userId, r.id, {
            minutes: null,
            reason: 'Loja fechada no Comandou',
            byStore: true,
          });
        else if (isOpen && r.pause_id && r.pause_by_store)
          await this.resume(tenantId, userId, r.id);
      } catch (e) {
        this.logger.warn(`loja ${r.channel}: não deu para ${isOpen ? 'reabrir' : 'pausar'}`);
        await this.db
          .withTenant({ tenantId }, (tx) =>
            q(tx, `UPDATE channel_stores SET state_error = $2 WHERE id = $1`, [
              r.id,
              `Não deu para ${isOpen ? 'reabrir' : 'pausar'} no aplicativo: ${(e as Error).message}`.slice(
                0,
                300,
              ),
            ]),
          )
          .catch(() => undefined);
        this.realtime.publish(tenantId, { type: 'channels.changed' });
      }
    }
  }

  /** Chamada ao canal que a pessoa espera: erro vira mensagem clara (nada se repete sozinho). */
  private async callOrThrow<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const status = e instanceof ChannelHttpError ? e.status : 0;
      throw new ConflictException(
        status === 0 || status >= 500 || status === 429
          ? 'O aplicativo não respondeu agora. Tente de novo em instantes.'
          : `O aplicativo recusou (${status}): ${(e as Error).message}`.slice(0, 250),
      );
    }
  }
}
