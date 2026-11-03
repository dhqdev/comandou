import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { uuid } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { AiAgentService } from './ai-agent.service';

const text = (max: number) => z.string().trim().max(max).nullable();

const Settings = z
  .object({
    whatsappEnabled: z.boolean(),
    agentName: z.string().trim().max(30).nullable(),
    tone: z.enum(['friendly', 'formal', 'fun']),
    greeting: text(300),
    about: text(1500),
    rules: text(1000),
    handoffMessage: text(300),
    suggestItems: z.boolean(),
    showPrices: z.boolean(),
    sendStoreLink: z.boolean(),
    replyWhen: z.enum(['always', 'open']),
  })
  .partial();

const Visible = z.union([
  z.object({ ids: z.array(uuid).min(1).max(1000), visible: z.boolean() }),
  z.object({ all: z.literal(true), visible: z.boolean() }),
]);

const Test = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1]!.role === 'user', 'a última mensagem é do cliente'),
  draft: Settings.optional(),
});

/**
 * IA do restaurante no painel do gerente: como ela atende, quais itens do cardápio ela enxerga
 * e um teste de conversa como se fosse um cliente.
 */
@Controller({ path: 'ai-agent', version: '1' })
export class AiAgentController {
  constructor(private readonly agent: AiAgentService) {}

  @Get()
  @RequirePermission('settings:manage')
  overview(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.agent.overview(ctxOf(t, u));
  }

  @Put()
  @RequirePermission('settings:manage')
  save(
    @Body(new ZodPipe(Settings)) b: z.infer<typeof Settings>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.agent.save(ctxOf(t, u), b);
  }

  @Get('menu')
  @RequirePermission('settings:manage')
  menu(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.agent.menuItems(ctxOf(t, u));
  }

  @Put('menu')
  @RequirePermission('settings:manage')
  visible(
    @Body(new ZodPipe(Visible)) b: z.infer<typeof Visible>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.agent.setVisible(ctxOf(t, u), b);
  }

  @Post('test')
  @HttpCode(200)
  @RequirePermission('settings:manage')
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  test(
    @Body(new ZodPipe(Test)) b: z.infer<typeof Test>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.agent.test(ctxOf(t, u), b);
  }
}
