import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { ChannelRegistry, type ChannelEvent, type PollStore } from '../channels/channel-adapter';
import { ChannelCredentials } from '../channels/channel-credentials.service';
import type { Fetcher } from '../channels/channel-http';
import { ChannelInboxService } from '../channels/channel-inbox.service';
import { ChannelMetrics } from '../channels/channel-metrics';
import { RappiAdapter } from './rappi.adapter';
import { rappiEventKind, rappiStoreOf, verifyRappiSignature, type RappiOrder } from './rappi-order';

/** Avisos da Rappi que o Comandou recebe (um endereço por aviso, cadastrado na Rappi). */
export const RAPPI_HOOKS = ['new-order', 'cancel', 'other', 'ping', 'store'] as const;
export type RappiHook = (typeof RAPPI_HOOKS)[number];

/**
 * Rappi (ADR 0015, Fase 12): registra o adaptador e recebe os webhooks. Webhook só entra com a
 * assinatura certa (Rappi-Signature, HMAC-SHA256 do "t.corpo cru" com o segredo cadastrado em
 * Credenciais) e recente (10 minutos); depois é como o polling: grava na caixa de entrada do
 * restaurante e só então responde 200. Banco do restaurante fora: 503 (a Rappi manda de novo).
 */
@Injectable()
export class RappiService implements OnModuleInit {
  private readonly logger = new Logger('Rappi');
  readonly adapter: RappiAdapter;
  /** Trocado nos testes. */
  fetcher: Fetcher = (...a) => fetch(...a);

  constructor(
    @Inject(ENV) env: Env,
    private readonly creds: ChannelCredentials,
    metrics: ChannelMetrics,
    private readonly registry: ChannelRegistry,
    private readonly inbox: ChannelInboxService,
    private readonly db: DatabaseService,
  ) {
    this.adapter = new RappiAdapter(
      creds,
      metrics,
      async () => (await creds.get('rappi'))?.baseUrl ?? env.RAPPI_API_URL,
      () => this.fetcher,
    );
  }

  onModuleInit() {
    this.registry.register(this.adapter);
  }

  async webhook(hook: RappiHook, signature: unknown, raw: Buffer | undefined) {
    // A gravação conta o evento no uso dos aplicativos; aqui só o que nem chegou a gravar.
    const result = (r: string) => {
      if (r === 'bad_signature' || r === 'bad_body')
        this.logger.warn(`webhook da Rappi (${hook}) recusado: ${r}`);
    };
    const secret = (await this.creds.get('rappi'))?.webhookSecret;
    if (!raw || !secret || !verifyRappiSignature(secret, signature, raw)) {
      result('bad_signature');
      throw new UnauthorizedException('Assinatura inválida');
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      result('bad_body');
      throw new BadRequestException('Corpo inválido');
    }
    const ev = this.toEvent(hook, body);
    if (!ev) {
      result('ignored');
      return { ok: true };
    }
    const store = await this.storeOf(ev.storeId);
    if (!store) {
      // Loja que não está recebendo pelo Comandou: confirma para a Rappi não insistir.
      result('orphan');
      return { ok: true };
    }
    const r = (await this.inbox.store('rappi', [ev], new Map([[ev.storeId, store]]))).get(ev.id);
    if (r === 'unavailable') throw new ServiceUnavailableException('Tente de novo em instantes');
    return { ok: true };
  }

  /** Aviso → evento, sem dados pessoais (o pedido novo fica na memória do adaptador). */
  private toEvent(hook: RappiHook, body: unknown): ChannelEvent | null {
    if (!body || typeof body !== 'object') return null;
    if (hook === 'new-order') {
      const store = rappiStoreOf(body as RappiOrder);
      return store ? this.adapter.newOrderEvent(body as RappiOrder, store, 'NEW_ORDER') : null;
    }
    if (hook !== 'cancel' && hook !== 'other') return null;
    const b = body as { event?: unknown; order_id?: unknown; store_id?: unknown };
    const orderId = typeof b.order_id === 'number' ? String(b.order_id) : b.order_id;
    const storeId = typeof b.store_id === 'number' ? String(b.store_id) : b.store_id;
    const name = typeof b.event === 'string' ? b.event.slice(0, 60) : '';
    if (typeof orderId !== 'string' || typeof storeId !== 'string' || !orderId || !storeId)
      return null;
    const kind = hook === 'cancel' ? 'order.cancelled' : rappiEventKind(name);
    // Outros avisos (ex.: taken_visible_order) não mudam nada no Comandou.
    if (kind === 'other') return null;
    return {
      id: `${orderId.slice(0, 100)}:${name || 'cancel'}`,
      code: name || 'ORDER_EVENT_CANCEL',
      kind,
      storeId: storeId.slice(0, 100).toLowerCase(),
      orderId: orderId.slice(0, 100),
      occurredAt: new Date().toISOString(),
      payload: { event: name || null },
    };
  }

  /** Loja ligada e recebendo pedidos (a mesma lista do polling). */
  private async storeOf(storeId: string): Promise<PollStore | null> {
    const [t] = await this.db.queryUnscoped<{
      store_id: string;
      tenant_id: string;
      store_ref: string;
    }>(
      `SELECT store_id, tenant_id, store_ref FROM app_channel_poll_targets()
        WHERE channel = 'rappi' AND lower(store_id) = $1 LIMIT 1`,
      [storeId.toLowerCase()],
    );
    return t ? { storeId: t.store_id, tenantId: t.tenant_id, storeRef: t.store_ref } : null;
  }
}
