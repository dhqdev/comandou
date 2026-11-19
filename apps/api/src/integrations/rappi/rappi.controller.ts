import {
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public, SkipCsrf, SkipTenant } from '../../common/decorators';
import { PlatformHostGuard } from '../../platform/platform-auth';
import { RAPPI_HOOKS, RappiService, type RappiHook } from './rappi.service';

/**
 * Webhooks da Rappi em admin.<base>/api/v1/platform/channels/webhooks/rappi/<aviso> (um endereço
 * por aviso, cadastrado na Rappi). Sem sessão e sem o cabeçalho anti-CSRF: vale a assinatura
 * Rappi-Signature sobre o corpo cru, com o segredo cifrado em Credenciais; limite por minuto.
 */
@Controller({ path: 'platform/channels/webhooks/rappi', version: '1' })
@SkipTenant()
@Public()
@SkipCsrf()
@UseGuards(PlatformHostGuard)
@Throttle({ default: { ttl: 60_000, limit: 600 } })
export class RappiWebhookController {
  constructor(private readonly svc: RappiService) {}

  @Post(':hook')
  @HttpCode(200)
  hook(@Param('hook') hook: string, @Req() req: Request & { rawBody?: Buffer }) {
    if (!(RAPPI_HOOKS as readonly string[]).includes(hook)) throw new NotFoundException();
    return this.svc.webhook(hook as RappiHook, req.get('rappi-signature'), req.rawBody);
  }
}
