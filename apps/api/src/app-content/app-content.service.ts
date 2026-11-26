import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Ctx } from '../common/context';
import { one, q } from '../common/sql';
import { DatabaseService, Tx } from '../database/database.service';

export interface FaqInput {
  section: string;
  question: string;
  answer: string;
  active: boolean;
}
export interface NoticeInput {
  title: string;
  body: string | null;
  imageId: string | null;
  targetType: 'none' | 'product' | 'coupon';
  target: string | null;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
}

const FAQ_COLS = `id, section, question, answer, active, position`;
const NOTICE_COLS = `id, title, body, image_id AS "imageId", target_type AS "targetType", target,
  starts_at AS "startsAt", ends_at AS "endsAt", active, created_at AS "createdAt"`;
const MAX_FAQ = 60;
const MAX_NOTICES = 100;
const mediaUrl = (id: string | null) => (id ? `/api/v1/media/${id}` : null);

/**
 * Conteúdo das telas do app do cliente que a loja escreve: Ajuda (perguntas e respostas), Avisos
 * (a tela Notificações) e Sobre (texto e Instagram). O resto das telas da Conta sai do cadastro
 * da loja (endereço, horário, WhatsApp) e do programa de fidelidade.
 */
@Injectable()
export class AppContentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private faqIn(tx: Tx, onlyActive = false) {
    return q<FaqInput & { id: string; position: number }>(
      tx,
      `SELECT ${FAQ_COLS} FROM store_faq ${onlyActive ? 'WHERE active' : ''}
        ORDER BY position, created_at`,
    );
  }

  private noticesIn(tx: Tx, onlyLive = false) {
    return q<
      Omit<NoticeInput, 'startsAt' | 'endsAt'> & {
        id: string;
        startsAt: Date;
        endsAt: Date | null;
        createdAt: Date;
      }
    >(
      tx,
      `SELECT ${NOTICE_COLS} FROM store_notices
        ${onlyLive ? `WHERE active AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())` : ''}
        ORDER BY starts_at DESC LIMIT ${onlyLive ? 30 : MAX_NOTICES}`,
    );
  }

  private aboutIn(tx: Tx) {
    return one<{ about: string | null; instagram: string | null }>(
      tx,
      `SELECT app_about AS about, app_instagram AS instagram FROM tenant_store_settings`,
    );
  }

  // ---------------------------------------------------------------- equipe

  overview(ctx: Ctx) {
    return this.db.withTenant(ctx, async (tx) => {
      const a = await this.aboutIn(tx);
      return {
        about: a?.about ?? null,
        instagram: a?.instagram ?? null,
        faq: await this.faqIn(tx),
        notices: await this.noticesIn(tx),
      };
    });
  }

  async saveAbout(ctx: Ctx, about: string | null, instagram: string | null) {
    return this.db.withTenant(ctx, async (tx) => {
      await q(
        tx,
        `INSERT INTO tenant_store_settings (tenant_id, app_about, app_instagram) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id) DO UPDATE SET app_about = EXCLUDED.app_about,
                                               app_instagram = EXCLUDED.app_instagram`,
        [ctx.tenantId, about, instagram],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'app_content.about_updated',
        entity: 'store',
        entityId: ctx.tenantId,
        ip: ctx.ip,
      });
      return { about, instagram };
    });
  }

  /** Troca a lista inteira da Ajuda (a tela edita tudo junto, na ordem). */
  async saveFaq(ctx: Ctx, items: FaqInput[]) {
    if (items.length > MAX_FAQ)
      throw new UnprocessableEntityException(`No máximo ${MAX_FAQ} perguntas`);
    return this.db.withTenant(ctx, async (tx) => {
      await q(tx, `DELETE FROM store_faq`);
      for (const [i, f] of items.entries())
        await q(
          tx,
          `INSERT INTO store_faq (tenant_id, section, question, answer, active, position)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [ctx.tenantId, f.section, f.question, f.answer, f.active, i],
        );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'app_content.faq_updated',
        entity: 'store',
        entityId: ctx.tenantId,
        data: { questions: items.length },
        ip: ctx.ip,
      });
      return this.faqIn(tx);
    });
  }

  private checkNotice(n: Partial<NoticeInput>) {
    if (n.targetType && n.targetType !== 'none' && !n.target)
      throw new UnprocessableEntityException('Escolha para onde o aviso leva');
    if (n.startsAt && n.endsAt && new Date(n.endsAt) <= new Date(n.startsAt))
      throw new UnprocessableEntityException('O fim precisa ser depois do início');
  }

  async createNotice(ctx: Ctx, n: NoticeInput) {
    this.checkNotice(n);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM store_notices`);
      if ((c?.n ?? 0) >= MAX_NOTICES)
        throw new UnprocessableEntityException('Limite de avisos: apague os antigos');
      const r = await one<{ id: string }>(
        tx,
        `INSERT INTO store_notices (tenant_id, title, body, image_id, target_type, target, starts_at,
                                    ends_at, active)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()),$8,$9) RETURNING id`,
        [
          ctx.tenantId,
          n.title,
          n.body,
          n.imageId,
          n.targetType,
          n.targetType === 'none' ? null : n.target,
          n.startsAt,
          n.endsAt,
          n.active,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'app_content.notice_created',
        entity: 'store_notice',
        entityId: r!.id,
        data: { title: n.title },
        ip: ctx.ip,
      });
      return (await this.noticesIn(tx)).find((x) => x.id === r!.id)!;
    });
  }

  async updateNotice(ctx: Ctx, id: string, patch: Partial<NoticeInput>) {
    return this.db.withTenant(ctx, async (tx) => {
      const cur = (await this.noticesIn(tx)).find((x) => x.id === id);
      if (!cur) throw new NotFoundException('Aviso não encontrado');
      const next = {
        ...cur,
        startsAt: cur.startsAt.toISOString(),
        endsAt: cur.endsAt?.toISOString() ?? null,
        ...patch,
      };
      this.checkNotice(next);
      await q(
        tx,
        `UPDATE store_notices SET title = $2, body = $3, image_id = $4, target_type = $5, target = $6,
                starts_at = COALESCE($7, starts_at), ends_at = $8, active = $9 WHERE id = $1`,
        [
          id,
          next.title,
          next.body,
          next.imageId,
          next.targetType,
          next.targetType === 'none' ? null : next.target,
          next.startsAt,
          next.endsAt,
          next.active,
        ],
      );
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'app_content.notice_updated',
        entity: 'store_notice',
        entityId: id,
        data: { changes: Object.keys(patch) },
        ip: ctx.ip,
      });
      return (await this.noticesIn(tx)).find((x) => x.id === id)!;
    });
  }

  async deleteNotice(ctx: Ctx, id: string) {
    await this.db.withTenant(ctx, async (tx) => {
      const r = await one(tx, `DELETE FROM store_notices WHERE id = $1 RETURNING id`, [id]);
      if (!r) throw new NotFoundException('Aviso não encontrado');
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'app_content.notice_deleted',
        entity: 'store_notice',
        entityId: id,
        ip: ctx.ip,
      });
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------- cliente (cardápio)

  /** Telas Ajuda, Notificações, Sobre e Escolher loja do app. */
  publicView(tenantId: string) {
    return this.db.withTenant({ tenantId }, async (tx) => {
      const s = await one<{
        about: string | null;
        instagram: string | null;
        storeAbout: string | null;
        address: string | null;
        whatsapp: string | null;
        hoursEnabled: boolean;
        hours: { day: number; open: string; close: string }[] | null;
        lat: string | null;
        lng: string | null;
      }>(
        tx,
        `SELECT app_about AS about, app_instagram AS instagram, about AS "storeAbout", address,
                whatsapp, hours_enabled AS "hoursEnabled", hours, store_lat::text AS lat,
                store_lng::text AS lng
           FROM tenant_store_settings`,
      );
      return {
        about: s?.about ?? s?.storeAbout ?? null,
        instagram: s?.instagram ?? null,
        address: s?.address ?? null,
        whatsapp: s?.whatsapp ?? null,
        hours: s?.hoursEnabled ? (s.hours ?? []) : [],
        location: s?.lat && s?.lng ? { lat: Number(s.lat), lng: Number(s.lng) } : null,
        faq: (await this.faqIn(tx, true)).map(({ section, question, answer, id }) => ({
          id,
          section,
          question,
          answer,
        })),
        notices: (await this.noticesIn(tx, true)).map(({ imageId, active: _a, ...n }) => ({
          ...n,
          imageUrl: mediaUrl(imageId),
        })),
      };
    });
  }
}
