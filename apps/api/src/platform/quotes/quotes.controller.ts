import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public, SkipTenant } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { PlatformHostGuard, PlatformSessionGuard } from '../platform-auth';
import { NewQuote, QuoteSettingsBody } from '../platform.schemas';
import type { Actor } from '../platform.service';
import { QuotesService } from './quotes.service';

const actor = (req: Request): Actor => ({ admin: req.platformAdmin!, ip: req.ip });

/** Orçamento em PDF no Super Admin (aba Orçamento). */
@Controller({ path: 'platform/quotes', version: '1' })
@SkipTenant()
@Public()
@UseGuards(PlatformHostGuard, PlatformSessionGuard)
export class QuotesController {
  constructor(private readonly svc: QuotesService) {}

  @Get()
  overview() {
    return this.svc.overview();
  }

  @Put('settings')
  saveSettings(
    @Body(new ZodPipe(QuoteSettingsBody)) b: z.infer<typeof QuoteSettingsBody>,
    @Req() req: Request,
  ) {
    return this.svc.saveSettings(b, actor(req));
  }

  @Post()
  create(@Body(new ZodPipe(NewQuote)) b: z.infer<typeof NewQuote>, @Req() req: Request) {
    return this.svc.create(b, actor(req));
  }

  @Get(':id/pdf')
  async pdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    const f = await this.svc.pdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${download === '1' ? 'attachment' : 'inline'}; filename="${f.fileName}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(f.data);
  }
}
