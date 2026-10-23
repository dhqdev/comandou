import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { hashPassword } from '../auth/password';
import { isConfigured, SETTINGS_SQL, type BackupSettingsRow } from '../backup/backup-settings';
import { ENV, Env } from '../config/env';
import { tenantDatabaseName } from '../database/tenant-database';
import { insertInitialSubscription } from '../provisioning/provision';
import { PlatformDb, platformAudit } from './platform-db.service';
import type { Actor } from './platform.service';
import type { NewTenantInput } from './platform.schemas';

/** Serviço de backup é considerado vivo se avisou nos últimos 2 minutos. */
const WORKER_ALIVE_MS = 120_000;

const JOB_COLS = `id::text, kind, status, step, error, reason, result, tenant_slug AS "tenantSlug",
  tenant_name AS "tenantName", tenant_id AS "tenantId", created_at AS "createdAt",
  started_at AS "startedAt", finished_at AS "finishedAt"`;

/** Avisa o serviço de backup que há trabalho (entregue quando a transação confirma). */
const notify = (c: PoolClient) => c.query(`SELECT pg_notify('comandou_db_jobs', 'novo')`);

/** Pasta do restaurante no bucket de backup. */
export function tenantBackupFolder(prefix: string, slug: string) {
  return `${prefix.replace(/^\/+|\/+$/g, '')}/restaurantes/${slug}/`;
}

/**
 * Banco de cada restaurante pelo painel: criar o banco próprio, mover um restaurante antigo do
 * banco central para um banco só dele e excluir a base (com backup final). O painel só registra o
 * pedido (tenant_db_jobs); quem cria, copia e apaga bancos é o serviço de backup, que tem a
 * conexão do dono. Tudo auditado.
 */
@Injectable()
export class PlatformDatabasesService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
  ) {}

  private async settings() {
    const [s] = await this.db.query<BackupSettingsRow>(SETTINGS_SQL);
    return s;
  }

  /** Situação do serviço que executa os trabalhos de banco. */
  async worker() {
    const [s] = await this.db.query<{ worker_seen_at: Date | null; worker_info: unknown }>(
      `SELECT worker_seen_at, worker_info FROM platform_backup_settings WHERE id`,
    );
    const info = (s?.worker_info ?? {}) as { canCreateDatabases?: boolean; version?: string };
    return {
      alive: !!s?.worker_seen_at && Date.now() - s.worker_seen_at.getTime() < WORKER_ALIVE_MS,
      lastSeenAt: s?.worker_seen_at ?? null,
      canCreateDatabases: info.canCreateDatabases ?? null,
      version: info.version ?? null,
    };
  }

  /** Banco do restaurante: onde fica, tamanho, último backup e trabalhos recentes. */
  async info(tenantId: string) {
    const [row] = await this.db.query<{
      db_name: string;
      status: string;
      last_error: string | null;
      created_at: Date;
      ready_at: Date | null;
    }>(
      `SELECT db_name, status, last_error, created_at, ready_at FROM tenant_databases WHERE tenant_id = $1`,
      [tenantId],
    );
    const [t] = await this.db.query<{ slug: string }>(`SELECT slug FROM tenants WHERE id = $1`, [
      tenantId,
    ]);
    const jobs = await this.db.query(
      `SELECT ${JOB_COLS} FROM tenant_db_jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [tenantId],
    );
    const [lastBackup] = await this.db.query(
      `SELECT status, finished_at AS "finishedAt", started_at AS "startedAt", object_key AS "objectKey",
              size_bytes AS "sizeBytes", error
         FROM backup_runs WHERE tenant_id = $1 AND kind = 'backup' ORDER BY started_at DESC LIMIT 1`,
      [tenantId],
    );
    let sizeBytes: number | null = null;
    if (row && (row.status === 'ready' || row.status === 'deleting')) {
      sizeBytes = await this.db
        .poolOf(row.db_name)
        .query<{ b: string }>(`SELECT pg_database_size(current_database())::text AS b`)
        .then((r) => Number(r.rows[0].b))
        .catch(() => null);
    }
    const s = await this.settings();
    return {
      kind: row && row.status !== 'moving' ? ('dedicated' as const) : ('shared' as const),
      name: row?.db_name ?? null,
      status: row?.status ?? 'ready',
      lastError: row?.last_error ?? null,
      readyAt: row?.ready_at ?? null,
      sizeBytes,
      backupFolder: t && s ? tenantBackupFolder(s.prefix, t.slug) : null,
      lastBackup: lastBackup ?? null,
      jobs,
      worker: await this.worker(),
    };
  }

  /** Histórico de trabalhos de banco (inclui as bases excluídas e onde ficou o backup final). */
  jobs(limit = 50) {
    return this.db.query(
      `SELECT ${JOB_COLS} FROM tenant_db_jobs ORDER BY created_at DESC LIMIT $1`,
      [Math.min(Math.max(limit, 1), 200)],
    );
  }

  /**
   * Novo restaurante com banco próprio. Grava o restaurante (em criação), o registro do banco e o
   * pedido para o serviço de backup, que cria o banco, aplica as migrações e cadastra o
   * administrador. A senha vira hash aqui; nem a senha nem o hash entram na auditoria.
   */
  async create(b: NewTenantInput, a: Actor): Promise<string> {
    const exists = await this.db.query(`SELECT 1 FROM tenants WHERE slug = $1`, [b.slug]);
    if (exists.length) throw new ConflictException('Já existe um restaurante com este endereço');
    if (b.planCode) {
      const p = await this.db.query(`SELECT 1 FROM plans WHERE code = $1 AND active`, [b.planCode]);
      if (!p.length)
        throw new UnprocessableEntityException(`plano não encontrado ou inativo: ${b.planCode}`);
    }
    const dbName = tenantDatabaseName(b.slug);
    const taken = await this.db.query(`SELECT 1 FROM tenant_databases WHERE db_name = $1`, [
      dbName,
    ]);
    if (taken.length) throw new ConflictException(`O banco ${dbName} já está em uso`);
    const passwordHash = await hashPassword(b.adminPassword);
    return this.db.tx(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO tenants (slug, name, status) VALUES ($1, $2, 'provisioning') RETURNING id`,
        [b.slug, b.name],
      );
      const id = rows[0].id;
      await c.query(
        `INSERT INTO tenant_databases (tenant_id, db_name, status) VALUES ($1, $2, 'creating')`,
        [id, dbName],
      );
      await insertInitialSubscription(c, id, b.planCode);
      await c.query(
        `INSERT INTO tenant_db_jobs (tenant_id, tenant_slug, tenant_name, kind, payload, requested_by)
         VALUES ($1, $2, $3, 'create', $4, $5)`,
        [
          id,
          b.slug,
          b.name,
          { adminEmail: b.adminEmail, adminName: b.adminName, passwordHash },
          a.admin.id,
        ],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.tenant_created',
        entity: 'tenant',
        entityId: id,
        tenantId: id,
        data: {
          slug: b.slug,
          name: b.name,
          adminEmail: b.adminEmail,
          planCode: b.planCode ?? null,
          database: dbName,
        },
        ip: a.ip,
      });
      await notify(c);
      return id;
    });
  }

  private async activeJob(c: PoolClient, tenantId: string) {
    const r = await c.query(
      `SELECT 1 FROM tenant_db_jobs WHERE tenant_id = $1 AND status IN ('queued','running')`,
      [tenantId],
    );
    if (r.rowCount) throw new ConflictException('Já há um trabalho em andamento neste restaurante');
  }

  /** Tenta de novo a criação de um banco que falhou (as etapas já feitas não se repetem). */
  async retry(tenantId: string, a: Actor) {
    await this.db.tx(async (c) => {
      const t = (
        await c.query<{ slug: string; name: string; db_status: string | null }>(
          `SELECT t.slug, t.name, d.status AS db_status FROM tenants t
             LEFT JOIN tenant_databases d ON d.tenant_id = t.id WHERE t.id = $1 FOR UPDATE OF t`,
          [tenantId],
        )
      ).rows[0];
      if (!t) throw new NotFoundException('Restaurante não encontrado');
      if (t.db_status !== 'failed')
        throw new ConflictException('Só dá para tentar de novo uma criação de banco que falhou');
      await this.activeJob(c, tenantId);
      const last = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM tenant_db_jobs WHERE tenant_id = $1 AND kind = 'create'
            ORDER BY created_at DESC LIMIT 1`,
          [tenantId],
        )
      ).rows[0];
      if (!last) throw new ConflictException('Pedido de criação original não encontrado');
      await c.query(
        `UPDATE tenant_databases SET status = 'creating', last_error = NULL WHERE tenant_id = $1`,
        [tenantId],
      );
      await c.query(`UPDATE tenants SET status = 'provisioning' WHERE id = $1`, [tenantId]);
      await c.query(
        `INSERT INTO tenant_db_jobs (tenant_id, tenant_slug, tenant_name, kind, payload, requested_by)
         VALUES ($1, $2, $3, 'create', $4, $5)`,
        [tenantId, t.slug, t.name, { retryOf: last.id }, a.admin.id],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.tenant_database.retry',
        entity: 'tenant',
        entityId: tenantId,
        tenantId,
        ip: a.ip,
      });
      await notify(c);
    });
  }

  /**
   * Restaurante antigo (no banco central) ganha banco próprio. Fica sem acesso por alguns
   * segundos ou minutos, conforme o tamanho; os dados são copiados e conferidos antes da troca.
   */
  async move(tenantId: string, a: Actor) {
    await this.db.tx(async (c) => {
      const t = (
        await c.query<{ slug: string; name: string; status: string }>(
          `SELECT slug, name, status FROM tenants WHERE id = $1 FOR UPDATE`,
          [tenantId],
        )
      ).rows[0];
      if (!t) throw new NotFoundException('Restaurante não encontrado');
      const has = await c.query(`SELECT 1 FROM tenant_databases WHERE tenant_id = $1`, [tenantId]);
      if (has.rowCount) throw new ConflictException('Este restaurante já tem banco próprio');
      if (t.status !== 'provisioned' && t.status !== 'suspended')
        throw new ConflictException('Só dá para mover um restaurante ativo ou suspenso');
      await this.activeJob(c, tenantId);
      const dbName = tenantDatabaseName(t.slug);
      const taken = await c.query(`SELECT 1 FROM tenant_databases WHERE db_name = $1`, [dbName]);
      if (taken.rowCount) throw new ConflictException(`O banco ${dbName} já está em uso`);
      await c.query(
        `INSERT INTO tenant_databases (tenant_id, db_name, status) VALUES ($1, $2, 'moving')`,
        [tenantId, dbName],
      );
      await c.query(`UPDATE tenants SET status = 'moving' WHERE id = $1`, [tenantId]);
      await c.query(
        `INSERT INTO tenant_db_jobs (tenant_id, tenant_slug, tenant_name, kind, payload, requested_by)
         VALUES ($1, $2, $3, 'move', $4, $5)`,
        [tenantId, t.slug, t.name, { previousStatus: t.status }, a.admin.id],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.tenant_database.move_requested',
        entity: 'tenant',
        entityId: tenantId,
        tenantId,
        data: { database: dbName },
        ip: a.ip,
      });
      await notify(c);
    });
  }

  /**
   * Exclui o restaurante e a base dele. Exige: restaurante suspenso (ou cadastro que falhou), o
   * endereço digitado igual e um motivo. Antes de apagar, o serviço de backup faz um backup final
   * na pasta do restaurante no bucket; sem backup configurado, só uma base que nunca ficou
   * pronta pode ser excluída.
   */
  async remove(tenantId: string, b: { confirm: string; reason: string }, a: Actor) {
    const s = await this.settings();
    await this.db.tx(async (c) => {
      const t = (
        await c.query<{ slug: string; name: string; status: string; db_status: string | null }>(
          `SELECT t.slug, t.name, t.status, d.status AS db_status FROM tenants t
             LEFT JOIN tenant_databases d ON d.tenant_id = t.id WHERE t.id = $1 FOR UPDATE OF t`,
          [tenantId],
        )
      ).rows[0];
      if (!t) throw new NotFoundException('Restaurante não encontrado');
      if (b.confirm.trim().toLowerCase() !== t.slug)
        throw new UnprocessableEntityException('Digite o endereço do restaurante para confirmar');
      if (t.status !== 'suspended' && t.status !== 'failed')
        throw new ConflictException('Suspenda o restaurante antes de excluir');
      await this.activeJob(c, tenantId);
      const neverReady = t.status === 'failed' || t.db_status === 'failed';
      const backupOn = !!s && s.enabled && isConfigured(s);
      if (!backupOn && !neverReady)
        throw new UnprocessableEntityException(
          'Configure e ligue o backup antes: a exclusão sempre guarda um backup final no bucket',
        );
      await c.query(`UPDATE tenants SET status = 'deleting' WHERE id = $1`, [tenantId]);
      await c.query(`UPDATE tenant_databases SET status = 'deleting' WHERE tenant_id = $1`, [
        tenantId,
      ]);
      await c.query(
        `INSERT INTO tenant_db_jobs (tenant_id, tenant_slug, tenant_name, kind, payload, reason, requested_by)
         VALUES ($1, $2, $3, 'delete', $4, $5, $6)`,
        [
          tenantId,
          t.slug,
          t.name,
          { previousStatus: t.status, finalBackup: backupOn },
          b.reason,
          a.admin.id,
        ],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.tenant.delete_requested',
        entity: 'tenant',
        entityId: tenantId,
        tenantId,
        data: { slug: t.slug, name: t.name, reason: b.reason, finalBackup: backupOn },
        ip: a.ip,
      });
      await notify(c);
    });
  }

  /** Para o instalador e o painel saberem se o modo de banco próprio está ligado. */
  get mode() {
    return this.env.TENANT_DATABASE_MODE;
  }
}
