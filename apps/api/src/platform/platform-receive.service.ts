import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RELEASES, validateTenantSlug } from '@comandou/shared';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ENV, Env } from '../config/env';
import { tenantDatabaseName } from '../database/tenant-database';
import {
  CHUNK_LIMIT,
  Hello,
  keyFingerprint,
  knownMigrations,
  Manifest,
  MAX_PACKAGE_BYTES,
  ReceptionView,
  siteUrl,
  tokenHash,
  tokenHint,
} from '../migration/protocol';
import { notify, PlatformDatabasesService } from './platform-databases.service';
import { PlatformDb, platformAudit } from './platform-db.service';
import type { Actor } from './platform.service';

interface ReceptionRow {
  id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  source: Record<string, unknown>;
  mode: 'move' | 'copy';
  status: ReceptionView['status'];
  step: string | null;
  manifest: Manifest;
  result: Record<string, unknown>;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lado de DESTINO da migração entre instalações: o painel daqui gera um token; a instalação de
 * origem usa esse token para mandar o pacote (em blocos) e pedir a instalação. Como nas outras
 * mudanças de banco, a API só registra: quem cria o banco, restaura e libera é o serviço de
 * backup daqui (trabalho "receive" na fila tenant_db_jobs).
 */
@Injectable()
export class PlatformReceiveService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly databases: PlatformDatabasesService,
  ) {}

  // ------------------------------------------------------------------ painel daqui
  async settings() {
    const [r] = await this.db.query<{ enabled: boolean; token_hint: string | null }>(
      `SELECT enabled, token_hint FROM platform_receiver WHERE id`,
    );
    const receptions = await this.db.query(
      `SELECT id, tenant_id AS "tenantId", tenant_slug AS "tenantSlug", tenant_name AS "tenantName",
              source, mode, status, step, error, result, created_at AS "createdAt", finished_at AS "finishedAt",
              manifest->>'size' AS size
         FROM tenant_receptions ORDER BY created_at DESC LIMIT 30`,
    );
    return {
      enabled: !!r?.enabled,
      tokenHint: r?.token_hint ?? null,
      baseDomain: this.env.COMANDOU_BASE_DOMAIN,
      adminUrl: siteUrl('admin', this.env.COMANDOU_BASE_DOMAIN),
      keyFingerprint: keyFingerprint(this.env.INTEGRATIONS_KEY),
      receptions,
    };
  }

  /** Liga o recebimento com um token novo (mostrado uma vez só) ou desliga. */
  async configure(enabled: boolean, a: Actor) {
    const token = enabled ? `cmr_${randomBytes(24).toString('base64url')}` : null;
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE platform_receiver SET enabled = $1, token_hash = $2, token_hint = $3 WHERE id`,
        [enabled, token ? tokenHash(token) : null, token ? tokenHint(token) : null],
      );
      await platformAudit(c, {
        adminId: a.admin.id,
        action: enabled ? 'platform.receiver.enabled' : 'platform.receiver.disabled',
        entity: 'receiver',
        ip: a.ip,
      });
    });
    return { ...(await this.settings()), token };
  }

  // ------------------------------------------------------------------ rotas da origem (token)
  /** Confere o token de recebimento (tempo constante). */
  async authorize(header: string | undefined) {
    const got = /^Bearer (.+)$/.exec(header ?? '')?.[1] ?? '';
    const [r] = await this.db.query<{ enabled: boolean; token_hash: Buffer | null }>(
      `SELECT enabled, token_hash FROM platform_receiver WHERE id`,
    );
    const ok =
      !!r?.enabled &&
      !!r.token_hash &&
      !!got &&
      timingSafeEqual(tokenHash(got), Buffer.from(r.token_hash));
    if (!ok) throw new ForbiddenException('Token de recebimento inválido ou recebimento desligado');
  }

  async hello(): Promise<Hello> {
    const w = await this.databases.worker();
    return {
      ok: true,
      version: RELEASES[0]!.version,
      baseDomain: this.env.COMANDOU_BASE_DOMAIN,
      migrations: knownMigrations(),
      keyFingerprint: keyFingerprint(this.env.INTEGRATIONS_KEY),
      worker: {
        alive: w.alive && w.canCreateDatabases !== false,
        lastSeenAt: w.lastSeenAt?.toISOString() ?? null,
      },
      maxPackageBytes: MAX_PACKAGE_BYTES,
    };
  }

  /** Endereço livre aqui? (a origem pergunta antes de montar o pacote). */
  async slugCheck(slug: string, tenantId: string) {
    const v = validateTenantSlug(slug);
    if (!v.ok) return { free: false, reason: v.reason };
    if (!UUID_RE.test(tenantId)) return { free: false, reason: 'id inválido' };
    const [t] = await this.db.query<{ slug: string }>(
      `SELECT slug FROM tenants WHERE slug = $1 OR id = $2 LIMIT 1`,
      [slug, tenantId],
    );
    if (t)
      return {
        free: false,
        reason:
          t.slug === slug
            ? `Já existe um restaurante com o endereço ${slug} no destino`
            : 'Este restaurante já existe no destino (mesmo id)',
      };
    const db = await this.db.query(`SELECT 1 FROM tenant_databases WHERE db_name = $1`, [
      tenantDatabaseName(slug),
    ]);
    if (db.length) return { free: false, reason: `O banco ${tenantDatabaseName(slug)} já existe` };
    return { free: true };
  }

  /** Abre um recebimento: confere o manifesto e reserva o endereço. */
  async open(m: Manifest) {
    if (!UUID_RE.test(m.tenantId)) throw new UnprocessableEntityException('id inválido');
    if (m.size <= 0 || m.size > MAX_PACKAGE_BYTES)
      throw new PayloadTooLargeException('Pacote grande demais para receber');
    if (m.chunks !== Math.ceil(m.size / m.chunkSize) || m.chunkSize > CHUNK_LIMIT)
      throw new UnprocessableEntityException('Blocos do pacote não batem com o tamanho');
    if (!/^[0-9a-f]{64}$/.test(m.sha256)) throw new UnprocessableEntityException('sha256 inválido');
    const known = new Set(knownMigrations());
    const missing = m.migrations.filter((v) => !known.has(v));
    if (missing.length)
      throw new ConflictException(
        `Esta instalação é mais antiga que a de origem (falta ${missing[0]}). Atualize o destino antes.`,
      );
    const free = await this.slugCheck(m.targetSlug, m.tenantId);
    if (!free.free) throw new ConflictException(free.reason);
    const { central, ...rest } = m;
    return this.db.tx(async (c) => {
      // Uma tentativa anterior que ficou pela metade (ainda recebendo) é descartada.
      await c.query(
        `UPDATE tenant_receptions SET status = 'discarded', finished_at = now(),
                error = 'Substituído por um envio novo'
          WHERE tenant_id = $1 AND status = 'receiving'`,
        [m.tenantId],
      );
      const busy = await c.query(
        `SELECT 1 FROM tenant_receptions WHERE tenant_id = $1 AND status IN ('installing','restored')`,
        [m.tenantId],
      );
      if (busy.rowCount)
        throw new ConflictException('Já há uma instalação deste restaurante em andamento aqui');
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO tenant_receptions (tenant_id, tenant_slug, tenant_name, source, mode, manifest)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          m.tenantId,
          m.targetSlug,
          m.name,
          { code: m.code, url: m.source.url, version: m.source.version, slug: m.slug },
          m.mode,
          { ...rest, central },
        ],
      );
      await platformAudit(c, {
        action: 'platform.reception.opened',
        entity: 'reception',
        entityId: rows[0]!.id,
        data: { code: m.code, slug: m.targetSlug, size: m.size, from: m.source.url },
      });
      return { id: rows[0]!.id };
    });
  }

  private async row(id: string, c?: PoolClient): Promise<ReceptionRow> {
    if (!UUID_RE.test(id)) throw new NotFoundException('Recebimento não encontrado');
    const q = `SELECT * FROM tenant_receptions WHERE id = $1${c ? ' FOR UPDATE' : ''}`;
    const r = c ? (await c.query<ReceptionRow>(q, [id])).rows : await this.db.query(q, [id]);
    if (!r[0]) throw new NotFoundException('Recebimento não encontrado');
    return r[0] as ReceptionRow;
  }

  async putChunk(id: string, idx: number, data: Buffer) {
    const r = await this.row(id);
    if (r.status !== 'receiving')
      throw new ConflictException('Este recebimento não aceita mais blocos');
    const m = r.manifest;
    if (!Number.isInteger(idx) || idx < 0 || idx >= m.chunks)
      throw new UnprocessableEntityException('Bloco fora do pacote');
    const want = idx === m.chunks - 1 ? m.size - idx * m.chunkSize : m.chunkSize;
    if (!Buffer.isBuffer(data) || data.length !== want)
      throw new UnprocessableEntityException(
        `Bloco ${idx} com ${data?.length ?? 0} bytes (esperado ${want})`,
      );
    await this.db.query(
      `INSERT INTO tenant_reception_chunks (reception_id, idx, data) VALUES ($1, $2, $3)
       ON CONFLICT (reception_id, idx) DO NOTHING`,
      [id, idx, data],
    );
    return { ok: true };
  }

  async view(id: string): Promise<ReceptionView> {
    const r = await this.row(id);
    const got = await this.db.query<{ idx: number }>(
      `SELECT idx FROM tenant_reception_chunks WHERE reception_id = $1 ORDER BY idx`,
      [id],
    );
    const stage = (r.result.stage as ReceptionView['stage'] | undefined) ?? null;
    return {
      id: r.id,
      status: r.status,
      step: r.step,
      error: r.error,
      received:
        r.status === 'receiving' || r.status === 'installing'
          ? got.map((g) => g.idx)
          : Array.from({ length: r.manifest.chunks }, (_, i) => i),
      stage,
      result: r.result,
      url: siteUrl(r.tenant_slug, this.env.COMANDOU_BASE_DOMAIN),
    };
  }

  /** Todos os blocos chegaram: pede ao serviço de backup daqui para criar e restaurar. */
  async install(id: string) {
    await this.db.tx(async (c) => {
      const r = await this.row(id, c);
      if (r.status === 'installing' || r.status === 'restored') return;
      if (r.status !== 'receiving') throw new ConflictException(`Recebimento ${r.status}`);
      const { rows } = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tenant_reception_chunks WHERE reception_id = $1`,
        [id],
      );
      if (rows[0]!.n !== r.manifest.chunks)
        throw new ConflictException(`Faltam blocos (${rows[0]!.n} de ${r.manifest.chunks})`);
      await c.query(
        `UPDATE tenant_receptions SET status = 'installing', step = 'Na fila do serviço de backup', error = NULL
          WHERE id = $1`,
        [id],
      );
      await this.enqueue(c, r, 'install');
    });
    return this.view(id);
  }

  /** Virada: libera o restaurante aqui (ou deixa suspenso, se a origem pediu). */
  async activate(id: string) {
    await this.db.tx(async (c) => {
      const r = await this.row(id, c);
      if (r.status === 'active') return;
      if (r.status !== 'restored')
        throw new ConflictException('O restaurante ainda não foi restaurado aqui');
      await this.enqueue(c, r, 'activate');
    });
    return this.view(id);
  }

  /** Desfaz: apaga o banco e o cadastro criados aqui (só antes da virada). */
  async discard(id: string) {
    await this.db.tx(async (c) => {
      const r = await this.row(id, c);
      if (r.status === 'discarded') return;
      if (r.status === 'active')
        throw new ConflictException('O restaurante já está em uso aqui: não dá para desfazer');
      if (r.status === 'receiving' || (r.status === 'failed' && !r.result.created)) {
        await c.query(`DELETE FROM tenant_reception_chunks WHERE reception_id = $1`, [id]);
        await c.query(
          `UPDATE tenant_receptions SET status = 'discarded', finished_at = now() WHERE id = $1`,
          [id],
        );
        return;
      }
      await this.enqueue(c, r, 'discard');
    });
    return this.view(id);
  }

  private async enqueue(
    c: PoolClient,
    r: ReceptionRow,
    action: 'install' | 'activate' | 'discard',
  ) {
    const active = await c.query(
      `SELECT 1 FROM tenant_db_jobs WHERE tenant_id = $1 AND status IN ('queued','running')`,
      [r.tenant_id],
    );
    if (active.rowCount)
      throw new ConflictException(
        'O serviço de backup daqui ainda está trabalhando neste restaurante',
      );
    await c.query(
      `INSERT INTO tenant_db_jobs (tenant_id, tenant_slug, tenant_name, kind, payload)
       VALUES ($1, $2, $3, 'receive', $4)`,
      [r.tenant_id, r.tenant_slug, r.tenant_name, { receptionId: r.id, action }],
    );
    await notify(c);
  }
}
