import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { ensureMenus } from '../../catalog/menus.controller';
import { nextItemCode } from '../../catalog/item-code';
import { one, q } from '../../common/sql';
import { DatabaseService, type Tx } from '../../database/database.service';
import { PlanService } from '../../plans/plan.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { PRODUCT_STOCK_OUT } from '../../stock/availability-sql';
import { itemKeyOf } from '../channels/external-orders.service';
import { ChannelCredentials } from '../channels/channel-credentials.service';
import { ChannelPoller } from '../channels/channel-poller.service';
import {
  categoryItems,
  menuDrift,
  type DriftItem,
  type RemoteItem,
  type SentItem,
} from './ifood-catalog-read';
import { fingerprints, itemPayload, offerHashOf, type LocalItem } from './ifood-sync';
import { IfoodService, type ConnectionRow } from './ifood.service';

/** A varredura confere o cardápio do iFood a cada 30 minutos; a tela, se passou de 10. */
export const DRIFT_SWEEP_SECONDS = 30 * 60;
export const DRIFT_SCREEN_SECONDS = 10 * 60;
/** Leituras a pedido (botão "Conferir agora"): no máximo uma por minuto por cardápio. */
export const DRIFT_MIN_SECONDS = 60;
/** Limites da leitura: categorias e itens guardados para trazer. */
const MAX_CATEGORIES = 80;
const MAX_ONLY_REMOTE = 300;

export interface MenuDriftView {
  checkedAt: string | null;
  error: string | null;
  changed: DriftItem[];
  onlyRemote: RemoteItem[];
  remoteCount: number;
}

interface StoredDrift {
  changed: DriftItem[];
  onlyRemote: RemoteItem[];
  remoteCount: number;
}

interface MenuRow {
  id: string;
  active: boolean;
  ifood_connection_id: string | null;
  ifood_sync_status: string | null;
  ifood_drift: StoredDrift | null;
  ifood_drift_at: Date | null;
  ifood_drift_error: string | null;
}

const MENU = `SELECT id, active, ifood_connection_id, ifood_sync_status, ifood_drift, ifood_drift_at,
                     ifood_drift_error
                FROM menus WHERE id = $1 AND kind = 'ifood'`;

/**
 * Cardápio do iFood além do envio (ADR 0015, Fase 6):
 * - disponibilidade pelo estoque: quando a ficha técnica deixa um item sem estoque (ou ele volta),
 *   o envio ao iFood é agendado, só se algum item mudou de situação;
 * - conferência: lê o cardápio que está no iFood e avisa o que mudaram no portal (preço,
 *   disponibilidade, nome, item apagado); "Mandar o do Comandou" reenvia esses itens;
 * - trazer do iFood: item que só existe lá vira produto no Comandou, já ligado ao do iFood.
 * O Comandou é o dono do cardápio: nada que vem do portal muda o Comandou sem uma pessoa pedir.
 */
@Injectable()
export class IfoodCatalogService implements OnModuleInit {
  private readonly logger = new Logger('IfoodCatalog');
  private readonly stockTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly db: DatabaseService,
    private readonly ifood: IfoodService,
    private readonly credentials: ChannelCredentials,
    private readonly poller: ChannelPoller,
    private readonly plans: PlanService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    this.poller.onSweep((tenantId) => this.sweepTenant(tenantId));
    // Venda, entrada ou ajuste de estoque: confere (junto, a cada 3 s) se algum item virou.
    this.realtime.onPublish((tenantId, e) => {
      if (e.type !== 'stock.changed' || this.stockTimers.has(tenantId)) return;
      const t = setTimeout(() => {
        this.stockTimers.delete(tenantId);
        void this.stockChanged(tenantId).catch(() => undefined);
      }, 3000);
      t.unref?.();
      this.stockTimers.set(tenantId, t);
    });
  }

  /**
   * Algum item do cardápio do iFood (ativo) está com a disponibilidade diferente da que mandamos?
   * Se sim, agenda o envio. Devolve se agendou.
   */
  async stockChanged(tenantId: string) {
    if (!(await this.credentials.get('ifood'))) return false;
    const r = await this.db.withTenant({ tenantId }, (tx) =>
      one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n
           FROM ifood_sync_map sm
           JOIN menus m ON m.id = sm.menu_id AND m.kind = 'ifood' AND m.active
           JOIN menu_items mi ON mi.menu_id = m.id AND mi.product_id = sm.local_id
           JOIN products p ON p.id = sm.local_id
          WHERE sm.entity = 'item' AND p.active
            AND (CASE WHEN p.sold_out OR ${PRODUCT_STOCK_OUT} THEN 'UNAVAILABLE' ELSE 'AVAILABLE' END)
                <> sm.status`,
      ),
    );
    if (!r?.n) return false;
    await this.ifood.scheduleTenant(tenantId);
    return true;
  }

  // ------------------------------------------------------------------ conferência

  private menu(tx: Tx, menuId: string) {
    return one<MenuRow>(tx, MENU, [menuId]);
  }

  private view(m: MenuRow): MenuDriftView {
    return {
      checkedAt: m.ifood_drift_at?.toISOString() ?? null,
      error: m.ifood_drift_error,
      changed: m.ifood_drift?.changed ?? [],
      onlyRemote: m.ifood_drift?.onlyRemote ?? [],
      remoteCount: m.ifood_drift?.remoteCount ?? 0,
    };
  }

  /** Para a tela: a última conferência; lê de novo se passou de `maxAge` (até 4 s de espera). */
  async drift(tenantId: string, userId: string, menuId: string, maxAge = DRIFT_SCREEN_SECONDS) {
    const m = await this.db.withTenant({ tenantId, userId }, (tx) => this.menu(tx, menuId));
    if (!m) throw new NotFoundException('Cardápio do iFood não encontrado');
    const stale = !m.ifood_drift_at || Date.now() - m.ifood_drift_at.getTime() > maxAge * 1000;
    if (stale && m.ifood_connection_id) {
      await Promise.race([
        this.check(tenantId, menuId).catch(() => undefined),
        new Promise((r) => setTimeout(r, 4000)),
      ]);
      const again = await this.db.withTenant({ tenantId, userId }, (tx) => this.menu(tx, menuId));
      return this.view(again ?? m);
    }
    return this.view(m);
  }

  private readonly checking = new Set<string>();

  /**
   * Lê o cardápio do iFood e compara com o que o Comandou mandou. Uma leitura por cardápio por
   * vez; durante o envio não confere (o iFood ainda não tem tudo). Falha não repete: guarda o
   * aviso e a próxima varredura tenta de novo.
   */
  async check(tenantId: string, menuId: string) {
    if (this.checking.has(menuId)) return;
    this.checking.add(menuId);
    try {
      const m = await this.db.withTenant({ tenantId }, (tx) => this.menu(tx, menuId));
      if (!m?.ifood_connection_id || m.ifood_sync_status === 'running') return;
      const conn = await this.db.withTenant({ tenantId }, (tx) =>
        one<ConnectionRow>(tx, `SELECT * FROM ifood_connections WHERE id = $1`, [
          m.ifood_connection_id,
        ]),
      );
      if (!conn || conn.status !== 'connected') return;
      try {
        const remote = await this.readRemote(tenantId, conn);
        const { sent, ownCodes } = await this.db.withTenant({ tenantId }, (tx) =>
          this.sent(tx, menuId),
        );
        const d = menuDrift(remote, sent, offerHashOf, ownCodes);
        const stored: StoredDrift = {
          changed: d.changed.slice(0, 200),
          onlyRemote: d.onlyRemote.slice(0, MAX_ONLY_REMOTE),
          remoteCount: remote.length,
        };
        await this.db.withTenant({ tenantId }, (tx) =>
          q(
            tx,
            `UPDATE menus SET ifood_drift = $2::jsonb, ifood_drift_at = now(), ifood_drift_error = NULL
              WHERE id = $1`,
            [menuId, JSON.stringify(stored)],
          ),
        );
      } catch (e) {
        await this.db.withTenant({ tenantId }, (tx) =>
          q(tx, `UPDATE menus SET ifood_drift_at = now(), ifood_drift_error = $2 WHERE id = $1`, [
            menuId,
            `Não deu para ler o cardápio no iFood: ${(e as Error).message}`.slice(0, 300),
          ]),
        );
      }
      this.realtime.publish(tenantId, { type: 'ifood.sync', menuId });
    } finally {
      this.checking.delete(menuId);
    }
  }

  /** Cardápio inteiro do iFood: categorias e os itens de cada uma. */
  private async readRemote(tenantId: string, conn: ConnectionRow): Promise<RemoteItem[]> {
    const api = await this.ifood.clientFor(tenantId, conn);
    const catalogs = await api.catalogs(conn.merchant_id);
    const catalog = catalogs.find((c) => c.context?.includes('DEFAULT')) ?? catalogs[0];
    if (!catalog?.catalogId) return [];
    const cats = (await api.categories(conn.merchant_id, catalog.catalogId)).slice(
      0,
      MAX_CATEGORIES,
    );
    const out: RemoteItem[] = [];
    for (const c of cats) {
      if (!c?.id) continue;
      const body = await api.categoryItems(conn.merchant_id, c.id);
      out.push(...categoryItems({ id: c.id, name: c.name ?? '' }, body));
    }
    return out;
  }

  /** O que o Comandou mandou deste cardápio, e os códigos que já são do Comandou. */
  private async sent(tx: Tx, menuId: string) {
    const rows = await q<{
      local_id: string;
      remote_id: string;
      name: string;
      price: string;
      offer_hash: string | null;
      status: string;
    }>(
      tx,
      `SELECT sm.local_id, sm.remote_id, p.name, COALESCE(mi.price, p.price)::text AS price,
              sm.offer_hash, sm.status
         FROM ifood_sync_map sm
         JOIN products p ON p.id = sm.local_id
         LEFT JOIN menu_items mi ON mi.menu_id = sm.menu_id AND mi.product_id = p.id
        WHERE sm.menu_id = $1 AND sm.entity = 'item'`,
      [menuId],
    );
    const codes = await q<{ code: string }>(
      tx,
      `SELECT code FROM products WHERE code IS NOT NULL
       UNION SELECT 'CMD-' || substr(replace(id::text, '-', ''), 1, 12) FROM products`,
    );
    const sent: SentItem[] = rows.map((r) => ({
      localId: r.local_id,
      remoteId: r.remote_id,
      name: r.name,
      price: r.price,
      offerHash: r.offer_hash,
      available: r.status === 'AVAILABLE',
    }));
    return { sent, ownCodes: new Set(codes.map((c) => c.code)) };
  }

  /** Varredura: confere os cardápios do iFood ativos que passaram de 30 minutos. */
  async sweepTenant(tenantId: string) {
    if (!(await this.credentials.get('ifood'))) return;
    const due = await this.db.withTenant({ tenantId }, (tx) =>
      q<{ id: string }>(
        tx,
        `SELECT m.id FROM menus m JOIN ifood_connections c ON c.id = m.ifood_connection_id
          WHERE m.kind = 'ifood' AND m.active AND c.status = 'connected'
            AND (m.ifood_drift_at IS NULL OR m.ifood_drift_at < now() - make_interval(secs => $1))`,
        [DRIFT_SWEEP_SECONDS],
      ),
    );
    for (const m of due) await this.check(tenantId, m.id);
  }

  /** "Conferir agora": no máximo uma leitura por minuto. */
  async checkNow(tenantId: string, userId: string, menuId: string) {
    return this.drift(tenantId, userId, menuId, DRIFT_MIN_SECONDS);
  }

  // ------------------------------------------------------------------ reenviar

  /**
   * "Mandar o do Comandou": os itens mudados no portal voltam a ser enviados por inteiro (preço,
   * disponibilidade e nome do Comandou); item apagado lá é criado de novo.
   */
  async resend(tenantId: string, userId: string, menuId: string, localIds?: string[], ip?: string) {
    const m = await this.db.withTenant({ tenantId, userId }, (tx) => this.menu(tx, menuId));
    if (!m) throw new NotFoundException('Cardápio do iFood não encontrado');
    const changed = (m.ifood_drift?.changed ?? []).filter(
      (c) => !localIds || localIds.includes(c.localId),
    );
    if (!changed.length) throw new ConflictException('Nada para mandar de novo');
    const missing = changed.filter((c) => c.changes.some((x) => x.field === 'missing'));
    const other = changed.filter((c) => !missing.includes(c));
    await this.db.withTenant({ tenantId, userId }, async (tx) => {
      if (missing.length)
        await q(
          tx,
          `DELETE FROM ifood_sync_map WHERE menu_id = $1 AND entity = 'item' AND local_id = ANY($2::uuid[])`,
          [menuId, missing.map((c) => c.localId)],
        );
      if (other.length)
        await q(
          tx,
          `UPDATE ifood_sync_map SET shape_hash = NULL, offer_hash = NULL
            WHERE menu_id = $1 AND entity = 'item' AND local_id = ANY($2::uuid[])`,
          [menuId, other.map((c) => c.localId)],
        );
      const left = (m.ifood_drift?.changed ?? []).filter((c) => !changed.includes(c));
      await q(
        tx,
        `UPDATE menus SET ifood_drift = jsonb_set(COALESCE(ifood_drift, '{}'), '{changed}', $2::jsonb)
          WHERE id = $1`,
        [menuId, JSON.stringify(left)],
      );
      await this.audit.record(tx, {
        tenantId,
        actorUserId: userId,
        action: 'ifood.menu_resent',
        entity: 'menu',
        entityId: menuId,
        data: { items: changed.length },
        ip,
      });
    });
    const summary = await this.ifood.syncMenu(tenantId, menuId);
    if (!summary) await this.ifood.scheduleTenant(tenantId);
    return { resent: changed.length, summary };
  }

  // ------------------------------------------------------------------ trazer do iFood

  /**
   * Traz itens que só existem no iFood (da última conferência, lida pelo servidor) para o
   * Comandou: categoria pelo nome (ou nova), produto com o preço do iFood, complementos e o
   * vínculo com o item do iFood (o próximo envio não cria outro igual lá).
   */
  async importItems(
    tenantId: string,
    userId: string,
    menuId: string,
    itemIds: string[],
    ip?: string,
  ) {
    const res = await this.db.withTenant({ tenantId, userId }, async (tx) => {
      const m = await this.menu(tx, menuId);
      if (!m) throw new NotFoundException('Cardápio do iFood não encontrado');
      const wanted = new Set(itemIds);
      const picked = (m.ifood_drift?.onlyRemote ?? []).filter((r) => wanted.has(r.id));
      if (!picked.length)
        throw new ConflictException('Esses itens não estão na última leitura: confira de novo');
      await this.plans.assertCanAdd(tx, 'products', picked.length);
      const menus = (await ensureMenus(tx, tenantId)).filter(
        (x) => x.kind !== 'ifood' || x.id === menuId,
      );
      const catOf = new Map<string, { id: string; remoteId: string }>();
      const created: string[] = [];
      for (const r of picked) {
        const cat = catOf.get(r.categoryId) ?? (await this.categoryFor(tx, tenantId, menuId, r));
        catOf.set(r.categoryId, cat);
        const productId = await this.createProduct(tx, tenantId, menuId, cat, r, menus);
        created.push(productId);
      }
      const left = (m.ifood_drift?.onlyRemote ?? []).filter((r) => !wanted.has(r.id));
      await q(
        tx,
        `UPDATE menus SET ifood_drift = jsonb_set(COALESCE(ifood_drift, '{}'), '{onlyRemote}', $2::jsonb)
          WHERE id = $1`,
        [menuId, JSON.stringify(left)],
      );
      await this.audit.record(tx, {
        tenantId,
        actorUserId: userId,
        action: 'ifood.menu_imported',
        entity: 'menu',
        entityId: menuId,
        data: { items: created.length },
        ip,
      });
      return { imported: created.length, productIds: created };
    });
    this.realtime.publish(tenantId, { type: 'menu.changed' });
    this.realtime.publish(tenantId, { type: 'ifood.sync', menuId });
    return res;
  }

  /** Categoria do Comandou com o mesmo nome (ou nova), ligada à categoria do iFood. */
  private async categoryFor(tx: Tx, tenantId: string, menuId: string, r: RemoteItem) {
    const name = (r.categoryName || 'Do iFood').slice(0, 80);
    let cat = await one<{ id: string; position: number }>(
      tx,
      `SELECT id, position FROM categories WHERE active AND lower(trim(name)) = lower(trim($1))
        ORDER BY position LIMIT 1`,
      [name],
    );
    cat ??= await one<{ id: string; position: number }>(
      tx,
      `INSERT INTO categories (tenant_id, name, position)
       VALUES ($1, $2, (SELECT COALESCE(max(position), -1) + 1 FROM categories))
       RETURNING id, position`,
      [tenantId, name],
    );
    // Sem vínculo ainda: liga à categoria do iFood (o envio não cria outra igual lá).
    await q(
      tx,
      `INSERT INTO ifood_sync_map (tenant_id, menu_id, entity, local_id, remote_id, extra, shape_hash, status)
       VALUES ($1, $2, 'category', $3, $4, '{}', $5, 'AVAILABLE')
       ON CONFLICT (tenant_id, menu_id, entity, local_id) DO NOTHING`,
      [tenantId, menuId, cat!.id, r.categoryId, JSON.stringify([name, cat!.position])],
    );
    const mapped = await one<{ remote_id: string }>(
      tx,
      `SELECT remote_id FROM ifood_sync_map WHERE menu_id = $1 AND entity = 'category' AND local_id = $2`,
      [menuId, cat!.id],
    );
    return { id: cat!.id, remoteId: mapped?.remote_id ?? r.categoryId };
  }

  private async createProduct(
    tx: Tx,
    tenantId: string,
    menuId: string,
    cat: { id: string; remoteId: string },
    r: RemoteItem,
    menus: { id: string }[],
  ) {
    const categoryId = cat.id;
    const sector = await one<{ sector_id: string | null }>(
      tx,
      `SELECT sector_id FROM categories WHERE id = $1`,
      [categoryId],
    );
    const p = await one<{ id: string; code: string; position: number; price: string }>(
      tx,
      `INSERT INTO products (tenant_id, category_id, name, description, price, sector_id, code, sold_out)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, code, position, price::text`,
      [
        tenantId,
        categoryId,
        r.name,
        r.description,
        r.price,
        sector?.sector_id ?? null,
        await nextItemCode(tx),
        !r.available,
      ],
    );
    const groups: LocalItem['groups'] = [];
    const ids = {
      productId: r.productId,
      groups: {} as Record<string, string>,
      options: {} as Record<string, { id: string; productId: string }>,
    };
    for (const [gi, g] of r.groups.entries()) {
      const lg = await one<{ id: string }>(
        tx,
        `INSERT INTO option_groups (tenant_id, name, min_select, max_select, kind, charge)
         VALUES ($1, $2, $3, $4, 'additional', 'sum') RETURNING id`,
        [tenantId, g.name, g.min, g.max],
      );
      const opts: LocalItem['groups'][number]['options'] = [];
      for (const [oi, o] of g.options.entries()) {
        const lo = await one<{ id: string; price_delta: string }>(
          tx,
          `INSERT INTO options (tenant_id, group_id, name, price_delta, position, active)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, price_delta::text`,
          [tenantId, lg!.id, o.name, o.price, oi, o.available],
        );
        if (o.available) {
          opts.push({ id: lo!.id, name: o.name, priceDelta: lo!.price_delta });
          ids.options[lo!.id] = { id: o.id, productId: o.productId };
        }
      }
      await q(
        tx,
        `INSERT INTO product_option_groups (tenant_id, product_id, group_id, position) VALUES ($1,$2,$3,$4)`,
        [tenantId, p!.id, lg!.id, gi],
      );
      groups.push({ id: lg!.id, name: g.name, min: g.min, max: g.max, options: opts });
      ids.groups[lg!.id] = g.id;
    }
    for (const menu of menus)
      await q(
        tx,
        `INSERT INTO menu_items (tenant_id, menu_id, product_id, price) VALUES ($1,$2,$3,NULL)
         ON CONFLICT (tenant_id, menu_id, product_id) DO NOTHING`,
        [tenantId, menu.id, p!.id],
      );
    // Vínculo com o item do iFood: o envio compara com isto e não reenvia o que já está lá.
    const local: LocalItem = {
      id: p!.id,
      code: p!.code,
      name: r.name,
      description: r.description,
      price: p!.price,
      categoryId,
      available: r.available,
      imageId: null,
      position: p!.position,
      groups,
    };
    const fp = fingerprints(itemPayload(local, ids, r.id, cat.remoteId, null));
    await q(
      tx,
      `INSERT INTO ifood_sync_map (tenant_id, menu_id, entity, local_id, remote_id, extra, shape_hash, offer_hash, status)
       VALUES ($1, $8, 'item', $2, $3, $4::jsonb, $5, $6, $7)`,
      [
        tenantId,
        p!.id,
        r.id,
        JSON.stringify(ids),
        fp.shape,
        fp.offer,
        r.available ? 'AVAILABLE' : 'UNAVAILABLE',
        menuId,
      ],
    );
    // Pedido do iFood com este item já chega ligado ao produto novo.
    await q(
      tx,
      `INSERT INTO channel_item_links (tenant_id, channel, item_key, product_id)
       VALUES ($1, 'ifood', $2, $3) ON CONFLICT (tenant_id, channel, item_key) DO NOTHING`,
      [tenantId, itemKeyOf({ externalCode: r.externalCode ?? undefined, name: r.name }), p!.id],
    );
    return p!.id;
  }
}
