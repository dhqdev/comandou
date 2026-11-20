import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ctxOf } from '../common/context';
import {
  AllowWhenBlocked,
  CurrentTenant,
  CurrentUser,
  Public,
  RequirePermission,
} from '../common/decorators';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';
import { JOB_SELECT, PrintingService } from './printing.service';
import { TEMPLATE_KINDS, TEMPLATE_MAX, TemplateKind } from './templates';

const Agent = z.object({ name: z.string().trim().min(1).max(60), active: z.boolean().optional() });
const JobsQuery = z.object({
  status: z.enum(['queued', 'printing', 'done', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const Discard = z.object({ ids: z.array(z.string().uuid()).min(1).max(200).optional() });
const Target = z.object({ target: z.string().trim().min(1).max(60) });
const PrintOrder = z.object({ kind: z.enum(['kitchen', 'receipt', 'delivery']) });
const Claim = z.object({ limit: z.number().int().min(1).max(20).default(5) });
const Heartbeat = z.object({
  version: z.string().trim().max(40).optional(),
  /** Impressoras escolhidas no aplicativo: destino (null = principal) e o nome para mostrar. */
  printers: z
    .array(
      z.object({
        target: z.string().trim().max(60).nullable(),
        label: z.string().trim().max(80),
        kind: z.enum(['usb', 'network', 'bluetooth', 'serial', 'document', 'none']),
      }),
    )
    .max(40)
    .optional(),
});
const Result = z.object({ ok: z.boolean(), error: z.string().max(300).optional() });

const Kind = z.enum(TEMPLATE_KINDS);
const TemplateBody = z.object({ body: z.string().min(1).max(TEMPLATE_MAX) });
const Preview = TemplateBody.extend({
  kind: Kind,
  orderId: z.string().uuid().nullable().optional(),
});

const AGENT_COLS = `id, name, active, last_seen_at AS "lastSeenAt", version, created_at AS "createdAt",
  (last_seen_at > now() - interval '2 minutes') AS online, printers`;

/** Configuração de impressão (agentes e fila) para a equipe do restaurante. */
/** Bloqueio por cobrança não trava o que termina a venda já feita (só pedidos novos). */
@AllowWhenBlocked()
@Controller({ version: '1' })
export class PrintingController {
  constructor(
    private readonly db: DatabaseService,
    private readonly printing: PrintingService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get('printing/agents')
  @RequirePermission('printing:manage')
  agents(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      q(tx, `SELECT ${AGENT_COLS} FROM print_agents ORDER BY created_at`),
    );
  }

  /** Cria um agente. O token aparece SÓ nesta resposta (guardamos apenas o hash). */
  @Post('printing/agents')
  @RequirePermission('printing:manage')
  createAgent(
    @Body(new ZodPipe(Agent)) b: z.infer<typeof Agent>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const { token, hash } = this.printing.newAgentToken();
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const a = await one<{ id: string }>(
        tx,
        `INSERT INTO print_agents (tenant_id, name, token_hash, active) VALUES ($1,$2,$3,$4) RETURNING ${AGENT_COLS}`,
        [t.id, b.name, hash, b.active ?? true],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'printing.agent_created',
        entity: 'print_agent',
        entityId: a!.id,
        data: { name: b.name },
        ip: req.ip,
      });
      return { agent: a, token };
    });
  }

  // ------------------------------------------------------------- modelos de impressão
  /** Modelos (Liquid) da conferência, da comanda da cozinha e do rodapé do cupom fiscal. */
  @Get('printing/templates')
  @RequirePermission('printing:manage')
  templates(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.printing.listTemplates(ctxOf(t, u));
  }

  @Put('printing/templates/:kind')
  @RequirePermission('printing:manage')
  saveTemplate(
    @Param('kind', new ZodPipe(Kind)) kind: TemplateKind,
    @Body(new ZodPipe(TemplateBody)) b: z.infer<typeof TemplateBody>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const ctx = ctxOf(t, u);
    return this.db.withTenant(ctx, async (tx) => {
      await this.printing.saveTemplate(tx, ctx, kind, b.body);
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'printing.template_saved',
        entity: 'print_template',
        entityId: t.id,
        data: { kind, length: b.body.length },
        ip: req.ip,
      });
      return { ok: true };
    });
  }

  /** Volta ao leiaute padrão do Comandou. */
  @Delete('printing/templates/:kind')
  @RequirePermission('printing:manage')
  resetTemplate(
    @Param('kind', new ZodPipe(Kind)) kind: TemplateKind,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      await tx.$client.query(`DELETE FROM print_templates WHERE kind = $1`, [kind]);
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'printing.template_reset',
        entity: 'print_template',
        entityId: t.id,
        data: { kind },
        ip: req.ip,
      });
      return { ok: true };
    });
  }

  /** Prévia: monta o texto com o último pedido (ou o escolhido), sem imprimir nada. */
  @Post('printing/templates/preview')
  @HttpCode(200)
  @RequirePermission('printing:manage')
  previewTemplate(
    @Body(new ZodPipe(Preview)) b: z.infer<typeof Preview>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.printing.previewTemplate(ctxOf(t, u), b.kind, b.body, b.orderId ?? null);
  }

  @Patch('printing/agents/:id')
  @RequirePermission('printing:manage')
  updateAgent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Agent.partial())) b: Partial<z.infer<typeof Agent>>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const a = await one(
        tx,
        `UPDATE print_agents SET name = COALESCE($2, name), active = COALESCE($3, active) WHERE id = $1 RETURNING ${AGENT_COLS}`,
        [id, b.name ?? null, b.active ?? null],
      );
      if (!a) throw new NotFoundException('Agente não encontrado');
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'printing.agent_updated',
        entity: 'print_agent',
        entityId: id,
        data: b,
        ip: req.ip,
      });
      return a;
    });
  }

  /** Gera um token novo; o anterior para de funcionar na hora. */
  @Post('printing/agents/:id/token')
  @RequirePermission('printing:manage')
  rotate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const { token, hash } = this.printing.newAgentToken();
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const a = await one(
        tx,
        `UPDATE print_agents SET token_hash = $2 WHERE id = $1 RETURNING ${AGENT_COLS}`,
        [id, hash],
      );
      if (!a) throw new NotFoundException('Agente não encontrado');
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'printing.agent_token_rotated',
        entity: 'print_agent',
        entityId: id,
        ip: req.ip,
      });
      return { agent: a, token };
    });
  }

  @Get('printing/jobs')
  @RequirePermission('printing:manage')
  jobs(
    @Query(new ZodPipe(JobsQuery)) f: z.infer<typeof JobsQuery>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant(ctxOf(t, u), (tx) =>
      q(
        tx,
        `${JOB_SELECT} WHERE ($1::text IS NULL OR j.status = $1) ORDER BY j.created_at DESC LIMIT $2`,
        [f.status ?? null, f.limit],
      ),
    );
  }

  /** Recoloca na fila um trabalho que falhou. */
  @Post('printing/jobs/:id/retry')
  @RequirePermission('printing:manage')
  async retry(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const r = await this.db.withTenant(ctxOf(t, u), async (tx) => {
      const j = await one(
        tx,
        `UPDATE print_jobs SET status = 'queued', attempts = 0, claimed_by = NULL, claimed_at = NULL
          WHERE id = $1 AND status = 'failed' RETURNING id`,
        [id],
      );
      if (!j) throw new NotFoundException('Trabalho com falha não encontrado');
      return one(tx, `${JOB_SELECT} WHERE j.id = $1`, [id]);
    });
    this.realtime.publish(t.id, { type: 'print.changed' });
    return r;
  }

  /**
   * Tira da fila o que ainda não imprimiu (só "Na fila"): comanda antiga que não precisa mais
   * sair quando o computador voltar. Sem ids, a fila toda. Fica como "Falhou" e pode voltar.
   */
  @Post('printing/jobs/discard')
  @HttpCode(200)
  @RequirePermission('printing:manage')
  async discard(
    @Body(new ZodPipe(Discard)) b: z.infer<typeof Discard>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const rows = await this.db.withTenant(ctxOf(t, u), (tx) =>
      q(
        tx,
        `UPDATE print_jobs SET status = 'failed', last_error = 'Tirado da fila na tela Impressão'
          WHERE status = 'queued' AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))
          RETURNING id`,
        [b.ids ?? null],
      ),
    );
    if (rows.length) this.realtime.publish(t.id, { type: 'print.changed' });
    return { discarded: rows.length };
  }

  @Post('printing/test')
  @RequirePermission('printing:manage')
  test(
    @Body(new ZodPipe(Target)) b: z.infer<typeof Target>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.printing.testPage(ctxOf(t, u), b.target);
  }

  /** Comprovante de fechamento (conferência) do pedido, para ver antes de imprimir. */
  @Get('orders/:id/receipt')
  @RequirePermission('orders:read')
  orderReceipt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.printing.receiptPreview(ctxOf(t, u), { kind: 'order', id });
  }

  /** Via de entrega do pedido (vai com o motoboy), para ver antes de imprimir. */
  @Get('orders/:id/delivery-slip')
  @RequirePermission('orders:read')
  orderDeliverySlip(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.printing.deliverySlipPreview(ctxOf(t, u), id);
  }

  /** Comprovante de fechamento da comanda inteira (mesa com várias rodadas). */
  @Get('tabs/:id/receipt')
  @RequirePermission('orders:read')
  tabReceipt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.printing.receiptPreview(ctxOf(t, u), { kind: 'tab', id });
  }

  @Post('tabs/:id/print')
  @RequirePermission('tables:operate', 'payments:create', 'printing:manage')
  printTab(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.printing.printTabReceipt(ctxOf(t, u, req), id);
  }

  /** Reimprimir comanda de cozinha ou imprimir conferência de conta. */
  @Post('orders/:id/print')
  @RequirePermission('orders:write', 'printing:manage')
  printOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(PrintOrder)) b: z.infer<typeof PrintOrder>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.printing.printOrder(ctxOf(t, u, req), id, b.kind);
  }
}

/**
 * API do agente local de impressão. Sem sessão de usuário: autentica pelo token do agente
 * (Authorization: Bearer pma_...), sempre no host do restaurante (o tenant vem do Host).
 */
/** Bloqueio por cobrança não trava o que termina a venda já feita (só pedidos novos). */
@AllowWhenBlocked()
@Controller({ path: 'print-agent', version: '1' })
@Public()
@Throttle({ default: { ttl: 60_000, limit: 120 } })
export class PrintAgentController {
  constructor(private readonly printing: PrintingService) {}

  private async agent(req: Request, t: ResolvedTenant) {
    const h = req.get('authorization') ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const a = await this.printing.agentFor(t.id, token);
    if (!a) throw new UnauthorizedException('Token de agente inválido');
    return a;
  }

  @Post('heartbeat')
  @HttpCode(200)
  async heartbeat(
    @Body(new ZodPipe(Heartbeat)) b: z.infer<typeof Heartbeat>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const a = await this.agent(req, t);
    await this.printing.heartbeat(t.id, a.id, req.ip, b.version, b.printers);
    const [targets, brand] = await Promise.all([
      this.printing.targets(t.id),
      this.printing.branding(t.id),
    ]);
    return { agent: a.name, restaurant: t.name, targets, brand };
  }

  @Post('claim')
  @HttpCode(200)
  async claim(
    @Body(new ZodPipe(Claim)) b: z.infer<typeof Claim>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const a = await this.agent(req, t);
    return { jobs: await this.printing.claim(t.id, a.id, b.limit) };
  }

  @Post('jobs/:id/result')
  @HttpCode(200)
  async result(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Result)) b: z.infer<typeof Result>,
    @CurrentTenant() t: ResolvedTenant,
    @Req() req: Request,
  ) {
    const a = await this.agent(req, t);
    return this.printing.result(t.id, a.id, id, b.ok, b.error);
  }
}
