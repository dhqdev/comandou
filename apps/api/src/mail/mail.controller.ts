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
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { Public, SkipTenant } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PlatformHostGuard, PlatformSessionGuard } from '../platform/platform-auth';
import type { Actor } from '../platform/platform.service';
import { MailAdminService } from './mail-admin.service';
import { MailSettingsBody, TestSendBody } from './mail.schemas';

const LifecycleBody = z.object({ enabled: z.boolean() });

const actor = (req: Request): Actor => ({ admin: req.platformAdmin!, ip: req.ip });
const uuid = () => new ParseUUIDPipe();

/** Super Admin › E-mail: configuração do Resend, e-mail de teste e envios do sistema. */
@Controller({ path: 'platform/mail', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class MailController {
  constructor(private readonly admin: MailAdminService) {}

  @Get()
  async overview() {
    return { settings: await this.admin.settings() };
  }

  @Put('settings')
  saveSettings(
    @Body(new ZodPipe(MailSettingsBody)) b: z.infer<typeof MailSettingsBody>,
    @Req() req: Request,
  ) {
    return this.admin.saveSettings(b, actor(req));
  }

  @Post('settings/test')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  test(@Body(new ZodPipe(TestSendBody)) b: z.infer<typeof TestSendBody>, @Req() req: Request) {
    return this.admin.testSend(b.to, actor(req));
  }

  @Get('templates')
  templates() {
    return this.admin.templates();
  }

  @Put('lifecycle')
  setLifecycle(
    @Body(new ZodPipe(LifecycleBody)) b: z.infer<typeof LifecycleBody>,
    @Req() req: Request,
  ) {
    return this.admin.setLifecycle(b.enabled, actor(req));
  }

  @Post('templates/:id/test')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  sendSample(
    @Param('id') id: string,
    @Body(new ZodPipe(TestSendBody)) b: z.infer<typeof TestSendBody>,
    @Req() req: Request,
  ) {
    return this.admin.sendSample(id.slice(0, 40), b.to, actor(req));
  }

  @Get('outbox')
  outbox(@Query('status') status: string | undefined) {
    return this.admin.outbox(status);
  }

  @Post('outbox/:id/retry')
  @HttpCode(200)
  retryOutbox(@Param('id', uuid()) id: string) {
    return this.admin.retryOutbox(id);
  }

  @Post('outbox/:id/cancel')
  @HttpCode(200)
  cancelOutbox(@Param('id', uuid()) id: string) {
    return this.admin.cancelOutbox(id);
  }
}
