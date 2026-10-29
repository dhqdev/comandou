import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { cleanOutfit, DEFAULT_MASCOT, MASCOT_ITEMS, type MascotPrefs } from '@comandou/shared';
import { ctxOf } from '../common/context';
import { AllowWhenBlocked, CurrentTenant, CurrentUser } from '../common/decorators';
import { one } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

const ids = MASCOT_ITEMS.map((i) => i.id) as [string, ...string[]];
const Prefs = z.object({
  outfit: z
    .object({ head: z.enum(ids).optional(), neck: z.enum(ids).optional() })
    .strict()
    .refine((o) => JSON.stringify(cleanOutfit(o)) === JSON.stringify(o), 'peça no lugar errado'),
  stroll: z.boolean(),
});

/**
 * Roupinha do panda de quem está logado. Vale para qualquer papel e também com o restaurante
 * bloqueado pela cobrança (é só gosto pessoal, não mexe na operação).
 */
@Controller({ path: 'me/mascot', version: '1' })
@AllowWhenBlocked()
export class MascotController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: ResolvedTenant,
  ): Promise<MascotPrefs> {
    const ctx = ctxOf(tenant, user);
    const row = await this.db.withTenant(ctx, (tx) =>
      one<{ outfit: unknown; stroll: boolean }>(
        tx,
        `SELECT outfit, stroll FROM mascot_prefs WHERE user_id = $1`,
        [user.id],
      ),
    );
    return row ? { outfit: cleanOutfit(row.outfit), stroll: row.stroll } : DEFAULT_MASCOT;
  }

  @Put()
  async put(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: ResolvedTenant,
    @Body(new ZodPipe(Prefs)) body: z.infer<typeof Prefs>,
    @Req() req: Request,
  ): Promise<MascotPrefs> {
    const ctx = ctxOf(tenant, user, req);
    const outfit = cleanOutfit(body.outfit);
    await this.db.withTenant(ctx, (tx) =>
      one(
        tx,
        `INSERT INTO mascot_prefs (tenant_id, user_id, outfit, stroll) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET outfit = EXCLUDED.outfit, stroll = EXCLUDED.stroll, updated_at = now()`,
        [tenant.id, user.id, JSON.stringify(outfit), body.stroll],
      ),
    );
    return { outfit, stroll: body.stroll };
  }
}
