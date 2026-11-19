import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CUSTOM_OD_RE } from '@comandou/shared';
import { z } from 'zod';
import { CurrentTenant, CurrentUser, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../../tenancy/tenant.types';
import { CONNECT_CHANNELS, OpenDeliveryService } from './opendelivery.service';

const ConnectBody = z.object({
  // Os conhecidos ou um aplicativo Open Delivery cadastrado no Super Admin (`od-<nome>`).
  channel: z.union([z.enum(CONNECT_CHANNELS), z.string().regex(CUSTOM_OD_RE)]),
  storeId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/, 'Código da loja inválido'),
  name: z.string().trim().max(160).default(''),
});

/** Aplicativos de delivery › Keeta, 99Food, Rappi e Open Delivery: ligar uma loja pelo código. */
@Controller({ path: 'channels', version: '1' })
export class OpenDeliveryController {
  constructor(private readonly svc: OpenDeliveryService) {}

  @Post('stores')
  @RequirePermission('settings:manage')
  connect(
    @Body(new ZodPipe(ConnectBody)) b: z.infer<typeof ConnectBody>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.svc.connect(t.id, u.id, b, req.ip);
  }
}
