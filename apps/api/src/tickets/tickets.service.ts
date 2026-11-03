import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  clientStatus,
  nextStage,
  stageInfo,
  TICKET_STAGE_IDS,
  type TicketState,
} from '@comandou/shared';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { open, seal } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import type { Actor } from '../platform/platform.service';
import { PlatformDb, platformAudit } from '../platform/platform-db.service';
import { GitHubClient, GitHubError } from './github';

/** Contexto do token do GitHub no secret-box. */
export const GITHUB_KEY_CONTEXT = 'pipeline:github';
/** Espaço de fotos e vídeos por chamado. */
const FILES_PER_TICKET_BYTES = 120 * 1024 * 1024;
const FILES_PER_TICKET = 20;
/** Chamados abertos ao mesmo tempo por restaurante (evita enxurrada). */
const OPEN_PER_TENANT = 30;

const Level = z.enum(['low', 'medium', 'high', 'critical']);
const Kind = z.enum(['bug', 'improvement', 'question', 'other']);

export const NewTicketBody = z.object({
  title: z.string().trim().min(3, 'Escreva um título (mínimo 3 letras)').max(120),
  description: z.string().trim().max(8000).default(''),
  kind: Kind.default('bug'),
  urgency: Level.default('medium'),
  page: z.string().trim().max(300).optional(),
});
export const AdminTicketBody = NewTicketBody.extend({ tenantId: z.string().uuid() });
export const ReplyBody = z
  .object({
    body: z.string().trim().max(4000).default(''),
    fileIds: z.array(z.string().uuid()).max(10).default([]),
    /** Só no painel: nota interna (o cliente não vê). */
    internal: z.boolean().default(false),
  })
  .refine((b) => b.body.length > 0 || b.fileIds.length > 0, 'Escreva uma mensagem');
export const DecideBody = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(1000).optional(),
});
export const PatchTicketBody = z.object({
  priority: Level.nullable().optional(),
  autoAdvance: z.boolean().optional(),
});
export const MoveBody = z.object({
  stage: z.enum(TICKET_STAGE_IDS as [string, ...string[]]),
});
export const PipelineSettingsBody = z.object({
  enabled: z.boolean(),
  model: z
    .string()
    .trim()
    .regex(/^$|^[A-Za-z0-9._:/-]{3,120}$/, 'Modelo inválido (ex.: anthropic/claude-sonnet-4.5)'),
  githubRepo: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Use dono/repositório (ex.: dhqdev/comandou)'),
  githubBase: z.string().trim().min(1).max(100),
  /** Vazio mantém o token salvo. */
  githubToken: z.string().trim().max(300).optional(),
  removeToken: z.boolean().optional(),
  branchPrefix: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9._-]{0,20}$/, 'Prefixo com letras minúsculas, números, ponto ou traço'),
  allowCodeChanges: z.boolean(),
  autoAdvance: z.boolean(),
});
export const TestGithubBody = z.object({
  githubRepo: z.string().trim().max(200).optional(),
  githubToken: z.string().trim().max(300).optional(),
});

export interface SettingsRow {
  enabled: boolean;
  model: string;
  github_repo: string;
  github_base: string;
  github_token_enc: Buffer | null;
  branch_prefix: string;
  allow_code_changes: boolean;
  auto_advance: boolean;
  updated_at: Date;
}

export interface TicketRow {
  id: string;
  number: number;
  tenant_id: string;
  opened_by_id: string | null;
  opened_by_name: string;
  opened_by_email: string;
  source: 'client' | 'admin';
  title: string;
  description: string;
  kind: string;
  urgency: string;
  page: string | null;
  stage: string;
  state: TicketState;
  waiting_reason: string | null;
  priority: string | null;
  priority_score: number | null;
  pain: string | null;
  analysis: Record<string, Record<string, unknown>>;
  pending: string[];
  auto_advance: boolean;
  decided_at: Date | null;
  decision_note: string | null;
  branch: string | null;
  head_sha: string | null;
  pr_number: number | null;
  pr_url: string | null;
  ai_tokens: number;
  ai_cost_usd: string;
  run_after: Date;
  attempts: number;
  last_error: string | null;
  stage_started_at: Date;
  client_unread: number;
  admin_unread: number;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

export interface Who {
  id: string | null;
  name: string;
  email?: string;
}

export const code = (n: number) => `#CH-${String(n).padStart(4, '0')}`;

const fileUrl = (side: 'client' | 'admin', id: string) =>
  side === 'client' ? `/api/v1/support/files/${id}` : `/api/v1/platform/tickets/files/${id}`;

/** Registro na linha do tempo do chamado. */
export async function addEvent(
  c: PoolClient,
  ticketId: string,
  e: {
    kind: 'message' | 'note' | 'activity' | 'stage' | 'status' | 'decision';
    actor: 'client' | 'admin' | 'agent' | 'system';
    actorName?: string;
    stage?: string | null;
    body?: string;
    data?: unknown;
    public?: boolean;
  },
): Promise<number> {
  const r = await c.query<{ id: string }>(
    `INSERT INTO platform_ticket_events (ticket_id, kind, actor, actor_name, stage, body, data, public)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      ticketId,
      e.kind,
      e.actor,
      (e.actorName ?? '').slice(0, 120),
      e.stage ?? null,
      (e.body ?? '').slice(0, 8000),
      JSON.stringify(e.data ?? {}),
      e.public ?? false,
    ],
  );
  return Number(r.rows[0]!.id);
}

/**
 * Chamados: o restaurante abre (texto, fotos e vídeos) e acompanha; o painel Super Admin decide,
 * conversa e move pela esteira. Os agentes ficam em PipelineService.
 */
@Injectable()
export class TicketsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
  ) {}

  private need() {
    if (!this.db.enabled)
      throw new ServiceUnavailableException('Chamados indisponíveis: servidor sem banco do painel');
  }

  // ------------------------------------------------------------------ configuração
  async settingsRow(c?: PoolClient): Promise<SettingsRow> {
    const sql = `SELECT * FROM platform_pipeline_settings WHERE id`;
    return c
      ? (await c.query<SettingsRow>(sql)).rows[0]!
      : (await this.db.query<SettingsRow>(sql))[0]!;
  }

  githubToken(s: SettingsRow): string | null {
    if (!s.github_token_enc || !this.env.INTEGRATIONS_KEY) return null;
    try {
      return open(this.env.INTEGRATIONS_KEY, s.github_token_enc, GITHUB_KEY_CONTEXT);
    } catch {
      return null;
    }
  }

  github(s: SettingsRow, token = this.githubToken(s), repo = s.github_repo): GitHubClient | null {
    return token ? new GitHubClient(token, repo, this.env.GITHUB_API_URL) : null;
  }

  async settings() {
    this.need();
    const s = await this.settingsRow();
    const [ai] = await this.db.query<{ model: string; has_key: boolean; enabled: boolean }>(
      `SELECT model, (api_key_enc IS NOT NULL OR owner_api_key_enc IS NOT NULL) AS has_key, enabled
         FROM platform_ai_settings WHERE id`,
    );
    return {
      enabled: s.enabled,
      model: s.model,
      effectiveModel: s.model || ai?.model || '',
      aiReady: !!ai?.has_key,
      githubRepo: s.github_repo,
      githubBase: s.github_base,
      hasGithubToken: !!s.github_token_enc,
      tokenReadable: !!this.githubToken(s),
      keyConfigured: !!this.env.INTEGRATIONS_KEY,
      branchPrefix: s.branch_prefix,
      allowCodeChanges: s.allow_code_changes,
      autoAdvance: s.auto_advance,
      updatedAt: s.updated_at,
    };
  }

  async saveSettings(b: z.infer<typeof PipelineSettingsBody>, a: Actor) {
    this.need();
    const cur = await this.settingsRow();
    let enc = cur.github_token_enc;
    if (b.removeToken) enc = null;
    if (b.githubToken) {
      if (!this.env.INTEGRATIONS_KEY)
        throw new UnprocessableEntityException(
          'Servidor sem INTEGRATIONS_KEY: não é possível guardar o token com segurança',
        );
      enc = seal(this.env.INTEGRATIONS_KEY, b.githubToken, GITHUB_KEY_CONTEXT);
    }
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_pipeline_settings
            SET enabled = $1, model = $2, github_repo = $3, github_base = $4, github_token_enc = $5,
                branch_prefix = $6, allow_code_changes = $7, auto_advance = $8,
                updated_at = now(), updated_by = $9
          WHERE id`,
        [
          b.enabled,
          b.model,
          b.githubRepo,
          b.githubBase,
          enc,
          b.branchPrefix,
          b.allowCodeChanges,
          b.autoAdvance,
          a.admin.id,
        ],
      );
      const { githubToken: _t, ...safe } = b;
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.pipeline_settings_updated',
        entity: 'pipeline',
        data: { ...safe, tokenChanged: !!b.githubToken },
        ip: a.ip,
      });
    });
    return this.settings();
  }

  /** Confere o token: enxerga o repositório (privado), pode gravar, acha a branch base. */
  async testGithub(b: z.infer<typeof TestGithubBody>) {
    this.need();
    const s = await this.settingsRow();
    const repo = b.githubRepo || s.github_repo;
    const gh = this.github(s, b.githubToken || this.githubToken(s), repo);
    if (!gh) throw new UnprocessableEntityException('Cole o token do GitHub');
    const checks: { label: string; ok: boolean; detail?: string }[] = [];
    try {
      const info = await gh.repoInfo();
      checks.push({
        label: `Enxerga ${info.fullName}`,
        ok: true,
        detail: info.private ? 'repositório privado' : 'repositório público',
      });
      checks.push({
        label: 'Pode criar branch e commit',
        ok: info.canPush !== false,
        detail:
          info.canPush === false
            ? 'Dê "Contents: Read and write" ao token'
            : info.canPush === null
              ? 'o GitHub não informou; vamos descobrir no primeiro chamado'
              : undefined,
      });
      const base = await gh.branchSha(s.github_base);
      checks.push({
        label: `Branch base "${s.github_base}"`,
        ok: !!base,
        detail: base ? undefined : 'não existe; ajuste o campo Branch base',
      });
      try {
        await gh.runs(base ?? 'HEAD');
        checks.push({ label: 'Lê o GitHub Actions (testes)', ok: true });
      } catch (e) {
        checks.push({
          label: 'Lê o GitHub Actions (testes)',
          ok: false,
          detail: 'Dê "Actions: Read-only" para a etapa de testes acompanhar o CI',
        });
        void e;
      }
      return { ok: checks.every((c) => c.ok), checks };
    } catch (e) {
      return {
        ok: false,
        checks: [{ label: 'Acesso ao repositório', ok: false, detail: (e as Error).message }],
      };
    }
  }

  // ------------------------------------------------------------------ restaurante
  private clientView(t: TicketRow) {
    const st = clientStatus(t.stage, t.state);
    return {
      id: t.id,
      number: t.number,
      code: code(t.number),
      title: t.title,
      kind: t.kind,
      urgency: t.urgency,
      step: st.step,
      statusLabel: st.label,
      done: ['done', 'rejected', 'cancelled'].includes(t.state),
      unread: t.client_unread,
      openedBy: t.opened_by_name,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    };
  }

  async listForTenant(tenantId: string) {
    this.need();
    const rows = await this.db.query<TicketRow>(
      `SELECT * FROM platform_tickets WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 200`,
      [tenantId],
    );
    return rows.map((t) => this.clientView(t));
  }

  async unreadForTenant(tenantId: string) {
    if (!this.db.enabled) return { unread: 0 };
    const [r] = await this.db.query<{ n: number }>(
      `SELECT coalesce(sum(client_unread), 0)::int AS n FROM platform_tickets WHERE tenant_id = $1`,
      [tenantId],
    );
    return { unread: r?.n ?? 0 };
  }

  private async ownTicket(c: PoolClient, tenantId: string, id: string, lock = false) {
    const r = await c.query<TicketRow>(
      `SELECT * FROM platform_tickets WHERE id = $1 AND tenant_id = $2${lock ? ' FOR UPDATE' : ''}`,
      [id, tenantId],
    );
    if (!r.rows[0]) throw new NotFoundException('Chamado não encontrado');
    return r.rows[0];
  }

  async create(
    tenantId: string,
    who: Who,
    b: z.infer<typeof NewTicketBody>,
    source: 'client' | 'admin' = 'client',
  ) {
    this.need();
    return this.db.tx(async (c) => {
      const t = await c.query(`SELECT 1 FROM tenants WHERE id = $1`, [tenantId]);
      if (!t.rowCount) throw new NotFoundException('Restaurante não encontrado');
      const open = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM platform_tickets
          WHERE tenant_id = $1 AND state NOT IN ('done','rejected','cancelled')`,
        [tenantId],
      );
      if (source === 'client' && open.rows[0]!.n >= OPEN_PER_TENANT)
        throw new UnprocessableEntityException(
          'Muitos chamados abertos: espere alguns serem resolvidos ou escreva num chamado aberto',
        );
      const s = await this.settingsRow(c);
      const r = await c.query<TicketRow>(
        `INSERT INTO platform_tickets (tenant_id, opened_by_id, opened_by_name, opened_by_email, source,
                                       title, description, kind, urgency, page, auto_advance, run_after)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + interval '15 seconds') RETURNING *`,
        [
          tenantId,
          source === 'client' ? who.id : null,
          who.name.slice(0, 120),
          (who.email ?? '').slice(0, 200),
          source,
          b.title,
          b.description,
          b.kind,
          b.urgency,
          b.page ?? null,
          s.auto_advance,
        ],
      );
      const ticket = r.rows[0]!;
      await addEvent(c, ticket.id, {
        kind: 'status',
        actor: source === 'client' ? 'client' : 'admin',
        actorName: who.name,
        stage: 'inicio',
        body:
          source === 'client'
            ? 'Chamado aberto. Recebemos e já estamos analisando.'
            : 'Demanda criada no painel.',
        public: true,
      });
      if (source === 'client')
        await c.query(`UPDATE platform_tickets SET admin_unread = admin_unread + 1 WHERE id = $1`, [
          ticket.id,
        ]);
      return ticket;
    });
  }

  async detailForTenant(tenantId: string, id: string) {
    this.need();
    return this.db.tx(async (c) => {
      const t = await this.ownTicket(c, tenantId, id);
      if (t.client_unread)
        await c.query(`UPDATE platform_tickets SET client_unread = 0 WHERE id = $1`, [id]);
      const events = await c.query(
        `SELECT id::int AS id, kind, actor, actor_name AS "actorName", body, data, created_at AS "createdAt"
           FROM platform_ticket_events WHERE ticket_id = $1 AND public ORDER BY id`,
        [id],
      );
      const files = await this.files(c, id, 'client');
      return {
        ...this.clientView({ ...t, client_unread: 0 }),
        description: t.description,
        page: t.page,
        decisionNote: t.state === 'rejected' ? t.decision_note : null,
        events: events.rows,
        files,
      };
    });
  }

  private async files(c: PoolClient, ticketId: string, side: 'client' | 'admin') {
    const r = await c.query<{
      id: string;
      kind: string;
      name: string;
      size: number;
      eventId: number | null;
      uploadedBy: string;
      createdAt: Date;
    }>(
      `SELECT id, kind, name, size, event_id::int AS "eventId", uploaded_by AS "uploadedBy",
              created_at AS "createdAt"
         FROM platform_ticket_files WHERE ticket_id = $1 ORDER BY created_at`,
      [ticketId],
    );
    return r.rows.map((f) => ({ ...f, url: fileUrl(side, f.id) }));
  }

  async replyAsClient(tenantId: string, who: Who, id: string, b: z.infer<typeof ReplyBody>) {
    this.need();
    return this.db.tx(async (c) => {
      const t = await this.ownTicket(c, tenantId, id, true);
      if (t.state === 'cancelled')
        throw new UnprocessableEntityException('Chamado cancelado: abra outro');
      const ev = await addEvent(c, id, {
        kind: 'message',
        actor: 'client',
        actorName: who.name,
        stage: t.stage,
        body: b.body,
        public: true,
      });
      await this.linkFiles(c, id, ev, b.fileIds, 'client');
      await c.query(`UPDATE platform_tickets SET admin_unread = admin_unread + 1 WHERE id = $1`, [
        id,
      ]);
      return { ok: true };
    });
  }

  async cancelAsClient(tenantId: string, who: Who, id: string) {
    this.need();
    return this.db.tx(async (c) => {
      const t = await this.ownTicket(c, tenantId, id, true);
      if (
        !['inicio', 'priorizacao'].includes(t.stage) ||
        ['done', 'cancelled', 'rejected'].includes(t.state)
      )
        throw new UnprocessableEntityException(
          'Este chamado já está em desenvolvimento: escreva na conversa se não precisar mais',
        );
      await c.query(
        `UPDATE platform_tickets SET state = 'cancelled', closed_at = now(), locked_until = NULL,
                admin_unread = admin_unread + 1 WHERE id = $1`,
        [id],
      );
      await addEvent(c, id, {
        kind: 'status',
        actor: 'client',
        actorName: who.name,
        stage: t.stage,
        body: 'Chamado cancelado pelo cliente.',
        public: true,
      });
      return { ok: true };
    });
  }

  private async linkFiles(
    c: PoolClient,
    ticketId: string,
    eventId: number,
    ids: string[],
    by: 'client' | 'admin',
  ) {
    if (!ids.length) return;
    await c.query(
      `UPDATE platform_ticket_files SET event_id = $1
        WHERE ticket_id = $2 AND id = ANY($3::uuid[]) AND event_id IS NULL AND uploaded_by = $4`,
      [eventId, ticketId, ids, by],
    );
  }

  async upload(
    ticketId: string,
    tenantId: string | null,
    by: 'client' | 'admin',
    file: { mime: string; bytes: Buffer },
    name: string,
  ) {
    this.need();
    return this.db.tx(async (c) => {
      const t = await c.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM platform_tickets WHERE id = $1 FOR UPDATE`,
        [ticketId],
      );
      if (!t.rows[0] || (tenantId && t.rows[0].tenant_id !== tenantId))
        throw new NotFoundException('Chamado não encontrado');
      const used = await c.query<{ n: number; total: string }>(
        `SELECT count(*)::int AS n, coalesce(sum(size), 0) AS total
           FROM platform_ticket_files WHERE ticket_id = $1`,
        [ticketId],
      );
      if (used.rows[0]!.n >= FILES_PER_TICKET)
        throw new UnprocessableEntityException(`Até ${FILES_PER_TICKET} arquivos por chamado`);
      if (Number(used.rows[0]!.total) + file.bytes.length > FILES_PER_TICKET_BYTES)
        throw new UnprocessableEntityException('Espaço de anexos deste chamado acabou');
      const kind = file.mime.startsWith('video/') ? 'video' : 'image';
      const r = await c.query<{ id: string }>(
        `INSERT INTO platform_ticket_files (ticket_id, kind, content_type, name, bytes, size, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [ticketId, kind, file.mime, name.slice(0, 200), file.bytes, file.bytes.length, by],
      );
      const id = r.rows[0]!.id;
      return { id, kind, url: fileUrl(by, id) };
    });
  }

  async file(id: string, tenantId: string | null) {
    this.need();
    const [f] = await this.db.query<{ content_type: string; bytes: Buffer; tenant_id: string }>(
      `SELECT f.content_type, f.bytes, t.tenant_id
         FROM platform_ticket_files f JOIN platform_tickets t ON t.id = f.ticket_id
        WHERE f.id = $1`,
      [id],
    );
    if (!f || (tenantId && f.tenant_id !== tenantId))
      throw new NotFoundException('Arquivo não encontrado');
    return { contentType: f.content_type, bytes: f.bytes };
  }

  // ------------------------------------------------------------------ painel
  private boardView(
    t: TicketRow & {
      tenant_name: string;
      tenant_slug: string;
      plan_name: string | null;
      files: number;
    },
  ) {
    return {
      id: t.id,
      number: t.number,
      code: code(t.number),
      title: t.title,
      kind: t.kind,
      urgency: t.urgency,
      stage: t.stage,
      state: t.state,
      waitingReason: t.waiting_reason,
      priority: t.priority,
      priorityScore: t.priority_score,
      pain: t.pain,
      autoAdvance: t.auto_advance,
      branch: t.branch,
      prNumber: t.pr_number,
      prUrl: t.pr_url,
      lastError: t.last_error,
      unread: t.admin_unread,
      files: t.files,
      source: t.source,
      tenant: { id: t.tenant_id, name: t.tenant_name, slug: t.tenant_slug, plan: t.plan_name },
      openedBy: t.opened_by_name,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      stageStartedAt: t.stage_started_at,
    };
  }

  private boardSql(where: string) {
    return `SELECT p.*, tn.name AS tenant_name, tn.slug AS tenant_slug, pl.name AS plan_name,
                   (SELECT count(*)::int FROM platform_ticket_files f WHERE f.ticket_id = p.id) AS files
              FROM platform_tickets p
              JOIN tenants tn ON tn.id = p.tenant_id
              LEFT JOIN subscriptions s ON s.tenant_id = p.tenant_id AND s.status <> 'cancelled'
              LEFT JOIN plans pl ON pl.id = s.plan_id
             ${where}`;
  }

  async board(showClosed: boolean) {
    this.need();
    const rows = await this.db.query<Parameters<TicketsService['boardView']>[0]>(
      this.boardSql(
        showClosed
          ? `WHERE p.created_at > now() - interval '180 days' OR p.state NOT IN ('done','rejected','cancelled')
             ORDER BY p.updated_at DESC LIMIT 500`
          : `WHERE p.state NOT IN ('rejected','cancelled')
               AND (p.state <> 'done' OR p.closed_at > now() - interval '30 days')
             ORDER BY p.updated_at DESC LIMIT 500`,
      ),
    );
    const s = await this.settings();
    return {
      tickets: rows.map((r) => this.boardView(r)),
      waiting: rows.filter((r) => r.state === 'approval' || r.state === 'waiting').length,
      running: rows.filter((r) => r.state === 'running').length,
      settings: s,
    };
  }

  async adminDetail(id: string) {
    this.need();
    return this.db.tx(async (c) => {
      const r = await c.query<Parameters<TicketsService['boardView']>[0]>(
        this.boardSql('WHERE p.id = $1'),
        [id],
      );
      const t = r.rows[0];
      if (!t) throw new NotFoundException('Chamado não encontrado');
      if (t.admin_unread)
        await c.query(`UPDATE platform_tickets SET admin_unread = 0 WHERE id = $1`, [id]);
      const events = await c.query(
        `SELECT id::int AS id, kind, actor, actor_name AS "actorName", stage, body, data, public,
                created_at AS "createdAt"
           FROM platform_ticket_events WHERE ticket_id = $1 ORDER BY id`,
        [id],
      );
      const others = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM platform_tickets
          WHERE tenant_id = $1 AND id <> $2 AND state NOT IN ('done','rejected','cancelled')`,
        [t.tenant_id, id],
      );
      const s = await this.settingsRow(c);
      return {
        ...this.boardView({ ...t, admin_unread: 0 }),
        description: t.description,
        page: t.page,
        openedByEmail: t.opened_by_email,
        analysis: t.analysis,
        pending: t.pending,
        decisionNote: t.decision_note,
        decidedAt: t.decided_at,
        headSha: t.head_sha,
        aiTokens: t.ai_tokens,
        aiCostUsd: Number(t.ai_cost_usd),
        attempts: t.attempts,
        closedAt: t.closed_at,
        clientStatus: clientStatus(t.stage, t.state),
        otherOpen: others.rows[0]!.n,
        repo: s.github_repo,
        base: s.github_base,
        events: events.rows,
        files: await this.files(c, id, 'admin'),
      };
    });
  }

  private async lockTicket(c: PoolClient, id: string) {
    const r = await c.query<TicketRow>(`SELECT * FROM platform_tickets WHERE id = $1 FOR UPDATE`, [
      id,
    ]);
    if (!r.rows[0]) throw new NotFoundException('Chamado não encontrado');
    return r.rows[0];
  }

  async adminCreate(b: z.infer<typeof AdminTicketBody>, a: Actor) {
    const { tenantId, ...rest } = b;
    const t = await this.create(
      tenantId,
      { id: a.admin.id, name: a.admin.name, email: a.admin.email },
      rest,
      'admin',
    );
    await this.db.tx((c) =>
      platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.ticket_created',
        entity: 'ticket',
        entityId: t.id,
        tenantId,
        ip: a.ip,
      }),
    );
    return { id: t.id };
  }

  async decide(id: string, b: z.infer<typeof DecideBody>, a: Actor) {
    this.need();
    return this.db.tx(async (c) => {
      const t = await this.lockTicket(c, id);
      if (t.decided_at || ['done', 'cancelled', 'rejected'].includes(t.state))
        throw new UnprocessableEntityException('Este chamado já foi decidido');
      if (b.approve) {
        await c.query(
          `UPDATE platform_tickets
              SET decided_at = now(), decided_by = $2, decision_note = $3, stage = 'priorizacao',
                  state = 'running', waiting_reason = NULL, run_after = now(), attempts = 0,
                  locked_until = NULL, last_error = NULL, stage_started_at = now(),
                  client_unread = client_unread + 1
            WHERE id = $1`,
          [id, a.admin.id, b.note ?? null],
        );
        await addEvent(c, id, {
          kind: 'decision',
          actor: 'admin',
          actorName: a.admin.name,
          stage: 'priorizacao',
          body: b.note
            ? `Aprovado: vamos resolver. ${b.note}`
            : 'Aprovado: vamos resolver e avisamos aqui a cada etapa.',
          data: { approve: true },
          public: true,
        });
      } else {
        await c.query(
          `UPDATE platform_tickets
              SET decided_at = now(), decided_by = $2, decision_note = $3, state = 'rejected',
                  waiting_reason = NULL, closed_at = now(), locked_until = NULL,
                  client_unread = client_unread + 1
            WHERE id = $1`,
          [id, a.admin.id, b.note ?? null],
        );
        await addEvent(c, id, {
          kind: 'decision',
          actor: 'admin',
          actorName: a.admin.name,
          stage: t.stage,
          body: b.note ? `Não vamos fazer agora: ${b.note}` : 'Não vamos fazer este pedido agora.',
          data: { approve: false },
          public: true,
        });
      }
      await platformAudit(c, {
        adminId: a.admin.id,
        action: b.approve ? 'platform.ticket_approved' : 'platform.ticket_rejected',
        entity: 'ticket',
        entityId: id,
        tenantId: t.tenant_id,
        data: { note: b.note ?? null },
        ip: a.ip,
      });
      return { ok: true };
    });
  }

  async adminMessage(id: string, b: z.infer<typeof ReplyBody>, a: Actor) {
    this.need();
    return this.db.tx(async (c) => {
      const t = await this.lockTicket(c, id);
      const ev = await addEvent(c, id, {
        kind: b.internal ? 'note' : 'message',
        actor: 'admin',
        actorName: a.admin.name,
        stage: t.stage,
        body: b.body,
        public: !b.internal,
      });
      await this.linkFiles(c, id, ev, b.fileIds, 'admin');
      if (!b.internal)
        await c.query(
          `UPDATE platform_tickets SET client_unread = client_unread + 1 WHERE id = $1`,
          [id],
        );
      return { ok: true };
    });
  }

  async patch(id: string, b: z.infer<typeof PatchTicketBody>, a: Actor) {
    this.need();
    return this.db.tx(async (c) => {
      const t = await this.lockTicket(c, id);
      if (b.priority !== undefined) {
        await c.query(`UPDATE platform_tickets SET priority = $2 WHERE id = $1`, [id, b.priority]);
        await addEvent(c, id, {
          kind: 'activity',
          actor: 'admin',
          actorName: a.admin.name,
          stage: t.stage,
          body: `Prioridade ajustada para ${b.priority ?? 'automática'}.`,
        });
      }
      if (b.autoAdvance !== undefined)
        await c.query(`UPDATE platform_tickets SET auto_advance = $2 WHERE id = $1`, [
          id,
          b.autoAdvance,
        ]);
      return { ok: true };
    });
  }

  /** Leva o chamado para uma etapa e põe o agente dela para trabalhar. */
  async move(id: string, stage: string, a: Actor, why = 'Movido no painel') {
    this.need();
    return this.db.tx(async (c) => {
      const t = await this.lockTicket(c, id);
      if (['cancelled', 'rejected'].includes(t.state))
        throw new UnprocessableEntityException('Chamado encerrado: reabra antes');
      if (!t.decided_at && stage !== 'inicio')
        await c.query(
          `UPDATE platform_tickets SET decided_at = now(), decided_by = $2 WHERE id = $1`,
          [id, a.admin.id],
        );
      await c.query(
        `UPDATE platform_tickets
            SET stage = $2, state = 'running', waiting_reason = NULL, run_after = now(), attempts = 0,
                locked_until = NULL, last_error = NULL, stage_started_at = now(), closed_at = NULL,
                client_unread = client_unread + CASE WHEN $3 THEN 1 ELSE 0 END
          WHERE id = $1`,
        [id, stage, stage !== t.stage],
      );
      await addEvent(c, id, {
        kind: 'stage',
        actor: 'admin',
        actorName: a.admin.name,
        stage,
        body:
          stage === t.stage
            ? `${stageInfo(stage).agent} vai refazer a etapa ${stageInfo(stage).label}.`
            : `${why}: ${stageInfo(t.stage).label} → ${stageInfo(stage).label}.`,
        data: { from: t.stage, to: stage },
        public: stage !== t.stage,
      });
      return { ok: true };
    });
  }

  async advance(id: string, a: Actor) {
    const [t] = await this.db.query<TicketRow>(`SELECT * FROM platform_tickets WHERE id = $1`, [
      id,
    ]);
    if (!t) throw new NotFoundException('Chamado não encontrado');
    if (t.state === 'approval')
      throw new UnprocessableEntityException('Aprove ou recuse o chamado antes de avançar');
    const next = nextStage(t.stage);
    if (!next) throw new UnprocessableEntityException('O chamado já está na última etapa');
    return this.move(id, next, a, 'Avançado no painel');
  }

  async cancel(id: string, reason: string | undefined, a: Actor) {
    this.need();
    return this.db.tx(async (c) => {
      const t = await this.lockTicket(c, id);
      if (['cancelled', 'done'].includes(t.state))
        throw new UnprocessableEntityException('Chamado já encerrado');
      await c.query(
        `UPDATE platform_tickets SET state = 'cancelled', closed_at = now(), locked_until = NULL,
                waiting_reason = NULL, client_unread = client_unread + 1 WHERE id = $1`,
        [id],
      );
      await addEvent(c, id, {
        kind: 'status',
        actor: 'admin',
        actorName: a.admin.name,
        stage: t.stage,
        body: reason ? `Chamado cancelado: ${reason}` : 'Chamado cancelado.',
        public: true,
      });
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.ticket_cancelled',
        entity: 'ticket',
        entityId: id,
        tenantId: t.tenant_id,
        data: { reason: reason ?? null },
        ip: a.ip,
      });
      return { ok: true };
    });
  }

  /** Mudanças da branch do chamado em relação à base (aba Diff). */
  async diff(id: string) {
    this.need();
    const [t] = await this.db.query<TicketRow>(`SELECT * FROM platform_tickets WHERE id = $1`, [
      id,
    ]);
    if (!t) throw new NotFoundException('Chamado não encontrado');
    if (!t.branch) return { branch: null, files: [], url: null, aheadBy: 0 };
    const s = await this.settingsRow();
    const gh = this.github(s);
    if (!gh) throw new UnprocessableEntityException('Configure o token do GitHub');
    try {
      const d = await gh.compare(s.github_base, t.branch);
      return {
        branch: t.branch,
        aheadBy: d.aheadBy,
        url: d.url,
        files: d.files.slice(0, 60).map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ? f.patch.slice(0, 30_000) : null,
        })),
      };
    } catch (e) {
      if (e instanceof GitHubError) throw new UnprocessableEntityException(e.message);
      throw e;
    }
  }
}
