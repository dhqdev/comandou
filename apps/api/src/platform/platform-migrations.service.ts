import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { z } from 'zod';
import { open, seal } from '../common/secret-box';
import { ENV, Env } from '../config/env';
import {
  emptyPhases,
  keyFingerprint,
  knownMigrations,
  migrationCode,
  normalizeStackUrl,
  STACK_TOKEN_CONTEXT,
  tokenHint,
} from '../migration/protocol';
import { RemoteStack, StackClient } from '../migration/stack-client';
import { notify, PlatformDatabasesService } from './platform-databases.service';
import { PlatformDb, platformAudit } from './platform-db.service';
import type { Actor } from './platform.service';
import type { NewMigration, StackBody } from './platform.schemas';

interface StackRow {
  id: string;
  name: string;
  url: string;
  token_enc: Buffer;
  token_hint: string | null;
  note: string | null;
  check_result: Record<string, unknown>;
  checked_at: Date | null;
  created_at: Date;
}

export const MIGRATION_COLS = `id::text, code, tenant_id AS "tenantId", tenant_slug AS "tenantSlug",
  tenant_name AS "tenantName", stack_id AS "stackId", stack_name AS "stackName", mode, options,
  status, phase, phases, package, remote_url AS "remoteUrl", result, error, created_at AS "createdAt",
  started_at AS "startedAt", finished_at AS "finishedAt"`;

/**
 * Migrar cliente (lado de ORIGEM): cadastro das outras instalações (stacks) e os pedidos de
 * migração. Quem executa as fases é o serviço de backup (trabalho "migrate"), que tem a conexão
 * do dono e o pg_dump; o painel só registra e mostra o andamento.
 */
@Injectable()
export class PlatformMigrationsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly databases: PlatformDatabasesService,
  ) {}

  private key() {
    if (!this.env.INTEGRATIONS_KEY)
      throw new UnprocessableEntityException(
        'Servidor sem INTEGRATIONS_KEY: não é possível guardar o token com segurança',
      );
    return this.env.INTEGRATIONS_KEY;
  }

  /** Cliente do painel de destino (o token só é aberto aqui, na hora). */
  client(s: Pick<StackRow, 'id' | 'url' | 'token_enc'>, timeoutMs = 15_000): RemoteStack {
    const token = open(this.key(), s.token_enc, `${STACK_TOKEN_CONTEXT}:${s.id}`);
    return new StackClient(s.url, token, timeoutMs);
  }

  async list() {
    const stacks = await this.db.query<StackRow>(`SELECT * FROM platform_stacks ORDER BY name`);
    const migrations = await this.db.query(
      `SELECT ${MIGRATION_COLS} FROM tenant_migrations ORDER BY created_at DESC LIMIT 50`,
    );
    const tenants = await this.db.query<{
      id: string;
      slug: string;
      name: string;
      status: string;
      db_status: string | null;
    }>(
      `SELECT t.id, t.slug, t.name, t.status, d.status AS db_status
         FROM tenants t LEFT JOIN tenant_databases d ON d.tenant_id = t.id
        WHERE t.status IN ('provisioned','suspended') ORDER BY t.name`,
    );
    return {
      keyFingerprint: keyFingerprint(this.env.INTEGRATIONS_KEY),
      migrations: knownMigrations().length,
      stacks: stacks.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        tokenHint: s.token_hint,
        note: s.note,
        check: s.checked_at ? { ...s.check_result, at: s.checked_at } : null,
        createdAt: s.created_at,
      })),
      tenants: tenants.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        status: t.status,
        // Só restaurante com banco próprio pronto pode sair (o pacote é o banco dele).
        ready: t.db_status === 'ready',
      })),
      list: migrations,
      worker: await this.databases.worker(),
    };
  }

  async get(id: string) {
    if (!/^\d{1,18}$/.test(id)) throw new NotFoundException('Migração não encontrada');
    const [m] = await this.db.query(
      `SELECT ${MIGRATION_COLS} FROM tenant_migrations WHERE id = $1`,
      [id],
    );
    if (!m) throw new NotFoundException('Migração não encontrada');
    return m;
  }

  async createStack(b: z.infer<typeof StackBody>, a: Actor) {
    if (!b.token)
      throw new UnprocessableEntityException('Cole o token gerado no painel de destino');
    const url = normalizeStackUrl(b.url);
    const id = await this.db.tx(async (c) => {
      const dup = await c.query(`SELECT 1 FROM platform_stacks WHERE url = $1 OR name = $2`, [
        url,
        b.name,
      ]);
      if (dup.rowCount)
        throw new ConflictException('Já existe uma stack com este nome ou endereço');
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO platform_stacks (name, url, token_enc, token_hint, note)
         VALUES ($1, $2, '\\x00', $3, $4) RETURNING id`,
        [b.name, url, tokenHint(b.token!), b.note],
      );
      const sid = rows[0]!.id;
      await c.query(`UPDATE platform_stacks SET token_enc = $2 WHERE id = $1`, [
        sid,
        seal(this.key(), b.token!, `${STACK_TOKEN_CONTEXT}:${sid}`),
      ]);
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.stack.created',
        entity: 'stack',
        entityId: sid,
        data: { name: b.name, url },
        ip: a.ip,
      });
      return sid;
    });
    await this.test(id).catch(() => undefined);
    return this.list();
  }

  async updateStack(id: string, b: z.infer<typeof StackBody>, a: Actor) {
    const url = normalizeStackUrl(b.url);
    await this.db.tx(async (c) => {
      const cur = await c.query(`SELECT 1 FROM platform_stacks WHERE id = $1 FOR UPDATE`, [id]);
      if (!cur.rowCount) throw new NotFoundException('Stack não encontrada');
      const dup = await c.query(
        `SELECT 1 FROM platform_stacks WHERE (url = $1 OR name = $2) AND id <> $3`,
        [url, b.name, id],
      );
      if (dup.rowCount)
        throw new ConflictException('Já existe uma stack com este nome ou endereço');
      await c.query(
        `UPDATE platform_stacks SET name = $2, url = $3, note = $4, checked_at = NULL WHERE id = $1`,
        [id, b.name, url, b.note],
      );
      if (b.token)
        await c.query(`UPDATE platform_stacks SET token_enc = $2, token_hint = $3 WHERE id = $1`, [
          id,
          seal(this.key(), b.token, `${STACK_TOKEN_CONTEXT}:${id}`),
          tokenHint(b.token),
        ]);
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.stack.updated',
        entity: 'stack',
        entityId: id,
        data: { name: b.name, url, token: b.token ? 'trocado' : 'mantido' },
        ip: a.ip,
      });
    });
    await this.test(id).catch(() => undefined);
    return this.list();
  }

  async removeStack(id: string, a: Actor) {
    await this.db.tx(async (c) => {
      const busy = await c.query(
        `SELECT 1 FROM tenant_migrations WHERE stack_id = $1 AND status IN ('queued','running')`,
        [id],
      );
      if (busy.rowCount)
        throw new ConflictException('Há uma migração em andamento para esta stack');
      const r = await c.query(`DELETE FROM platform_stacks WHERE id = $1`, [id]);
      if (!r.rowCount) throw new NotFoundException('Stack não encontrada');
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.stack.removed',
        entity: 'stack',
        entityId: id,
        ip: a.ip,
      });
    });
    return this.list();
  }

  /**
   * Conversa com o painel de destino: token aceito, versão, domínio, migrações (o destino
   * precisa ter todas as daqui), mesma INTEGRATIONS_KEY e serviço de backup de lá vivo.
   */
  async test(id: string) {
    const [s] = await this.db.query<StackRow>(`SELECT * FROM platform_stacks WHERE id = $1`, [id]);
    if (!s) throw new NotFoundException('Stack não encontrada');
    const started = Date.now();
    let result: Record<string, unknown>;
    try {
      const h = await this.client(s).hello();
      const theirs = new Set(h.migrations);
      const missing = knownMigrations().filter((v) => !theirs.has(v));
      const mine = keyFingerprint(this.env.INTEGRATIONS_KEY);
      result = {
        ok: missing.length === 0 && h.worker.alive,
        ms: Date.now() - started,
        version: h.version,
        baseDomain: h.baseDomain,
        missingMigrations: missing.length,
        firstMissing: missing[0] ?? null,
        sameKey: !!mine && mine === h.keyFingerprint,
        workerAlive: h.worker.alive,
      };
    } catch (e) {
      result = { ok: false, ms: Date.now() - started, error: (e as Error).message.slice(0, 300) };
    }
    await this.db.query(
      `UPDATE platform_stacks SET check_result = $2, checked_at = now() WHERE id = $1`,
      [id, result],
    );
    return result;
  }

  /** Pede a migração: o serviço de backup começa pela fase "preparar". */
  async create(b: z.infer<typeof NewMigration>, a: Actor) {
    const [s] = await this.db.query<StackRow>(`SELECT * FROM platform_stacks WHERE id = $1`, [
      b.stackId,
    ]);
    if (!s) throw new NotFoundException('Stack não encontrada');
    if (b.mode === 'copy' && b.dropAtOrigin)
      throw new UnprocessableEntityException('Numa cópia o restaurante continua aqui');
    const id = await this.db.tx(async (c) => {
      const t = (
        await c.query<{
          slug: string;
          name: string;
          status: string;
          db_status: string | null;
        }>(
          `SELECT t.slug, t.name, t.status, d.status AS db_status
             FROM tenants t LEFT JOIN tenant_databases d ON d.tenant_id = t.id
            WHERE t.id = $1 FOR UPDATE OF t`,
          [b.tenantId],
        )
      ).rows[0];
      if (!t) throw new NotFoundException('Restaurante não encontrado');
      if (t.status !== 'provisioned' && t.status !== 'suspended')
        throw new ConflictException('Só dá para migrar um restaurante ativo ou suspenso');
      if (t.db_status !== 'ready')
        throw new ConflictException(
          t.db_status
            ? 'O banco deste restaurante não está pronto'
            : 'Este restaurante ainda está no banco central: mova para banco próprio antes (aba Banco)',
        );
      await this.databases.activeJob(c, b.tenantId);
      await c.query(`SELECT pg_advisory_xact_lock(7417052)`);
      const year = new Date().getFullYear();
      const { rows: n } = await c.query<{ n: number }>(
        `SELECT coalesce(max(substring(code from 10)::int), 0)::int + 1 AS n
           FROM tenant_migrations WHERE code LIKE $1`,
        [`MOV-${year}-%`],
      );
      const code = migrationCode(year, n[0]!.n);
      const options = {
        targetSlug: b.targetSlug ?? t.slug,
        backupBefore: b.backupBefore,
        keepSuspended: b.keepSuspended,
        dropAtOrigin: b.dropAtOrigin,
        ignoreKeyMismatch: b.ignoreKeyMismatch,
        previousStatus: t.status,
      };
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO tenant_migrations (code, tenant_id, tenant_slug, tenant_name, stack_id, stack_name,
                                        mode, options, phases, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id::text`,
        [
          code,
          b.tenantId,
          t.slug,
          t.name,
          s.id,
          s.name,
          b.mode,
          options,
          JSON.stringify(emptyPhases()),
          a.admin.id,
        ],
      );
      await c.query(
        `INSERT INTO tenant_db_jobs (tenant_id, tenant_slug, tenant_name, kind, payload, requested_by)
         VALUES ($1, $2, $3, 'migrate', $4, $5)`,
        [b.tenantId, t.slug, t.name, { migrationId: rows[0]!.id }, a.admin.id],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.tenant.migration_requested',
        entity: 'tenant',
        entityId: b.tenantId,
        tenantId: b.tenantId,
        data: { code, stack: s.name, url: s.url, mode: b.mode, ...options },
        ip: a.ip,
      });
      await notify(c);
      return rows[0]!.id;
    });
    return this.get(id);
  }

  /** Cancela uma migração que ainda não começou. */
  async cancel(id: string, a: Actor) {
    await this.db.tx(async (c) => {
      const [m] = (
        await c.query<{ status: string; tenant_id: string; code: string }>(
          `SELECT status, tenant_id, code FROM tenant_migrations WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows;
      if (!m) throw new NotFoundException('Migração não encontrada');
      if (m.status !== 'queued')
        throw new ConflictException('Só dá para cancelar uma migração que ainda não começou');
      // O trabalho na fila vê a migração cancelada e termina sem mexer em nada.
      await c.query(
        `UPDATE tenant_migrations SET status = 'cancelled', finished_at = now(), error = 'Cancelada no painel'
          WHERE id = $1`,
        [id],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.tenant.migration_cancelled',
        entity: 'tenant',
        entityId: m.tenant_id,
        tenantId: m.tenant_id,
        data: { code: m.code },
        ip: a.ip,
      });
    });
    return this.get(id);
  }
}
