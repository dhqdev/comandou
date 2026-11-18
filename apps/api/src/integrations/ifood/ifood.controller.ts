import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service';
import { CurrentTenant, CurrentUser, RequirePermission } from '../../common/decorators';
import { one } from '../../common/sql';
import { ZodPipe } from '../../common/zod.pipe';
import { DatabaseService } from '../../database/database.service';
import { sniff } from '../../store/store.controller';
import type { AuthenticatedUser, ResolvedTenant } from '../../tenancy/tenant.types';
import { IfoodService } from './ifood.service';
import { summaryText, type SyncSummary } from './ifood-sync';

const Connect = z.object({
  merchantId: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F-]{8,64}$/, 'id da loja no iFood (ex.: 1a2b3c4d-…)'),
});
const Confirm = z.object({ authorizationCode: z.string().trim().min(4).max(200) });
/** Cardápio de integração com o iFood: lojas ligadas e sincronização. */
@Controller({ path: 'ifood', version: '1' })
export class IfoodController {
  constructor(
    private readonly db: DatabaseService,
    private readonly ifood: IfoodService,
    private readonly audit: AuditService,
  ) {}

  @Get('status')
  @RequirePermission('catalog:read')
  status() {
    return this.ifood.status();
  }

  @Get('connections')
  @RequirePermission('catalog:read')
  connections(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      this.ifood.listConnections(tx),
    );
  }

  /** Modo centralizado: liga a loja pelo id (a loja autorizou o app no Portal do Parceiro). */
  @Post('connections')
  @RequirePermission('settings:manage')
  async connect(
    @Body(new ZodPipe(Connect)) b: z.infer<typeof Connect>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const c = await this.ifood.connectCentralized(t.id, u.id, b.merchantId);
    await this.record(t.id, u.id, 'ifood.connected', c.id, { merchantId: c.merchantId }, req);
    return c;
  }

  /** Modo distribuído, passo 1: gera o código para autorizar no Portal do Parceiro. */
  @Post('connections/authorize')
  @RequirePermission('settings:manage')
  authorize(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.ifood.startAuthorization(t.id, u.id);
  }

  /** Passo 2: código de autorização que o iFood mostra depois de aprovar. */
  @Post('connections/confirm')
  @RequirePermission('settings:manage')
  async confirm(
    @Body(new ZodPipe(Confirm)) b: z.infer<typeof Confirm>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const list = await this.ifood.confirmAuthorization(t.id, u.id, b.authorizationCode);
    for (const c of list)
      await this.record(t.id, u.id, 'ifood.connected', c.id, { merchantId: c.merchantId }, req);
    return list;
  }

  @Delete('connections/:id')
  @RequirePermission('settings:manage')
  async disconnect(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const r = await this.ifood.removeConnection(t.id, u.id, id);
    await this.record(t.id, u.id, 'ifood.disconnected', id, { merchantId: r.merchant_id }, req);
    return { ok: true };
  }

  @Get('menus/:id/sync')
  @RequirePermission('catalog:read')
  async state(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const s = await this.db.withTenant({ tenantId: t.id, userId: u.id }, async (tx) => {
      const st = await this.ifood.syncState(tx, id);
      if (!st) return null;
      const pending = await this.ifood.pendingImages(tx, id);
      return { ...st, pendingImages: pending.map((p) => p.mediaId) };
    });
    if (!s) throw new NotFoundException('Cardápio do iFood não encontrado');
    return withText(s);
  }

  /**
   * Foto em WebP convertida em JPG pelo navegador (o iFood só aceita JPG/PNG). O corpo é a
   * própria imagem (image/jpeg), como no POST /media.
   */
  @Post('menus/:id/images/:mediaId')
  @HttpCode(200)
  @RequirePermission('catalog:write')
  async image(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('mediaId', new ParseUUIDPipe()) mediaId: string,
    @Body() body: unknown,
    @Headers('content-type') type: string | undefined,
    @CurrentTenant() t: ResolvedTenant,
  ) {
    const mime = (type ?? '').split(';')[0]!.trim().toLowerCase();
    if (!['image/jpeg', 'image/png'].includes(mime) || !Buffer.isBuffer(body) || !body.length)
      throw new UnprocessableEntityException('Envie a foto em JPG ou PNG');
    if (sniff(body) !== mime)
      throw new UnprocessableEntityException('O arquivo não é uma imagem válida');
    await this.ifood.assertConfigured();
    return this.ifood.uploadImages(
      t.id,
      id,
      new Map([[mediaId, `data:${mime};base64,${body.toString('base64')}`]]),
    );
  }

  /** Sincroniza agora e devolve o resumo. */
  @Post('menus/:id/sync')
  @HttpCode(200)
  @RequirePermission('catalog:write')
  async sync(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const exists = await this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      one(tx, `SELECT 1 FROM menus WHERE id = $1 AND kind = 'ifood'`, [id]),
    );
    if (!exists) throw new NotFoundException('Cardápio do iFood não encontrado');
    // Valida a configuração antes de marcar como "enviando".
    await this.ifood.assertConfigured();
    const summary = await this.ifood.syncMenu(t.id, id);
    await this.record(t.id, u.id, 'ifood.menu_synced', id, { ran: !!summary }, req, 'menu');
    const st = await this.db.withTenant({ tenantId: t.id, userId: u.id }, (tx) =>
      this.ifood.syncState(tx, id),
    );
    return withText({ ...st, busy: !summary });
  }

  private record(
    tenantId: string,
    userId: string,
    action: string,
    entityId: string,
    data: Record<string, unknown>,
    req: Request,
    entity = 'ifood_connection',
  ) {
    return this.db.withTenant({ tenantId, userId }, (tx) =>
      this.audit.record(tx, {
        tenantId,
        actorUserId: userId,
        action,
        entity,
        entityId,
        data,
        ip: req.ip,
      }),
    );
  }
}

function withText<T extends object>(s: T) {
  const summary = (s as { summary?: SyncSummary | null }).summary;
  return { ...s, text: summary ? summaryText(summary) : null };
}
