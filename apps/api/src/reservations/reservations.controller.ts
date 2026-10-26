import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { isoDate, uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import { cookieOf, CUSTOMER_COOKIE, CustomersService } from '../store/customers.service';
import { PUBLIC_TOKEN_RE } from '../store/store.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { RESERVATION_STATUSES, ReservationsService } from './reservations.service';

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullable()
  .optional()
  .refine((v) => !v || z.string().email().safeParse(v).success, 'E-mail inválido')
  .transform((v) => v || null);
const instant = z.string().datetime({ offset: true });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'horário no formato HH:MM');

const PublicCreate = z.object({
  token: z.string().regex(PUBLIC_TOKEN_RE, 'token inválido'),
  name: text(80),
  phone: z.string().trim().max(25),
  email,
  partySize: z.number().int().min(1).max(100),
  startsAt: instant,
  occasion: optText(40),
  notes: optText(300),
});

const StaffFields = z.object({
  name: text(80),
  phone: z.string().trim().max(25),
  email,
  partySize: z.number().int().min(1).max(100),
  startsAt: instant,
  occasion: optText(40),
  notes: optText(300),
  staffNotes: optText(300),
  tableId: uuid.nullable().optional(),
  status: z.enum(RESERVATION_STATUSES).optional(),
  cancelReason: optText(200),
});
const StaffPatch = StaffFields.partial().refine(
  (o) => Object.keys(o).length > 0,
  'nada para atualizar',
);

const Settings = z
  .object({
    enabled: z.boolean(),
    autoConfirm: z.boolean(),
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .transform((d) => [...new Set(d)].sort()),
    opensAt: hhmm,
    closesAt: hhmm,
    slotMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    durationMinutes: z.number().int().min(15).max(600),
    maxParty: z.number().int().min(1).max(100),
    capacity: z.number().int().min(1).max(5000).nullable(),
    minAdvanceMinutes: z.number().int().min(0).max(10080),
    maxDaysAhead: z.number().int().min(1).max(365),
    note: z
      .string()
      .trim()
      .max(300)
      .nullable()
      .transform((v) => v || null),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'nada para atualizar');

const Range = z
  .object({ from: instant, to: instant })
  .refine((r) => new Date(r.from) < new Date(r.to), 'período inválido')
  .refine(
    (r) => new Date(r.to).getTime() - new Date(r.from).getTime() <= 62 * 86_400_000,
    'período máximo de 62 dias',
  );

/** Reservas pelo cardápio online (cliente final, sem login da equipe). */
@Controller({ path: 'store/reservations', version: '1' })
export class PublicReservationsController {
  constructor(
    private readonly reservations: ReservationsService,
    private readonly customers: CustomersService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get('config')
  config(@CurrentTenant() t: ResolvedTenant) {
    return this.reservations.publicConfig(t.id);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get('availability')
  availability(
    @Query('date', new ZodPipe(isoDate)) date: string,
    @CurrentTenant() t: ResolvedTenant,
  ) {
    return this.reservations.availability(t.id, date);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post()
  async create(
    @Body(new ZodPipe(PublicCreate)) b: z.infer<typeof PublicCreate>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const c = await this.customers.resolve(t.id, cookieOf(req, CUSTOMER_COOKIE));
    return this.reservations.createPublic(
      t.id,
      {
        ...b,
        email: b.email ?? undefined,
        occasion: b.occasion ?? undefined,
        notes: b.notes ?? undefined,
        customerId: c?.id,
      },
      req.ip,
    );
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get(':token')
  view(@Param('token') token: string, @CurrentTenant() t: ResolvedTenant) {
    return this.reservations.publicView(t.id, token);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(':token/cancel')
  @HttpCode(200)
  cancel(@Param('token') token: string, @CurrentTenant() t: ResolvedTenant, @Req() req: Request) {
    return this.reservations.cancelByCustomer(t.id, token, req.ip);
  }
}

/** Agenda de reservas da equipe e regras das reservas online. */
@Controller({ path: 'reservations', version: '1' })
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get('settings')
  @RequirePermission('orders:manage', 'settings:manage')
  settings(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.reservations.settings(ctxOf(t, u));
  }

  @Patch('settings')
  @RequirePermission('settings:manage')
  updateSettings(
    @Body(new ZodPipe(Settings)) b: z.infer<typeof Settings>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.reservations.updateSettings(ctxOf(t, u, req), b);
  }

  @Get()
  @RequirePermission('orders:manage', 'settings:manage')
  list(
    @Query(new ZodPipe(Range)) r: z.infer<typeof Range>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.reservations.list(ctxOf(t, u), r.from, r.to);
  }

  @Post()
  @RequirePermission('orders:manage', 'settings:manage')
  create(
    @Body(new ZodPipe(StaffFields)) b: z.infer<typeof StaffFields>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.reservations.create(ctxOf(t, u, req), b);
  }

  @Patch(':id')
  @RequirePermission('orders:manage', 'settings:manage')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(StaffPatch)) b: z.infer<typeof StaffPatch>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.reservations.update(ctxOf(t, u, req), id, b);
  }
}
