import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { FiscalService } from './fiscal.service';

const digits = (n: string, msg: string) => z.string().regex(new RegExp(`^[0-9]{${n}}$`), msg);

const Settings = z
  .object({
    enabled: z.boolean(),
    environment: z.enum(['homologacao', 'producao']),
    cnpj: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .pipe(digits('14', 'CNPJ com 14 dígitos'))
      .nullable(),
    token: z.string().trim().min(8).max(200).regex(/^\S+$/, 'token sem espaços').nullable(),
    defaultCfop: digits('4', 'CFOP com 4 dígitos'),
    defaultCode: digits('2,3', 'CSOSN/CST com 2 ou 3 dígitos'),
    defaultNcm: digits('8', 'NCM com 8 dígitos').nullable(),
    confirmProduction: z.boolean(),
  })
  .partial();

const ListQuery = z.object({
  orderId: z.string().uuid().optional(),
  status: z
    .enum(['pending', 'processing', 'authorized', 'rejected', 'error', 'cancelling', 'cancelled'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const Cancel = z.object({
  // A SEFAZ exige justificativa de 15 a 255 caracteres.
  reason: z.string().trim().min(15, 'Justificativa com pelo menos 15 caracteres').max(255),
});

/** Nota fiscal ao consumidor (NFC-e). O restaurante vem sempre do Host, nunca do corpo. */
@Controller({ version: '1' })
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

  @Get('fiscal/settings')
  @RequirePermission('fiscal:manage')
  settings(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.fiscal.getSettings(ctxOf(t, u));
  }

  @Put('fiscal/settings')
  @RequirePermission('fiscal:manage')
  save(
    @Body(new ZodPipe(Settings)) b: z.infer<typeof Settings>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.fiscal.saveSettings(ctxOf(t, u, req), b);
  }

  @Get('fiscal/documents')
  @RequirePermission('fiscal:emit', 'fiscal:manage')
  list(
    @Query(new ZodPipe(ListQuery)) f: z.infer<typeof ListQuery>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.fiscal.list(ctxOf(t, u), f);
  }

  @Get('fiscal/documents/:id')
  @RequirePermission('fiscal:emit', 'fiscal:manage')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.fiscal.get(ctxOf(t, u), id);
  }

  /** Pede a NFC-e do pedido. Repetir devolve a mesma nota (não emite duas). */
  @Post('orders/:id/nfce')
  @HttpCode(202)
  @RequirePermission('fiscal:emit')
  emit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.fiscal.request(ctxOf(t, u, req), id);
  }

  @Post('fiscal/documents/:id/sync')
  @HttpCode(202)
  @RequirePermission('fiscal:emit')
  sync(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.fiscal.sync(ctxOf(t, u), id);
  }

  @Post('fiscal/documents/:id/cancel')
  @HttpCode(200)
  @RequirePermission('fiscal:emit')
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Cancel)) b: z.infer<typeof Cancel>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.fiscal.cancel(ctxOf(t, u, req), id, b.reason);
  }
}
