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
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public, SkipTenant } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { PlatformHostGuard, PlatformSessionGuard } from '../platform-auth';
import {
  CancelContract,
  ContractSettingsBody,
  CountersignContract,
  NewContract,
  SendContract,
  SignContract,
} from '../platform.schemas';
import type { Actor } from '../platform.service';
import { ContractsService } from './contracts.service';

const actor = (req: Request): Actor => ({ admin: req.platformAdmin!, ip: req.ip });
/** Endereço do painel (admin.<base>), já validado pelo PlatformHostGuard. */
const origin = (req: Request) => `${req.protocol}://${req.get('host')}`;
const meta = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') });

function sendPdf(res: Response, f: { fileName: string; data: Buffer }, download: boolean) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${f.fileName}"`,
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(f.data);
}

/** Contrato de cada cliente no painel Super Admin. */
@Controller({ path: 'platform', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class ContractsController {
  constructor(private readonly svc: ContractsService) {}

  @Get('contracts/settings')
  settings() {
    return this.svc.settings();
  }

  @Put('contracts/settings')
  saveSettings(
    @Body(new ZodPipe(ContractSettingsBody)) b: z.infer<typeof ContractSettingsBody>,
    @Req() req: Request,
  ) {
    return this.svc.saveSettings(b, actor(req));
  }

  @Post('contracts/settings/test')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  testWebhook(@Req() req: Request) {
    return this.svc.testWebhook(actor(req));
  }

  @Get('tenants/:id/contracts')
  list(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.list(id);
  }

  @Post('tenants/:id/contracts')
  create(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(NewContract)) b: z.infer<typeof NewContract>,
    @Req() req: Request,
  ) {
    return this.svc.create(id, b, actor(req));
  }

  /** Assinados pelo cliente, esperando a contratada (aviso no painel). */
  @Get('contracts/pending')
  pending() {
    return this.svc.pending();
  }

  @Get('contracts/:cid')
  detail(@Param('cid', new ParseUUIDPipe()) cid: string) {
    return this.svc.detail(cid);
  }

  @Get('contracts/:cid/pdf')
  async pdf(
    @Param('cid', new ParseUUIDPipe()) cid: string,
    @Query('signed') signed: string | undefined,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    sendPdf(res, await this.svc.pdf(cid, signed === '1'), download === '1');
  }

  @Post('contracts/:cid/link')
  @HttpCode(200)
  link(@Param('cid', new ParseUUIDPipe()) cid: string, @Req() req: Request) {
    return this.svc.link(cid, actor(req), origin(req));
  }

  @Post('contracts/:cid/send')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  send(
    @Param('cid', new ParseUUIDPipe()) cid: string,
    @Body(new ZodPipe(SendContract)) b: z.infer<typeof SendContract>,
    @Req() req: Request,
  ) {
    return this.svc.send(cid, b, actor(req), origin(req));
  }

  @Post('contracts/:cid/cancel')
  @HttpCode(200)
  cancel(
    @Param('cid', new ParseUUIDPipe()) cid: string,
    @Body(new ZodPipe(CancelContract)) b: z.infer<typeof CancelContract>,
    @Req() req: Request,
  ) {
    return this.svc.cancel(cid, b.reason, actor(req));
  }

  @Post('contracts/:cid/notify')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  notify(@Param('cid', new ParseUUIDPipe()) cid: string, @Req() req: Request) {
    return this.svc.renotify(cid, actor(req), origin(req));
  }

  /** Assinatura da contratada (depois do cliente), com o código do autenticador. */
  @Post('contracts/:cid/countersign')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  countersign(
    @Param('cid', new ParseUUIDPipe()) cid: string,
    @Body(new ZodPipe(CountersignContract)) b: z.infer<typeof CountersignContract>,
    @Req() req: Request,
  ) {
    return this.svc.countersign(cid, b, actor(req), { userAgent: req.get('user-agent') });
  }
}

/**
 * Assinatura pelo cliente: link pessoal em admin.<base>/assinar/<token>, sem login. O token só
 * existe no e-mail (aqui fica o hash) e é trocado a cada novo envio.
 */
@Controller({ path: 'platform/sign', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard)
@Throttle({ default: { ttl: 60_000, limit: 30 } })
export class ContractSignController {
  constructor(private readonly svc: ContractsService) {}

  @Get(':token')
  open(@Param('token') token: string, @Req() req: Request) {
    return this.svc.open(token, meta(req));
  }

  @Post(':token/read')
  @HttpCode(200)
  read(@Param('token') token: string, @Req() req: Request) {
    return this.svc.markRead(token, meta(req));
  }

  @Post(':token')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  sign(
    @Param('token') token: string,
    @Body(new ZodPipe(SignContract)) b: z.infer<typeof SignContract>,
    @Req() req: Request,
  ) {
    return this.svc.sign(token, b, {
      ...meta(req),
      origin: origin(req),
      forwardedFor: req.get('x-forwarded-for'),
    });
  }

  @Get(':token/pdf')
  async pdf(
    @Param('token') token: string,
    @Query('signed') signed: string | undefined,
    @Res() res: Response,
  ) {
    sendPdf(res, await this.svc.publicPdf(token, signed === '1'), true);
  }
}
