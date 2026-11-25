import { Injectable } from '@nestjs/common';
import { RELEASES } from '@comandou/shared';
import { PlatformDb } from '../platform/platform-db.service';
import { PlatformBackupService } from '../platform/platform-backup.service';
import { PlatformDatabasesService } from '../platform/platform-databases.service';
import { PlatformDbServersService } from '../platform/platform-db-servers.service';
import { PlatformService } from '../platform/platform.service';
import { PlatformVersionsService } from '../platform/platform-versions.service';
import { GatewayClient } from '../messaging/gateway.client';
import { PLATFORM_WA_ID } from '../messaging/whatsapp-inbound.service';
import {
  ago,
  bytes,
  CHECK,
  Finding,
  findingsHeadline,
  findingsText,
  int,
  Level,
  money,
  SUB_STATUS,
  TENANT_STATUS,
  when,
} from './admin-menu';

/** "visto há 5 min" ou, se nunca apareceu, "nunca se conectou". */
const seen = (at: Date | string | null | undefined) =>
  at ? `visto ${ago(at)}` : 'nunca se conectou';

/** Problema da varredura geral. `alert`: vira aviso automático no WhatsApp (uma vez por chave). */
export interface Issue extends Finding {
  key: string;
  alert: boolean;
}

const DAY = 86_400_000;
/** Backup do banco central com mais de 26 h: passou do horário de ontem. */
const BACKUP_LATE_MS = 26 * 3600_000;
/** Restaurante no ar sem pedido há tantos dias merece uma olhada. */
const IDLE_DAYS = 7;
/** Computador de impressão que não aparece há tanto tempo está desligado. */
const PRINTER_LATE_MS = 15 * 60_000;

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: Date;
  city: string | null;
  state: string | null;
  subscriptionStatus: string | null;
  planName: string | null;
  users: number | null;
  products: number | null;
  ordersMonth: number | null;
  lastOrderAt: Date | null;
  dbName: string | null;
  dbStatus: string | null;
  fiscalErrors?: number;
  messageFailures?: number;
}

/**
 * O que o menu do WhatsApp mostra e o que vira aviso: tudo lido pelo papel do painel, com os
 * mesmos serviços das telas do Super Admin (os números batem com o que aparece lá).
 */
@Injectable()
export class PlatformWaChecks {
  constructor(
    private readonly db: PlatformDb,
    private readonly platform: PlatformService,
    private readonly backup: PlatformBackupService,
    private readonly databases: PlatformDatabasesService,
    private readonly dbServers: PlatformDbServersService,
    private readonly versions: PlatformVersionsService,
    private readonly gateway: GatewayClient,
  ) {}

  /* ------------------------------------------------------------------ busca */

  async findTenants(q: string | null, limit: number) {
    const term = q?.trim() ? `%${q.trim().replace(/[%_\\]/g, (x) => `\\${x}`)}%` : null;
    return this.db.query<{ id: string; slug: string; name: string; status: string }>(
      `SELECT t.id, t.slug, t.name, t.status FROM tenants t
         LEFT JOIN tenant_profiles p ON p.tenant_id = t.id
        WHERE $1::text IS NULL OR t.name ILIKE $1 OR t.slug ILIKE $1 OR p.legal_name ILIKE $1
           OR p.city ILIKE $1
        ORDER BY (t.status = 'provisioned') DESC,
                 (lower(t.name) = lower(trim(both '%' from coalesce($1, '')))) DESC,
                 t.created_at DESC
        LIMIT ${Math.min(Math.max(limit, 1), 50)}`,
      [term],
    );
  }

  async tenantHead(id: string) {
    const [t] = await this.db.query<{ id: string; slug: string; name: string; status: string }>(
      `SELECT id, slug, name, status FROM tenants WHERE id = $1`,
      [id],
    );
    return t ?? null;
  }

  /* ------------------------------------------------------------------ sistema */

  private async money() {
    const [r] = await this.db.query<{ mrr: string; active: number; trial: number; late: number }>(
      `SELECT coalesce(sum(p.price_monthly) FILTER (WHERE s.status = 'active'), 0)::text AS mrr,
              count(*) FILTER (WHERE s.status = 'active')::int AS active,
              count(*) FILTER (WHERE s.status = 'trialing')::int AS trial,
              count(*) FILTER (WHERE s.status = 'past_due')::int AS late
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.status <> 'cancelled'`,
    );
    return r;
  }

  /** Opção 1 e o resumo do dia. */
  async summary(title = '*Resumo do sistema*'): Promise<string> {
    const [o, m, tenants, fresh] = await Promise.all([
      this.platform.overview(),
      this.money(),
      this.platform.listTenants({}) as unknown as Promise<TenantRow[]>,
      this.db.query<{ d1: number; d7: number }>(
        `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS d1,
                count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS d7
           FROM tenants`,
      ),
    ]);
    const ts = o.tenants as Record<string, number>;
    const total = Object.values(ts).reduce((n, v) => n + v, 0);
    const orders = tenants.reduce((n, t) => n + (t.ordersMonth ?? 0), 0);
    const live = tenants.filter((t) => t.status === 'provisioned');
    const active7 = live.filter(
      (t) => t.lastOrderAt && Date.now() - new Date(t.lastOrderAt).getTime() < IDLE_DAYS * DAY,
    ).length;
    const issues = await this.issues();
    const b = o.backups.backup;
    return [
      title,
      `Versão ${o.version}`,
      '',
      `*Restaurantes:* ${int(total)} no total`,
      `• ${int(ts.provisioned ?? 0)} no ar · ${int(ts.suspended ?? 0)} suspensos${ts.failed ? ` · ${ts.failed} com falha` : ''}`,
      `• ${int(active7)} com pedido nos últimos ${IDLE_DAYS} dias`,
      `• ${int(fresh[0].d1)} novos nas últimas 24 h · ${int(fresh[0].d7)} em 7 dias`,
      '',
      `*Assinaturas:* ${int(m.active)} em dia · ${int(m.trial)} em teste grátis · ${int(m.late)} em atraso`,
      `• Receita mensal (em dia): ${money(m.mrr)}`,
      '',
      `*Pedidos no mês* (todos os restaurantes): ${int(orders)}`,
      '',
      `*Serviços:* banco ${CHECK[o.health.database]} · Redis ${CHECK[o.health.redis]} · WhatsApp ${CHECK[o.health.whatsappGateway]}`,
      `*Último backup:* ${b.lastOkAt ? `${when(b.lastOkAt)} (${ago(b.lastOkAt)})` : 'nenhum ainda'}${b.last?.status === 'failed' ? ' · 🔴 o último falhou' : ''}`,
      `*Últimos 7 dias:* ${int(o.last7Days.fiscalErrors)} notas com erro · ${int(o.last7Days.messageFailures)} mensagens que não saíram`,
      '',
      `*Varredura:* ${findingsHeadline(issues)}${issues.some((i) => i.level !== 'ok' && i.level !== 'info') ? ' (opção 4 para ver)' : ''}`,
    ].join('\n');
  }

  /** Opção 3. */
  async health(): Promise<string> {
    const [o, worker, session, vers] = await Promise.all([
      this.platform.overview(),
      this.databases.worker(),
      this.gateway.configured
        ? this.gateway.session(PLATFORM_WA_ID).catch(() => null)
        : Promise.resolve(null),
      this.versions.overview().catch(() => null),
    ]);
    const q = o.queue as Record<string, number> | null;
    // Sem versão principal conhecida (COMANDOU_VERSION), todos contam como "principal".
    const behind =
      vers?.main != null
        ? vers.versions.filter((v) => v.version !== vers.main).reduce((n, v) => n + v.tenants, 0)
        : 0;
    return [
      '*Saúde do servidor*',
      '',
      `Banco de dados: ${CHECK[o.health.database]}`,
      `Redis (fila e tempo real): ${CHECK[o.health.redis]}`,
      `Gateway do WhatsApp: ${CHECK[o.health.whatsappGateway]}${session?.phone ? ` · número ${session.phone}` : ''}`,
      `Serviço de backup e bancos: ${worker.alive ? '✅ ativo' : `🔴 parado (${seen(worker.lastSeenAt)})`}${worker.version ? ` · ${worker.version}` : ''}`,
      q
        ? `Fila de trabalhos: ${int(q.waiting ?? q.inline ?? 0)} esperando · ${int(q.active ?? 0)} rodando · ${int(q.failed ?? 0)} com falha`
        : 'Fila de trabalhos: sem leitura',
      '',
      `Versão principal: ${vers?.main ?? o.version}${behind ? ` · ${behind} restaurante(s) em versão antiga` : ''}`,
      `Bancos próprios: ${
        Object.entries(o.databases as Record<string, number>)
          .map(([k, n]) => `${n} ${k === 'ready' ? 'prontos' : k}`)
          .join(' · ') || 'nenhum'
      }`,
    ].join('\n');
  }

  /** Opção 5. */
  async backups(): Promise<string> {
    const [s, runs] = await Promise.all([
      this.backup.settings(),
      this.db.query<{
        kind: string;
        status: string;
        startedAt: Date;
        finishedAt: Date | null;
        sizeBytes: string | null;
        error: string | null;
      }>(
        `SELECT kind, status, started_at AS "startedAt", finished_at AS "finishedAt",
                size_bytes::text AS "sizeBytes", error
           FROM backup_runs WHERE tenant_id IS NULL ORDER BY started_at DESC LIMIT 5`,
      ),
    ]);
    const dest =
      s.destination === 'b2'
        ? `Backblaze (${s.bucket})`
        : s.destination === 'local'
          ? `pasta do servidor${s.local?.freeBytes != null ? ` · ${bytes(s.local.freeBytes)} livres` : ''}`
          : '🔴 sem destino configurado';
    const KIND: Record<string, string> = { backup: 'Backup', restore_test: 'Teste de restauração' };
    const ST: Record<string, string> = { ok: '✅', failed: '🔴', running: '⏳' };
    return [
      '*Backups do banco central*',
      '',
      `Destino: ${dest}`,
      `Horário: ${s.runAt ?? '—'} · guarda ${s.retentionDays ?? '—'} dias`,
      `Serviço de backup: ${s.worker.alive ? '✅ ativo' : `🔴 parado (${seen(s.worker.lastSeenAt)})`}`,
      ...(s.backupRequestedAt
        ? [`⏳ Backup pedido ${ago(s.backupRequestedAt)}, esperando o serviço`]
        : []),
      '',
      '*Últimas execuções*',
      ...(runs.length
        ? runs.map(
            (r) =>
              `${ST[r.status] ?? '•'} ${KIND[r.kind] ?? r.kind} · ${when(r.startedAt)}${r.sizeBytes ? ` · ${bytes(Number(r.sizeBytes))}` : ''}${r.error ? `\n   _${r.error.slice(0, 120)}_` : ''}`,
          )
        : ['Nenhuma ainda.']),
      '',
      '1. Fazer backup agora',
      '2. Rodar teste de restauração',
      '0. Menu principal',
    ].join('\n');
  }

  /** Opção 6. */
  async servers(): Promise<string> {
    const [l, jobs, moves] = await Promise.all([
      this.dbServers.list(),
      this.db.query<{
        kind: string;
        status: string;
        tenantSlug: string;
        createdAt: Date;
        error: string | null;
      }>(
        `SELECT kind, status, tenant_slug AS "tenantSlug", created_at AS "createdAt", error
           FROM tenant_db_jobs WHERE status IN ('queued','running')
              OR (status = 'failed' AND created_at > now() - interval '7 days')
          ORDER BY created_at DESC LIMIT 8`,
      ),
      this.db.query<{
        code: string;
        tenantSlug: string;
        stackName: string;
        status: string;
        phase: string | null;
      }>(
        `SELECT code, tenant_slug AS "tenantSlug", stack_name AS "stackName", status, phase
           FROM tenant_migrations WHERE status IN ('queued','running')
              OR (status = 'failed' AND created_at > now() - interval '7 days')
          ORDER BY created_at DESC LIMIT 5`,
      ),
    ]);
    const JOB: Record<string, string> = {
      create: 'criar banco',
      move: 'mover para banco próprio',
      delete: 'excluir',
      transfer: 'transferir de servidor',
      migrate: 'migrar para outra instalação',
      receive: 'receber de outra instalação',
      upgrade: 'atualizar versão',
    };
    const ST: Record<string, string> = {
      queued: '⏳ na fila',
      running: '⏳ rodando',
      failed: '🔴 falhou',
    };
    return [
      '*Bancos e servidores*',
      '',
      `• ${l.main.name} (${l.main.host}): ${l.main.tenants} bancos próprios + ${l.main.legacyTenants} no banco central${l.main.acceptsNew ? ' · recebe os novos' : ''}`,
      ...l.servers.map(
        (s) =>
          `• ${s.name} (${s.host}): ${s.tenants} bancos · ${s.status === 'active' ? 'ativo' : s.status}${s.acceptsNew ? ' · recebe os novos' : ''}`,
      ),
      '',
      `Serviço que cria e move bancos: ${l.worker.alive ? '✅ ativo' : '🔴 parado'}${l.worker.canCreateDatabases === false ? ' · ⚠️ sem permissão de criar banco' : ''}`,
      ...(jobs.length
        ? [
            '',
            '*Trabalhos de banco*',
            ...jobs.map(
              (j) =>
                `${ST[j.status] ?? j.status} · ${JOB[j.kind] ?? j.kind} · ${j.tenantSlug} · ${when(j.createdAt)}${j.error ? `\n   _${j.error.slice(0, 120)}_` : ''}`,
            ),
          ]
        : []),
      ...(moves.length
        ? [
            '',
            '*Migrações para outra instalação*',
            ...moves.map(
              (m) =>
                `${ST[m.status] ?? m.status} · ${m.code} · ${m.tenantSlug} → ${m.stackName}${m.phase ? ` (${m.phase})` : ''}`,
            ),
          ]
        : []),
    ].join('\n');
  }

  /** Opção 7. */
  async newcomers(): Promise<string> {
    const [fresh, trials] = await Promise.all([
      this.db.query<{
        name: string;
        slug: string;
        status: string;
        createdAt: Date;
        city: string | null;
      }>(
        `SELECT t.name, t.slug, t.status, t.created_at AS "createdAt", p.city
           FROM tenants t LEFT JOIN tenant_profiles p ON p.tenant_id = t.id
          WHERE t.created_at > now() - interval '7 days' ORDER BY t.created_at DESC LIMIT 15`,
      ),
      this.db.query<{ name: string; slug: string; endsAt: Date }>(
        `SELECT t.name, t.slug, s.trial_ends_at AS "endsAt"
           FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id
          WHERE s.status = 'trialing' AND s.trial_ends_at < now() + interval '7 days'
          ORDER BY s.trial_ends_at LIMIT 15`,
      ),
    ]);
    return [
      '*Restaurantes novos (7 dias)*',
      ...(fresh.length
        ? fresh.map(
            (t) =>
              `• ${t.name} (${t.slug})${t.city ? ` · ${t.city}` : ''} · ${ago(t.createdAt)}${t.status === 'provisioned' ? '' : ` · ${TENANT_STATUS[t.status] ?? t.status}`}`,
          )
        : ['Nenhum.']),
      '',
      '*Teste grátis acabando (7 dias)*',
      ...(trials.length
        ? trials.map(
            (t) =>
              `• ${t.name} (${t.slug}) · ${new Date(t.endsAt).getTime() < Date.now() ? `venceu ${ago(t.endsAt)}` : `acaba ${ago(t.endsAt)}`}`,
          )
        : ['Nenhum.']),
    ].join('\n');
  }

  /** Opção 8. */
  async billing(): Promise<string> {
    const [m, late, renew] = await Promise.all([
      this.money(),
      this.db.query<{
        name: string;
        slug: string;
        plan: string;
        price: string;
        since: Date | null;
      }>(
        `SELECT t.name, t.slug, p.name AS plan, p.price_monthly::text AS price,
                s.current_period_end AS since
           FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id JOIN plans p ON p.id = s.plan_id
          WHERE s.status = 'past_due' ORDER BY s.current_period_end NULLS LAST LIMIT 15`,
      ),
      this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM subscriptions
          WHERE status = 'active' AND current_period_end < now() + interval '7 days'`,
      ),
    ]);
    return [
      '*Cobrança*',
      '',
      `Receita mensal (assinaturas em dia): *${money(m.mrr)}*`,
      `${int(m.active)} em dia · ${int(m.trial)} em teste grátis · ${int(m.late)} em atraso`,
      `${int(renew[0].n)} renovam nos próximos 7 dias`,
      '',
      '*Em atraso*',
      ...(late.length
        ? late.map(
            (t) =>
              `• ${t.name} (${t.slug}) · ${t.plan} ${money(t.price)}${t.since ? ` · venceu ${ago(t.since)}` : ''}`,
          )
        : ['Nenhum. ✅']),
    ].join('\n');
  }

  /* ------------------------------------------------------------------ varredura geral */

  /**
   * Tudo que está errado agora, no sistema todo. A chave de cada item é estável enquanto o
   * problema dura (o aviso automático sai uma vez só por chave).
   */
  async issues(): Promise<Issue[]> {
    const out: Issue[] = [];
    const add = (key: string, level: Level, text: string, alert = level === 'bad') =>
      out.push({ key, level, text, alert });
    const [o, worker, backupSettings, failedTenants, prov, dbs, jobs, moves, late, tenants] =
      await Promise.all([
        this.platform.overview(),
        this.databases.worker(),
        this.backup.settings(),
        this.db.query<{ id: string; name: string; slug: string }>(
          `SELECT id, name, slug FROM tenants WHERE status = 'failed'`,
        ),
        this.db.query<{ tenantId: string; slug: string; step: string; lastError: string | null }>(
          `SELECT p.tenant_id AS "tenantId", t.slug, p.step, p.last_error AS "lastError"
             FROM tenant_provisioning_steps p JOIN tenants t ON t.id = p.tenant_id
            WHERE p.status = 'failed' AND t.status NOT IN ('deleting', 'migrated')`,
        ),
        this.db.query<{ tenantId: string; slug: string; status: string; lastError: string | null }>(
          `SELECT d.tenant_id AS "tenantId", t.slug, d.status, d.last_error AS "lastError"
             FROM tenant_databases d JOIN tenants t ON t.id = d.tenant_id WHERE d.status = 'failed'`,
        ),
        this.db.query<{ id: string; kind: string; slug: string; error: string | null }>(
          `SELECT j.id::text, j.kind, j.tenant_slug AS slug, j.error FROM tenant_db_jobs j
            WHERE j.status = 'failed' AND j.created_at > now() - interval '3 days'
              AND NOT EXISTS (SELECT 1 FROM tenant_db_jobs n WHERE n.tenant_id = j.tenant_id
                               AND n.kind = j.kind AND n.status = 'done' AND n.created_at > j.created_at)`,
        ),
        this.db.query<{ code: string; slug: string; error: string | null }>(
          `SELECT code, tenant_slug AS slug, error FROM tenant_migrations
            WHERE status = 'failed' AND created_at > now() - interval '3 days'`,
        ),
        this.db.query<{ id: string; name: string; slug: string }>(
          `SELECT s.id, t.name, t.slug FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id
            WHERE s.status = 'past_due'`,
        ),
        this.platform.listTenants({}) as unknown as Promise<TenantRow[]>,
      ]);

    // Serviços
    if (o.health.database === 'error') add('health:database', 'bad', 'Banco de dados fora do ar');
    if (o.health.redis === 'error')
      add('health:redis', 'bad', 'Redis fora do ar (fila e tempo real)');
    if (o.health.whatsappGateway === 'error')
      add('health:gateway', 'bad', 'Gateway do WhatsApp fora do ar (restaurantes sem mensagens)');
    if (!worker.alive)
      add('worker:down', 'bad', `Serviço de backup e bancos parado (${seen(worker.lastSeenAt)})`);

    // Backups do banco central
    const b = o.backups.backup;
    if (b.last?.status === 'failed')
      add(
        `backup:failed:${new Date(b.last.startedAt).toISOString()}`,
        'bad',
        `Último backup falhou (${when(b.last.startedAt)})${b.last.error ? `: ${String(b.last.error).slice(0, 120)}` : ''}`,
      );
    if (!backupSettings.destination)
      add(
        'backup:nodest',
        'bad',
        'Backup sem destino: configure o Backblaze em Super Admin › Backups',
      );
    else if (!b.lastOkAt || Date.now() - new Date(b.lastOkAt).getTime() > BACKUP_LATE_MS)
      add(
        `backup:late:${b.lastOkAt ? new Date(b.lastOkAt).toISOString() : 'nunca'}`,
        'bad',
        `Sem backup bom há mais de 26 h (último: ${b.lastOkAt ? when(b.lastOkAt) : 'nunca'})`,
      );
    const rt = o.backups.restoreTest;
    if (rt.last?.status === 'failed')
      add(
        `restore:failed:${new Date(rt.last.startedAt).toISOString()}`,
        'warn',
        `Teste de restauração falhou (${when(rt.last.startedAt)})`,
        true,
      );
    const local = backupSettings.local;
    if (local?.freeBytes != null && local.totalBytes && local.freeBytes / local.totalBytes < 0.1)
      add(
        'disk:low',
        'warn',
        `Disco dos backups quase cheio (${bytes(local.freeBytes)} livres)`,
        true,
      );

    // Restaurantes
    for (const t of failedTenants)
      add(`tenant:failed:${t.id}`, 'bad', `${t.name} (${t.slug}): criação falhou`);
    for (const p of prov)
      add(
        `prov:${p.tenantId}:${p.step}`,
        'bad',
        `${p.slug}: passo "${p.step}" da criação falhou${p.lastError ? ` (${p.lastError.slice(0, 100)})` : ''}`,
      );
    for (const d of dbs)
      add(
        `db:failed:${d.tenantId}`,
        'bad',
        `${d.slug}: banco próprio não ficou pronto${d.lastError ? ` (${d.lastError.slice(0, 100)})` : ''}`,
      );
    for (const j of jobs)
      add(
        `job:failed:${j.id}`,
        'warn',
        `${j.slug}: trabalho de banco "${j.kind}" falhou${j.error ? ` (${j.error.slice(0, 100)})` : ''}`,
        true,
      );
    for (const m of moves)
      add(`move:failed:${m.code}`, 'warn', `${m.slug}: migração ${m.code} falhou`, true);
    for (const s of late)
      add(`pastdue:${s.id}`, 'warn', `${s.name} (${s.slug}): assinatura em atraso`, true);
    for (const t of tenants) {
      if (t.status !== 'provisioned') continue;
      if ((t.fiscalErrors ?? 0) > 0)
        add(
          `fiscal:${t.id}`,
          'warn',
          `${t.name}: ${t.fiscalErrors} nota(s) fiscal(is) com erro em 7 dias`,
          false,
        );
      if ((t.messageFailures ?? 0) > 0)
        add(
          `msg:${t.id}`,
          'info',
          `${t.name}: ${t.messageFailures} mensagem(ns) de WhatsApp que não saíram em 7 dias`,
          false,
        );
    }
    if (!out.length) add('ok', 'ok', 'Nenhum problema encontrado', false);
    return out;
  }

  async issuesText(): Promise<string> {
    const list = await this.issues();
    return [`*Varredura geral* · ${findingsHeadline(list)}`, '', findingsText(list)].join('\n');
  }

  /* ------------------------------------------------------------------ um restaurante */

  async tenantOverview(id: string): Promise<string> {
    const t = (await this.platform.tenant(id)) as Awaited<ReturnType<PlatformService['tenant']>> & {
      slug: string;
      name: string;
      status: string;
      createdAt: Date;
      timezone: string;
    };
    const [plan] = t.subscription
      ? await this.db.query<{ name: string; price: string }>(
          `SELECT name, price_monthly::text AS price FROM plans WHERE id = $1`,
          [(t.subscription as { planId: string }).planId],
        )
      : [];
    const [v] = await this.db.query<{ v: string | null }>(
      `SELECT app_version AS v FROM tenants WHERE id = $1`,
      [id],
    );
    const sub = t.subscription as {
      status: string;
      trialEndsAt: Date | null;
      currentPeriodEnd: Date | null;
    } | null;
    const p = t.profile as {
      city?: string | null;
      state?: string | null;
      phone?: string | null;
      legalName?: string | null;
    };
    const u = t.usage as {
      users: number;
      products: number;
      ordersMonth: number;
      lastOrderAt: Date | null;
    };
    const db = t.database;
    const owners = t.owners as { name: string; email: string }[];
    const domains = t.domains as {
      hostname: string;
      verifiedAt: Date | null;
      lastError: string | null;
    }[];
    return [
      `*${t.name}* (${t.slug})`,
      `${TENANT_STATUS[t.status] ?? t.status} · criado ${when(t.createdAt)} (${ago(t.createdAt)})`,
      ...(p.city
        ? [`${p.city}${p.state ? `/${p.state}` : ''}${p.phone ? ` · tel. ${p.phone}` : ''}`]
        : []),
      '',
      `*Assinatura:* ${sub ? `${SUB_STATUS[sub.status] ?? sub.status}${plan ? ` · ${plan.name} ${money(plan.price)}/mês` : ''}` : 'sem assinatura'}`,
      ...(sub?.status === 'trialing' && sub.trialEndsAt
        ? [`Teste grátis acaba ${ago(sub.trialEndsAt)} (${when(sub.trialEndsAt)})`]
        : []),
      ...(sub?.currentPeriodEnd && sub.status !== 'trialing'
        ? [`Período atual até ${when(sub.currentPeriodEnd)}`]
        : []),
      '',
      `*Uso:* ${int(u.users)} pessoas · ${int(u.products)} produtos · ${int(u.ordersMonth)} pedidos no mês`,
      `Último pedido: ${u.lastOrderAt ? `${when(u.lastOrderAt)} (${ago(u.lastOrderAt)})` : 'nenhum'}`,
      `Donos: ${owners.length ? owners.map((x) => x.name).join(', ') : '🔴 nenhum dono ativo'}`,
      '',
      `*Banco:* ${db.kind === 'dedicated' ? `próprio (${db.name}) · ${db.status === 'ready' ? 'pronto' : db.status}${db.server ? ` · ${db.server.name}` : ''}${db.sizeBytes != null ? ` · ${bytes(db.sizeBytes)}` : ''}` : 'banco central'}`,
      `*Versão:* ${v?.v ?? `principal (${this.versions.main ?? RELEASES[0].version})`}`,
      ...(domains.length
        ? [
            `*Domínios:* ${domains.map((d) => `${d.hostname}${d.verifiedAt ? ' ✅' : ' ⏳'}`).join(', ')}`,
          ]
        : []),
    ].join('\n');
  }

  async tenantMovement(id: string): Promise<string> {
    const i = await this.platform.insights(id);
    type KV = { key: string; count: number; revenue?: number; amount?: number };
    const op = i.operation as {
      orders: {
        total: number;
        cancelled: number;
        revenue: number;
        avgTicket: number;
        open: number;
        last: string | null;
      };
      byChannel: KV[];
      payments: KV[];
      topProducts: { name: string; qty: number }[];
      cash: { openSessions: number; openTabs: number };
      stock: { items: number; belowMin: number };
      catalog: { products: number; soldOut: number };
    };
    const CH: Record<string, string> = {
      counter: 'balcão',
      table: 'mesa',
      delivery: 'entrega',
      takeout: 'retirada',
      online: 'online',
      whatsapp: 'WhatsApp',
      app: 'aplicativos',
    };
    const PAY: Record<string, string> = {
      cash: 'dinheiro',
      pix: 'Pix',
      credit: 'crédito',
      debit: 'débito',
      card: 'cartão',
      voucher: 'vale',
      app: 'pago no app',
    };
    return [
      `*Movimento · últimos 30 dias*`,
      '',
      `Pedidos: *${int(op.orders.total)}* (${int(op.orders.cancelled)} cancelados) · ${int(op.orders.open)} abertos agora`,
      `Faturamento: *${money(op.orders.revenue)}* · ticket médio ${money(op.orders.avgTicket)}`,
      ...(op.byChannel.length
        ? [
            `Por canal: ${op.byChannel
              .slice(0, 5)
              .map((c) => `${CH[c.key] ?? c.key} ${int(c.count)}`)
              .join(' · ')}`,
          ]
        : []),
      ...(op.payments.length
        ? [
            `Pagamentos: ${op.payments
              .slice(0, 5)
              .map((c) => `${PAY[c.key] ?? c.key} ${money(c.amount)}`)
              .join(' · ')}`,
          ]
        : []),
      ...(op.topProducts.length
        ? [
            '',
            '*Mais vendidos*',
            ...op.topProducts.slice(0, 5).map((p, n) => `${n + 1}. ${p.name} (${int(p.qty)})`),
          ]
        : []),
      '',
      `Caixas abertos: ${int(op.cash.openSessions)} · comandas abertas: ${int(op.cash.openTabs)}`,
      `Estoque abaixo do mínimo: ${int(op.stock.belowMin)} de ${int(op.stock.items)} itens`,
      `Produtos esgotados: ${int(op.catalog.soldOut)} de ${int(op.catalog.products)}`,
      `Pessoas usando agora: ${int(i.onlineNow)}`,
    ].join('\n');
  }

  /** Varredura completa de um restaurante: o que está certo e o que precisa de atenção. */
  async tenantScan(id: string): Promise<{ text: string; findings: Finding[] }> {
    const f: Finding[] = [];
    const add = (level: Level, text: string) => f.push({ level, text });
    const t = (await this.platform.tenant(id)) as Awaited<ReturnType<PlatformService['tenant']>> & {
      name: string;
      status: string;
    };
    // Situação
    if (t.status === 'provisioned') add('ok', 'Restaurante no ar');
    else if (t.status === 'suspended') add('warn', 'Restaurante suspenso');
    else add('bad', `Situação: ${TENANT_STATUS[t.status] ?? t.status}`);
    const prov = (
      t.provisioning as { step: string; status: string; lastError: string | null }[]
    ).filter((p) => p.status === 'failed');
    for (const p of prov)
      add(
        'bad',
        `Passo "${p.step}" da criação falhou${p.lastError ? `: ${p.lastError.slice(0, 100)}` : ''}`,
      );

    // Assinatura
    const sub = t.subscription as { status: string; trialEndsAt: Date | null } | null;
    if (!sub) add('warn', 'Sem assinatura');
    else if (sub.status === 'past_due') add('bad', 'Assinatura em atraso');
    else if (sub.status === 'trialing' && sub.trialEndsAt) {
      const left = new Date(sub.trialEndsAt).getTime() - Date.now();
      add(left < 3 * DAY ? 'warn' : 'info', `Teste grátis acaba ${ago(sub.trialEndsAt)}`);
    } else add('ok', 'Assinatura em dia');

    // Donos e equipe
    const owners = t.owners as unknown[];
    add(
      owners.length ? 'ok' : 'bad',
      owners.length ? `${owners.length} dono(s) ativo(s)` : 'Nenhum dono ativo',
    );

    // Banco e backup
    const db = t.database;
    if (db.kind === 'dedicated') {
      add(
        db.status === 'ready' ? 'ok' : 'bad',
        `Banco próprio ${db.status === 'ready' ? 'pronto' : db.status}`,
      );
      const lb = db.lastBackup as { status: string; startedAt: Date } | null;
      if (!lb) add('warn', 'Banco próprio ainda sem backup');
      else if (lb.status === 'failed')
        add('bad', `Último backup do banco falhou (${when(lb.startedAt)})`);
      else if (Date.now() - new Date(lb.startedAt).getTime() > BACKUP_LATE_MS)
        add('warn', `Último backup do banco ${ago(lb.startedAt)}`);
      else add('ok', `Backup do banco ${ago(lb.startedAt)}`);
      const failed = (db.jobs as { status: string; kind: string }[]).find(
        (j) => j.status === 'failed',
      );
      if (failed) add('warn', `Último trabalho de banco com falha: ${failed.kind}`);
    } else add('info', 'Dados no banco central (backup junto com o sistema)');

    // Versão
    const [v] = await this.db.query<{ v: string | null }>(
      `SELECT app_version AS v FROM tenants WHERE id = $1`,
      [id],
    );
    const main = this.versions.main;
    if (v?.v && main && v.v !== main) add('warn', `Versão antiga (${v.v}; a principal é ${main})`);

    // Domínios
    for (const d of t.domains as {
      hostname: string;
      verifiedAt: Date | null;
      lastError: string | null;
    }[])
      if (!d.verifiedAt)
        add(
          'warn',
          `Domínio ${d.hostname} não verificado${d.lastError ? `: ${d.lastError.slice(0, 80)}` : ''}`,
        );

    // Uso e operação
    const u = t.usage as {
      lastOrderAt: Date | null;
      fiscalErrors: number;
      messageFailures: number;
      products: number;
    };
    if (t.status === 'provisioned') {
      if (!u.lastOrderAt) add('warn', 'Nenhum pedido lançado ainda');
      else if (Date.now() - new Date(u.lastOrderAt).getTime() > IDLE_DAYS * DAY)
        add('warn', `Sem pedidos ${ago(u.lastOrderAt)}`);
      else add('ok', `Último pedido ${ago(u.lastOrderAt)}`);
      if (!u.products) add('warn', 'Cardápio sem produtos');
    }
    if (u.fiscalErrors) add('warn', `${u.fiscalErrors} nota(s) fiscal(is) com erro em 7 dias`);
    if (u.messageFailures)
      add('warn', `${u.messageFailures} mensagem(ns) de WhatsApp que não saíram em 7 dias`);

    if (db.status === 'ready' || db.kind === 'shared') {
      const op = await this.platform
        .insights(id)
        .then(
          (i) =>
            i.operation as {
              stock: { belowMin: number };
              printAgents: { name: string; active: boolean; lastSeenAt: string | null }[];
            },
        )
        .catch(() => null);
      if (op) {
        if (op.stock.belowMin)
          add('info', `${op.stock.belowMin} item(ns) do estoque abaixo do mínimo`);
        for (const pa of op.printAgents.filter((x) => x.active))
          if (!pa.lastSeenAt || Date.now() - new Date(pa.lastSeenAt).getTime() > PRINTER_LATE_MS)
            add('warn', `Computador de impressão "${pa.name}" desligado (${seen(pa.lastSeenAt)})`);
      }
    }

    const text = [`*Varredura · ${t.name}*`, findingsHeadline(f), '', findingsText(f)].join('\n');
    return { text, findings: f };
  }

  async tenantTeam(id: string): Promise<string> {
    const team = (await this.platform.team(id)) as {
      name: string;
      role: string;
      status: string;
      lastSeenAt: Date | null;
      activeSessions: number;
    }[];
    const ROLE: Record<string, string> = {
      owner: 'dono',
      manager: 'gerente',
      cashier: 'caixa',
      waiter: 'garçom',
      kitchen: 'cozinha',
      driver: 'entregador',
      attendant: 'atendente',
    };
    const active = team.filter((m) => m.status === 'active');
    return [
      `*Equipe* · ${active.length} ativa(s) de ${team.length}`,
      '',
      ...(team.length
        ? team
            .slice(0, 25)
            .map(
              (m) =>
                `• ${m.name} · ${ROLE[m.role] ?? m.role}${m.status === 'active' ? '' : ` · ${m.status}`} · ${m.lastSeenAt ? `visto ${ago(m.lastSeenAt)}` : 'nunca entrou'}${m.activeSessions ? ` · ${m.activeSessions} sessão(ões)` : ''}`,
            )
        : ['Ninguém ainda.']),
      ...(team.length > 25 ? [`…e mais ${team.length - 25}`] : []),
      '',
      '_Para entrar como suporte ou trocar senha, use o painel._',
    ].join('\n');
  }

  async tenantHistory(id: string): Promise<string> {
    const rows = await this.db.query<{ action: string; admin: string | null; at: Date }>(
      `SELECT l.action, a.name AS admin, l.created_at AS at FROM platform_audit_log l
         LEFT JOIN platform_admins a ON a.id = l.admin_id
        WHERE l.tenant_id = $1 ORDER BY l.created_at DESC LIMIT 12`,
      [id],
    );
    const label = (a: string) => a.replace(/^platform\./, '').replace(/[._]/g, ' ');
    return [
      '*Histórico do painel* (últimas 12)',
      '',
      ...(rows.length
        ? rows.map((r) => `• ${when(r.at)} · ${label(r.action)}${r.admin ? ` · ${r.admin}` : ''}`)
        : ['Nada registrado ainda.']),
    ].join('\n');
  }

  async tenantDatabase(id: string): Promise<string> {
    const d = await this.databases.info(id);
    const lb = d.lastBackup as {
      status: string;
      startedAt: Date;
      sizeBytes: string | null;
      error: string | null;
    } | null;
    const jobs = d.jobs as {
      kind: string;
      status: string;
      createdAt: Date;
      error: string | null;
    }[];
    return [
      '*Banco de dados e backup*',
      '',
      d.kind === 'dedicated'
        ? `Banco próprio: ${d.name} · ${d.status === 'ready' ? '✅ pronto' : d.status}${d.server ? ` · servidor ${d.server.name} (${d.server.host})` : ' · servidor principal'}`
        : 'Banco central (junto com o sistema)',
      ...(d.sizeBytes != null ? [`Tamanho: ${bytes(d.sizeBytes)}`] : []),
      ...(d.lastError ? [`🔴 ${d.lastError.slice(0, 200)}`] : []),
      ...(d.kind === 'dedicated'
        ? [
            lb
              ? `Último backup: ${lb.status === 'ok' ? '✅' : lb.status === 'failed' ? '🔴' : '⏳'} ${when(lb.startedAt)} (${ago(lb.startedAt)})${lb.sizeBytes ? ` · ${bytes(Number(lb.sizeBytes))}` : ''}`
              : 'Último backup: nenhum ainda',
            ...(d.backupFolder ? [`Pasta: ${d.backupFolder}`] : []),
          ]
        : []),
      ...(jobs.length
        ? [
            '',
            '*Trabalhos recentes*',
            ...jobs.map((j) => `• ${j.kind} · ${j.status} · ${when(j.createdAt)}`),
          ]
        : []),
    ].join('\n');
  }
}
