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
  status: z.enum(['queued', 'printing', 'done', 'failed', 'cancelled']).optional(),
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
  /** Confirmações dos pedidos da tela: fila do sistema limpa e impressoras tiradas. */
  purgedAt: z.string().datetime().optional(),
  removed: z.array(z.string().trim().max(60).nullable()).max(40).optional(),
});
const Result = z.object({
  ok: z.boolean(),
  error: z.string().max(300).optional(),
  /** A falha veio depois de mandar para a impressora (pode ter saído): não tenta de novo sozinho. */
  sent: z.boolean().optional(),
  printer: z.string().trim().max(80).optional(),
});
/** Impressora de um computador: destino (null ou vazio = principal) e o nome mostrado. */
const PrinterRef = z.object({
  target: z
    .string()
    .trim()
    .max(60)
    .nullable()
    .optional()
    .transform((v) => v || null),
  label: z.string().trim().max(80).optional(),
});

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

  /**
   * Exclui o computador: o token para de valer na hora e ele some da lista. O que ele estava
   * imprimindo volta para a fila (outro computador pega); o histórico fica, sem o nome dele.
   */
  @Delete('printing/agents/:id')
  @RequirePermission('printing:manage')
  async deleteAgent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const r = await this.db.withTenant(ctxOf(t, u), async (tx) => {
      await q(
        tx,
        `UPDATE print_jobs SET status = CASE WHEN status = 'printing' THEN 'queued' ELSE status END,
                claimed_by = NULL, claimed_at = NULL
          WHERE claimed_by = $1`,
        [id],
      );
      const a = await one<{ name: string }>(
        tx,
        `DELETE FROM print_agents WHERE id = $1 RETURNING name`,
        [id],
      );
      if (!a) throw new NotFoundException('Computador não encontrado');
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'printing.agent_deleted',
        entity: 'print_agent',
        entityId: id,
        data: { name: a.name },
        ip: req.ip,
      });
      return { ok: true };
    });
    this.realtime.publish(t.id, { type: 'print.changed' });
    return r;
  }

  /**
   * Pede ao computador que apague os documentos do Comandou que ainda estão na fila do sistema
   * (spooler do Windows): o que já saiu do Comandou para a impressora para de imprimir.
   */
  @Post('printing/agents/:id/purge')
  @HttpCode(200)
  @RequirePermission('printing:manage')
  async purge(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const a = await this.db.withTenant(ctxOf(t, u), (tx) =>
      one(
        tx,
        `UPDATE print_agents SET purge_requested_at = now() WHERE id = $1 RETURNING ${AGENT_COLS}`,
        [id],
      ),
    );
    if (!a) throw new NotFoundException('Computador não encontrado');
    this.realtime.publish(t.id, { type: 'print.changed' });
    return a;
  }

  /**
   * Tira uma impressora do aplicativo daquele computador (a principal ou a de um setor). Some da
   * tela na hora; o aplicativo apaga a escolha no próximo sinal (até 30 s). Sem principal, o
   * computador para de pegar trabalhos, que esperam na fila.
   */
  @Post('printing/agents/:id/printers/remove')
  @HttpCode(200)
  @RequirePermission('printing:manage')
  async removePrinter(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(PrinterRef)) b: z.infer<typeof PrinterRef>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const a = await this.db.withTenant(ctxOf(t, u), async (tx) => {
      const row = await one(
        tx,
        `UPDATE print_agents
            SET printer_removals = (
                  SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(
                    COALESCE(printer_removals, '[]'::jsonb) || jsonb_build_array($2::text)) x),
                printers = (SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
                              FROM jsonb_array_elements(COALESCE(printers, '[]'::jsonb)) p
                             WHERE p->'target' IS DISTINCT FROM COALESCE(to_jsonb($2::text), 'null'::jsonb))
          WHERE id = $1 RETURNING ${AGENT_COLS}`,
        [id, b.target],
      );
      if (!row) throw new NotFoundException('Computador não encontrado');
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'printing.printer_removed',
        entity: 'print_agent',
        entityId: id,
        data: { target: b.target, label: b.label ?? null },
        ip: req.ip,
      });
      return row;
    });
    this.realtime.publish(t.id, { type: 'print.changed' });
    return a;
  }

  /**
   * Trabalhos de uma impressora: os próximos (na fila, que este computador manda para ela) e os
   * que já passaram por ela (impressos, com falha ou tirados da fila).
   */
  @Get('printing/agents/:id/jobs')
  @RequirePermission('printing:manage')
  printerJobs(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodPipe(PrinterRef)) f: z.infer<typeof PrinterRef>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const a = await one<{ printers: { target: string | null; label: string }[] | null }>(
        tx,
        `SELECT printers FROM print_agents WHERE id = $1`,
        [id],
      );
      if (!a) throw new NotFoundException('Computador não encontrado');
      const list = a.printers ?? [];
      const target = f.target;
      const label = f.label ?? list.find((p) => p.target === target)?.label ?? null;
      // Principal: recebe os destinos que não têm impressora própria neste computador.
      const routed = list.filter((p) => p.target !== null).map((p) => p.target as string);
      const mine = target === null ? null : [target];
      const sameTarget = `(($A::text[] IS NOT NULL AND j.target = ANY($A::text[]))
                 OR ($A::text[] IS NULL AND NOT (j.target = ANY($B::text[]))))`;
      const upcoming = await q(
        tx,
        `${JOB_SELECT}
          WHERE j.status IN ('queued','printing')
            AND ${sameTarget.replaceAll('$A', '$1').replaceAll('$B', '$2')}
          ORDER BY j.created_at LIMIT 100`,
        [mine, routed],
      );
      const past = await q(
        tx,
        `${JOB_SELECT}
          WHERE j.status IN ('done','failed','cancelled') AND j.claimed_by = $1
            AND (j.printer_label = $2
                 OR (j.printer_label IS NULL AND ${sameTarget.replaceAll('$A', '$3').replaceAll('$B', '$4')}))
          ORDER BY j.created_at DESC LIMIT 100`,
        [id, label, mine, routed],
      );
      return { label, upcoming, past };
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
        `UPDATE print_jobs SET status = 'queued', attempts = 0, claimed_by = NULL, claimed_at = NULL,
                retry_at = NULL
          WHERE id = $1 AND status IN ('failed','cancelled') RETURNING id`,
        [id],
      );
      if (!j) throw new NotFoundException('Trabalho com falha não encontrado');
      return one(tx, `${JOB_SELECT} WHERE j.id = $1`, [id]);
    });
    this.realtime.publish(t.id, { type: 'print.changed' });
    return r;
  }

  /**
   * Tira da fila o que ainda não imprimiu ("Na fila" e "Imprimindo"): comanda que não precisa
   * mais sair. Fica como "Tirado da fila" e pode voltar. O computador que já pegou o trabalho
   * não confirma mais (409) e, sem ids (a fila toda), ainda apaga os documentos do Comandou que
   * estão na fila do sistema (spooler do Windows), para a impressora parar de imprimir.
   */
  @Post('printing/jobs/discard')
  @HttpCode(200)
  @RequirePermission('printing:manage')
  async discard(
    @Body(new ZodPipe(Discard)) b: z.infer<typeof Discard>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    const rows = await this.db.withTenant(ctxOf(t, u), async (tx) => {
      const r = await q<{ claimed_by: string | null; was: string }>(
        tx,
        `UPDATE print_jobs j SET status = 'cancelled', retry_at = NULL,
                last_error = 'Tirado da fila na tela Impressão'
           FROM print_jobs old
          WHERE old.id = j.id AND j.status IN ('queued','printing')
            AND ($1::uuid[] IS NULL OR j.id = ANY($1::uuid[]))
          RETURNING j.claimed_by, old.status AS was`,
        [b.ids ?? null],
      );
      // Fila toda (ou trabalho que já estava com um computador): limpa a fila do sistema também.
      const busy = [
        ...new Set(r.filter((x) => x.was === 'printing' && x.claimed_by).map((x) => x.claimed_by)),
      ];
      if (!b.ids) await q(tx, `UPDATE print_agents SET purge_requested_at = now() WHERE active`);
      else if (busy.length)
        await q(
          tx,
          `UPDATE print_agents SET purge_requested_at = now() WHERE id = ANY($1::uuid[])`,
          [busy],
        );
      return r;
    });
    if (rows.length || !b.ids) this.realtime.publish(t.id, { type: 'print.changed' });
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
    const [targets, brand, commands] = await Promise.all([
      this.printing.targets(t.id),
      this.printing.branding(t.id),
      this.printing.agentCommands(t.id, a.id, { purgedAt: b.purgedAt, removed: b.removed }),
    ]);
    return { agent: a.name, restaurant: t.name, targets, brand, ...commands };
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
    return this.printing.result(t.id, a.id, id, b.ok, b.error, b.sent, b.printer);
  }
}
