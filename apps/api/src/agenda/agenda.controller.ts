import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser } from '../common/decorators';
import { uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { AgendaService } from './agenda.service';

const instant = z.string().datetime({ offset: true });
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);

const Range = z
  .object({ from: instant, to: instant })
  .refine((r) => new Date(r.from) < new Date(r.to), 'período inválido')
  .refine(
    (r) => new Date(r.to).getTime() - new Date(r.from).getTime() <= 100 * 86_400_000,
    'período máximo de 100 dias',
  );

const Fields = z.object({
  title: z.string().trim().min(1, 'Dê um título').max(120),
  notes: optText(2000),
  startsAt: instant,
  endsAt: instant,
  allDay: z.boolean().optional(),
  tagId: uuid.nullable().optional(),
  done: z.boolean().optional(),
  remindAt: instant.nullable().optional(),
});
const Create = Fields.refine(
  (b) => new Date(b.endsAt) >= new Date(b.startsAt),
  'O fim vem antes do começo',
);
const Update = Fields.partial().refine((o) => Object.keys(o).length > 0, 'nada para atualizar');

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'cor no formato #RRGGBB');
const TagIn = z.object({ name: z.string().trim().min(1, 'Dê um nome').max(40), color });
const TagPatch = TagIn.partial();

const Settings = z.object({
  whatsappEnabled: z.boolean(),
  phone: z.string().trim().max(25).nullable(),
});

/**
 * Agenda pessoal (menu, ao lado de Novidades): qualquer pessoa da equipe usa a sua, sem
 * permissão especial. Tudo é filtrado por quem está logado.
 */
@Controller({ path: 'agenda', version: '1' })
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get('setup')
  setup(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.agenda.setup(ctxOf(t, u));
  }

  @Get('events')
  list(
    @Query(new ZodPipe(Range)) r: z.infer<typeof Range>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.agenda.list(ctxOf(t, u), r.from, r.to);
  }

  @Post('events')
  create(
    @Body(new ZodPipe(Create)) b: z.infer<typeof Create>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.agenda.create(ctxOf(t, u, req), b);
  }

  @Patch('events/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Update)) b: z.infer<typeof Update>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.agenda.update(ctxOf(t, u, req), id, b);
  }

  @Delete('events/:id')
  @HttpCode(204)
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.agenda.remove(ctxOf(t, u), id);
  }

  @Post('tags')
  createTag(
    @Body(new ZodPipe(TagIn)) b: z.infer<typeof TagIn>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.agenda.createTag(ctxOf(t, u), b);
  }

  @Patch('tags/:id')
  updateTag(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(TagPatch)) b: z.infer<typeof TagPatch>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.agenda.updateTag(ctxOf(t, u), id, b);
  }

  @Delete('tags/:id')
  @HttpCode(204)
  removeTag(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.agenda.removeTag(ctxOf(t, u), id);
  }

  @Put('settings')
  saveSettings(
    @Body(new ZodPipe(Settings)) b: z.infer<typeof Settings>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.agenda.saveSettings(ctxOf(t, u), b);
  }

  @Post('settings/test')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  test(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.agenda.sendTest(ctxOf(t, u));
  }
}
