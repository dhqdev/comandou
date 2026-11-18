import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Patch,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { isPinOnlyEmail, isValidCnpj, isValidCpf } from '@comandou/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { verifyPassword } from '../auth/password';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { one } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import { PlatformDb, platformAudit } from '../platform/platform-db.service';
import { TenantProfileBody } from '../platform/platform.schemas';
import { saveProfile } from '../platform/tenant-profile';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

/** Meus dados: nome e e-mail de entrada. Trocar o e-mail pede a senha atual. */
export const OwnAccountBody = z.object({
  name: z.string().trim().min(2, 'nome com 2 letras ou mais').max(80),
  email: z.string().trim().toLowerCase().email('e-mail inválido').max(254),
  currentPassword: z.string().max(200).optional(),
});

/**
 * Dados do restaurante que o dono mantém: o mesmo cadastro que o Super Admin vê (tabelas
 * `tenants` e `tenant_profiles` do banco central). As observações internas do painel ficam de
 * fora: o restaurante nunca lê nem grava `notes`.
 */
export const RestaurantDataBody = TenantProfileBody.omit({ notes: true })
  .extend({ name: z.string().trim().min(1, 'informe o nome do restaurante').max(120) })
  .refine((b) => !b.document || isValidCpf(b.document) || isValidCnpj(b.document), {
    message: 'CPF ou CNPJ inválido',
    path: ['document'],
  });

const FIELDS = [
  'name',
  'legalName',
  'document',
  'contactName',
  'phone',
  'billingEmail',
  'city',
  'state',
] as const;
type Field = (typeof FIELDS)[number];
type RestaurantData = Record<Field, string | null>;

const READ_SQL = `SELECT t.name, p.legal_name AS "legalName", p.document, p.contact_name AS "contactName",
       p.phone, p.billing_email::text AS "billingEmail", p.city, p.state
  FROM tenants t LEFT JOIN tenant_profiles p ON p.tenant_id = t.id WHERE t.id = $1`;

/** Só o administrador (dono) do restaurante mexe no cadastro da empresa. */
function ownerOnly(u: AuthenticatedUser) {
  if (u.role !== 'owner')
    throw new ForbiddenException('Só o administrador do restaurante altera estes dados');
}

/**
 * Conta › Meus dados e Conta › Dados do restaurante. O cadastro do restaurante mora no banco
 * central (o mesmo que o painel Super Admin lê): a gravação usa o papel da plataforma, como a
 * cobrança, e entra no histórico do restaurante no painel ("feito por <nome> (restaurante)").
 */
@Controller({ path: 'account', version: '1' })
export class StaffAccountController {
  constructor(
    private readonly db: DatabaseService,
    private readonly platform: PlatformDb,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async get(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return {
      me: { name: u.name, email: isPinOnlyEmail(u.email) ? null : u.email },
      restaurant: u.role === 'owner' ? await this.readRestaurant(t.id) : null,
    };
  }

  @Patch('me')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async updateMe(
    @Body(new ZodPipe(OwnAccountBody)) b: z.infer<typeof OwnAccountBody>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    if (isPinOnlyEmail(u.email))
      throw new ForbiddenException('Quem entra com PIN pede ao administrador para mudar os dados');
    const ctx = ctxOf(t, u);
    const emailChanged = b.email !== u.email.toLowerCase();
    if (emailChanged) {
      // O e-mail é o login da pessoa (em todos os restaurantes dela): pede a senha atual.
      const row = await this.db.withTenant(ctx, (tx) =>
        one<{ hash: string | null }>(tx, `SELECT app_own_password_hash() AS hash`),
      );
      if (!b.currentPassword || !row?.hash || !(await verifyPassword(b.currentPassword, row.hash)))
        throw new UnauthorizedException('Senha atual incorreta');
    }
    const fields = [...(b.name !== u.name ? ['name'] : []), ...(emailChanged ? ['email'] : [])];
    if (!fields.length) return { name: u.name, email: u.email };
    await this.db.withTenant(ctx, async (tx) => {
      const r = await one<{ r: string }>(tx, `SELECT app_update_own_account($1, $2) AS r`, [
        b.name,
        emailChanged ? b.email : null,
      ]);
      if (r?.r === 'taken') throw new ConflictException('Este e-mail já é usado por outra conta');
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'user.profile_updated',
        entity: 'user',
        entityId: u.id,
        data: { fields },
        ip: req.ip,
      });
    });
    // O dono aparece no painel (Visão geral › responsável): fica no histórico de lá também.
    if (u.role === 'owner' && this.platform.enabled)
      await this.platform
        .tx((c) =>
          platformAudit(c, {
            action: 'tenant.owner_updated',
            entity: 'user',
            entityId: u.id,
            tenantId: t.id,
            data: { by: b.name, userId: u.id, fields },
            ip: req.ip,
          }),
        )
        .catch(() => undefined);
    return { name: b.name, email: emailChanged ? b.email : u.email };
  }

  @Patch('restaurant')
  @RequirePermission('settings:manage')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async updateRestaurant(
    @Body(new ZodPipe(RestaurantDataBody)) b: z.infer<typeof RestaurantDataBody>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    ownerOnly(u);
    this.requirePlatform();
    const next: RestaurantData = {
      name: b.name,
      legalName: b.legalName ?? null,
      document: b.document ?? null,
      contactName: b.contactName ?? null,
      phone: b.phone ?? null,
      billingEmail: b.billingEmail ?? null,
      city: b.city ?? null,
      state: b.state ?? null,
    };
    const changed = await this.platform.tx(async (c) => {
      const cur = (await c.query<RestaurantData>(`${READ_SQL} FOR UPDATE OF t`, [t.id])).rows[0];
      if (!cur) throw new NotFoundException('Restaurante não encontrado');
      const fields = FIELDS.filter((k) => (cur[k] ?? null) !== next[k]);
      if (!fields.length) return fields;
      if (fields.includes('name'))
        await c.query(`UPDATE tenants SET name = $2 WHERE id = $1`, [t.id, next.name]);
      const { name: _name, ...profile } = next;
      await saveProfile(c, t.id, profile);
      await platformAudit(c, {
        action: 'tenant.profile_updated',
        entity: 'tenant',
        entityId: t.id,
        tenantId: t.id,
        data: {
          by: u.name,
          userId: u.id,
          fields,
          ...(fields.includes('name') ? { from: cur.name, to: next.name } : {}),
        },
        ip: req.ip,
      });
      return fields;
    });
    if (changed.length) {
      // Banco próprio do restaurante: o nome também vive lá (topo, e-mails, cupom).
      if (changed.includes('name')) {
        const h = await this.platform.tenantDb(t.id).catch(() => null);
        if (h && h.location.kind !== 'shared')
          await h
            .query(`UPDATE tenants SET name = $2 WHERE id = $1`, [t.id, next.name])
            .catch(() => undefined);
      }
      await this.db.withTenant(ctxOf(t, u), (tx) =>
        this.audit.record(tx, {
          tenantId: t.id,
          actorUserId: u.id,
          action: 'tenant.profile_updated',
          entity: 'tenant',
          entityId: t.id,
          data: { fields: changed },
          ip: req.ip,
        }),
      );
    }
    return this.readRestaurant(t.id);
  }

  private requirePlatform() {
    if (!this.platform.enabled)
      throw new ServiceUnavailableException('Cadastro do restaurante indisponível no momento');
  }

  private async readRestaurant(tenantId: string): Promise<RestaurantData | null> {
    if (!this.platform.enabled) return null;
    const [row] = await this.platform.query<RestaurantData>(READ_SQL, [tenantId]);
    return row ?? null;
  }
}
