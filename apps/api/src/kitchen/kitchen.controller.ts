import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { KitchenService } from './kitchen.service';

const SectorParam = z.union([uuid, z.literal('none')]).optional();

@Controller({ path: 'kitchen', version: '1' })
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get()
  @RequirePermission('orders:read')
  board(
    @Query(new ZodPipe(z.object({ sectorId: SectorParam }))) f: { sectorId?: string },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.kitchen.board(ctxOf(t, u), f.sectorId);
  }

  @Post('items/:id/:action')
  @RequirePermission('kitchen:operate')
  item(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('action', new ZodPipe(z.enum(['start', 'ready', 'reopen'])))
    action: 'start' | 'ready' | 'reopen',
    @Body(new ZodPipe(z.object({ reason: z.string().trim().max(300).optional() }).default({})))
    b: { reason?: string },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.kitchen.item(ctxOf(t, u, req), id, action, b.reason);
  }

  @Post('orders/:id/bump')
  @RequirePermission('kitchen:operate')
  bump(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(z.object({ to: z.enum(['preparing', 'ready']), sectorId: SectorParam })))
    b: { to: 'preparing' | 'ready'; sectorId?: string },
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.kitchen.bump(ctxOf(t, u, req), id, b.to, b.sectorId);
  }
}
