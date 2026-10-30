import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Client } from 'pg';
import type { z } from 'zod';
import { ENV, Env } from '../config/env';
import { DbServer, maintenanceUrl, serverOf } from '../database/tenant-database';
import { notify, PlatformDatabasesService } from './platform-databases.service';
import { PlatformDb, platformAudit } from './platform-db.service';
import type { Actor } from './platform.service';
import type { DbServerBody, DbServerUpdate } from './platform.schemas';

interface ServerRow {
  id: string;
  name: string;
  host: string;
  port: number;
  ssl: 'disable' | 'require';
  accepts_new: boolean;
  status: 'active' | 'retired';
  note: string | null;
  check_result: Record<string, unknown>;
  checked_at: Date | null;
  api_check: Record<string, unknown>;
  api_checked_at: Date | null;
  created_at: Date;
}

const toId = (ref: string) => (ref === 'main' ? null : ref);

/**
 * Servidores de banco (ADR 0011, nível 2) — a ideia do "db_host por site" do Frappe: cada
 * restaurante tem o próprio banco e o painel escolhe em qual servidor Postgres ele fica. Aqui só
 * se cadastra o servidor e se pede a mudança; quem cria, copia e apaga bancos é o serviço de
 * backup (papel dono), pela fila tenant_db_jobs (trabalho "transfer").
 *
 * Nenhuma senha é gravada: os papéis comandou_owner/app/platform do servidor novo têm as mesmas
 * senhas do principal (como a stack db-server.yml cria).
 */
@Injectable()
export class PlatformDbServersService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly databases: PlatformDatabasesService,
  ) {}

  /** Servidor principal + extras, com quantos restaurantes cada um tem e as conferências. */
  async list() {
    const rows = await this.db.query<ServerRow>(
      `SELECT * FROM platform_db_servers ORDER BY created_at`,
    );
    const counts = await this.db.query<{
      server_id: string | null;
      n: number;
      transferring: number;
    }>(
      `SELECT server_id, count(*)::int AS n,
              count(*) FILTER (WHERE status = 'transferring')::int AS transferring
         FROM tenant_databases WHERE status <> 'failed' GROUP BY server_id`,
    );
    const [central] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tenants t
        WHERE NOT EXISTS (SELECT 1 FROM tenant_databases d WHERE d.tenant_id = t.id)`,
    );
    const tenants = await this.db.query<{
      id: string;
      slug: string;
      name: string;
      status: string;
      db_status: string;
      server_id: string | null;
    }>(
      `SELECT t.id, t.slug, t.name, t.status, d.status AS db_status, d.server_id
         FROM tenant_databases d JOIN tenants t ON t.id = d.tenant_id
        WHERE d.status <> 'failed' ORDER BY t.name`,
    );
    const [w] = await this.db.query<{ worker_info: { mainServer?: unknown } | null }>(
      `SELECT worker_info FROM platform_backup_settings WHERE id`,
    );
    const count = (id: string | null) => counts.find((c) => c.server_id === id);
    const listOf = (id: string | null) =>
      tenants
        .filter((t) => t.server_id === id)
        .map((t) => ({
          id: t.id,
          slug: t.slug,
          name: t.name,
          status: t.status,
          dbStatus: t.db_status,
        }));
    const main = new URL(this.env.PLATFORM_DATABASE_URL ?? this.env.DATABASE_URL);
    return {
      main: {
        id: 'main' as const,
        name: 'Servidor principal',
        host: main.hostname,
        port: Number(main.port || 5432),
        acceptsNew: !rows.some((r) => r.accepts_new && r.status === 'active'),
        tenants: count(null)?.n ?? 0,
        legacyTenants: central?.n ?? 0,
        check: w?.worker_info?.mainServer ?? null,
        restaurants: listOf(null),
      },
      servers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        host: r.host,
        port: r.port,
        ssl: r.ssl,
        acceptsNew: r.accepts_new,
        status: r.status,
        note: r.note,
        tenants: count(r.id)?.n ?? 0,
        check: r.checked_at ? { ...r.check_result, at: r.checked_at } : null,
        apiCheck: r.api_checked_at ? { ...r.api_check, at: r.api_checked_at } : null,
        createdAt: r.created_at,
        restaurants: listOf(r.id),
      })),
      worker: await this.databases.worker(),
    };
  }

  async create(b: z.infer<typeof DbServerBody>, a: Actor) {
    this.notMain(b.host, b.port);
    const id = await this.db.tx(async (c) => {
      const dup = await c.query(`SELECT 1 FROM platform_db_servers WHERE host = $1 AND port = $2`, [
        b.host,
        b.port,
      ]);
      if (dup.rowCount) throw new ConflictException('Este servidor já está cadastrado');
      const named = await c.query(`SELECT 1 FROM platform_db_servers WHERE name = $1`, [b.name]);
      if (named.rowCount) throw new ConflictException('Já existe um servidor com este nome');
      if (b.acceptsNew)
        await c.query(`UPDATE platform_db_servers SET accepts_new = false WHERE accepts_new`);
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO platform_db_servers (name, host, port, ssl, accepts_new, note)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [b.name, b.host, b.port, b.ssl, b.acceptsNew, b.note],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.db_server.created',
        entity: 'db_server',
        entityId: rows[0].id,
        data: { name: b.name, host: b.host, port: b.port, ssl: b.ssl, acceptsNew: b.acceptsNew },
        ip: a.ip,
      });
      return rows[0].id;
    });
    await this.test(id, a).catch(() => undefined);
    return this.list();
  }

  async update(id: string, b: z.infer<typeof DbServerUpdate>, a: Actor) {
    await this.db.tx(async (c) => {
      const cur = (
        await c.query<ServerRow>(`SELECT * FROM platform_db_servers WHERE id = $1 FOR UPDATE`, [id])
      ).rows[0];
      if (!cur) throw new NotFoundException('Servidor não encontrado');
      const moved = (b.host && b.host !== cur.host) || (b.port && b.port !== cur.port);
      if (moved) {
        this.notMain(b.host ?? cur.host, b.port ?? cur.port);
        // Mudar o endereço com restaurantes lá só vale para o MESMO servidor com outro nome.
        const busy = await c.query(
          `SELECT 1 FROM tenant_databases WHERE server_id = $1 AND status = 'transferring'`,
          [id],
        );
        if (busy.rowCount)
          throw new ConflictException('Espere as mudanças em andamento terminarem');
      }
      if (b.acceptsNew)
        await c.query(
          `UPDATE platform_db_servers SET accepts_new = false WHERE accepts_new AND id <> $1`,
          [id],
        );
      const retiring = b.status === 'retired';
      await c.query(
        `UPDATE platform_db_servers SET name = $2, host = $3, port = $4, ssl = $5,
                accepts_new = $6, status = $7, note = $8, checked_at = CASE WHEN $9 THEN NULL ELSE checked_at END
          WHERE id = $1`,
        [
          id,
          b.name ?? cur.name,
          b.host ?? cur.host,
          b.port ?? cur.port,
          b.ssl ?? cur.ssl,
          retiring ? false : (b.acceptsNew ?? cur.accepts_new),
          b.status ?? cur.status,
          b.note === undefined ? cur.note : b.note,
          !!moved || b.ssl !== undefined,
        ],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.db_server.updated',
        entity: 'db_server',
        entityId: id,
        data: { ...b },
        ip: a.ip,
      });
    });
    return this.list();
  }

  /** Remove o cadastro de um servidor vazio (os bancos dele já foram para outro). */
  async remove(id: string, a: Actor) {
    await this.db.tx(async (c) => {
      const cur = (
        await c.query<ServerRow>(`SELECT * FROM platform_db_servers WHERE id = $1 FOR UPDATE`, [id])
      ).rows[0];
      if (!cur) throw new NotFoundException('Servidor não encontrado');
      const used = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tenant_databases WHERE server_id = $1`,
        [id],
      );
      if (used.rows[0].n)
        throw new ConflictException(
          `Ainda há ${used.rows[0].n} restaurante(s) neste servidor: mova todos antes de remover`,
        );
      await c.query(`DELETE FROM platform_db_servers WHERE id = $1`, [id]);
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.db_server.removed',
        entity: 'db_server',
        entityId: id,
        data: { name: cur.name, host: cur.host, port: cur.port },
        ip: a.ip,
      });
    });
    return this.list();
  }

  /**
   * Teste pela API: os papéis da aplicação e do painel entram no servidor novo com as mesmas
   * senhas? (o papel dono é conferido pelo serviço de backup, que pede de novo agora).
   */
  async test(id: string, _a: Actor) {
    const [cur] = await this.db.query<ServerRow>(
      `SELECT * FROM platform_db_servers WHERE id = $1`,
      [id],
    );
    if (!cur) throw new NotFoundException('Servidor não encontrado');
    const server = serverOf(cur)!;
    const app = await tryLogin(this.env.DATABASE_URL, server);
    const platform = this.env.PLATFORM_DATABASE_URL
      ? await tryLogin(this.env.PLATFORM_DATABASE_URL, server)
      : { ok: false, error: 'PLATFORM_DATABASE_URL não definida' };
    const result = { ok: app.ok && platform.ok, app, platform };
    await this.db.query(
      `UPDATE platform_db_servers SET api_check = $2, api_checked_at = now(), checked_at = NULL WHERE id = $1`,
      [id, result],
    );
    return result;
  }

  /** Leva um restaurante para outro servidor (ou para o principal). */
  async transfer(tenantId: string, to: string, a: Actor) {
    const toId_ = toId(to);
    if (toId_) await this.activeServer(toId_);
    const [reg] = await this.db.query<{ server_id: string | null }>(
      `SELECT server_id FROM tenant_databases WHERE tenant_id = $1`,
      [tenantId],
    );
    // Restaurante antigo (no banco central): ganha banco próprio já no servidor escolhido.
    if (!reg) return this.databases.move(tenantId, a, toId_);
    await this.db.tx(async (c) => {
      await this.enqueue(c, tenantId, toId_, a);
      await notify(c);
    });
  }

  /** Leva todos os restaurantes de um servidor para outro. Um por vez, na fila. */
  async transferAll(from: string, to: string, a: Actor) {
    const fromId = toId(from);
    const toId_ = toId(to);
    if (fromId === toId_)
      throw new UnprocessableEntityException('Escolha outro servidor de destino');
    if (toId_) await this.activeServer(toId_);
    const list = await this.db.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM tenant_databases WHERE server_id IS NOT DISTINCT FROM $1 AND status = 'ready'`,
      [fromId],
    );
    const queued: string[] = [];
    const skipped: { slug: string; reason: string }[] = [];
    for (const r of list) {
      try {
        await this.db.tx(async (c) => {
          const slug = await this.enqueue(c, r.tenant_id, toId_, a);
          queued.push(slug);
          await notify(c);
        });
      } catch (e) {
        const [t] = await this.db.query<{ slug: string }>(
          `SELECT slug FROM tenants WHERE id = $1`,
          [r.tenant_id],
        );
        skipped.push({ slug: t?.slug ?? r.tenant_id, reason: (e as Error).message });
      }
    }
    return { queued: queued.length, skipped };
  }

  private async enqueue(
    c: import('pg').PoolClient,
    tenantId: string,
    to: string | null,
    a: Actor,
  ): Promise<string> {
    const t = (
      await c.query<{
        slug: string;
        name: string;
        status: string;
        db_status: string;
        server_id: string | null;
        db_name: string;
      }>(
        `SELECT t.slug, t.name, t.status, d.status AS db_status, d.server_id, d.db_name
           FROM tenants t JOIN tenant_databases d ON d.tenant_id = t.id
          WHERE t.id = $1 FOR UPDATE OF t, d`,
        [tenantId],
      )
    ).rows[0];
    if (!t) throw new NotFoundException('Restaurante não encontrado');
    if (t.db_status !== 'ready')
      throw new ConflictException('O banco deste restaurante não está pronto');
    if (t.status !== 'provisioned' && t.status !== 'suspended')
      throw new ConflictException('Só dá para mudar um restaurante ativo ou suspenso');
    if ((t.server_id ?? null) === to)
      throw new ConflictException('O restaurante já está neste servidor');
    await this.databases.activeJob(c, tenantId);
    await c.query(
      `UPDATE tenant_databases SET status = 'transferring', last_error = NULL WHERE tenant_id = $1`,
      [tenantId],
    );
    await c.query(`UPDATE tenants SET status = 'moving' WHERE id = $1`, [tenantId]);
    await c.query(
      `INSERT INTO tenant_db_jobs (tenant_id, tenant_slug, tenant_name, kind, payload, requested_by)
       VALUES ($1, $2, $3, 'transfer', $4, $5)`,
      [
        tenantId,
        t.slug,
        t.name,
        { previousStatus: t.status, fromServerId: t.server_id, toServerId: to },
        a.admin.id,
      ],
    );
    await platformAudit(c, {
      adminId: a.admin.id,
      action: 'platform.tenant_database.transfer_requested',
      entity: 'tenant',
      entityId: tenantId,
      tenantId,
      data: { database: t.db_name, from: t.server_id ?? 'main', to: to ?? 'main' },
      ip: a.ip,
    });
    return t.slug;
  }

  private async activeServer(id: string) {
    const [s] = await this.db.query<{ status: string }>(
      `SELECT status FROM platform_db_servers WHERE id = $1`,
      [id],
    );
    if (!s) throw new NotFoundException('Servidor não encontrado');
    if (s.status !== 'active')
      throw new ConflictException('Este servidor está desativado e não recebe restaurantes');
  }

  /** O servidor principal não é cadastrado de novo (seria o mesmo banco com outro nome). */
  private notMain(host: string, port: number) {
    for (const url of [this.env.PLATFORM_DATABASE_URL, this.env.DATABASE_URL]) {
      if (!url) continue;
      const main = new URL(url);
      if (main.hostname.toLowerCase() === host.toLowerCase() && Number(main.port || 5432) === port)
        throw new UnprocessableEntityException('Este é o servidor principal');
    }
  }
}

/** Entra no banco de manutenção do servidor com o papel da URL; nunca devolve a URL. */
async function tryLogin(base: string, server: DbServer) {
  const started = Date.now();
  const c = new Client({
    connectionString: maintenanceUrl(base, server),
    connectionTimeoutMillis: 8_000,
  });
  try {
    await c.connect();
    await c.query('SELECT 1');
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: (e as Error).message.replace(/postgres(ql)?:\/\/[^\s"']+/g, '<banco>').slice(0, 300),
    };
  } finally {
    await c.end().catch(() => undefined);
  }
}
