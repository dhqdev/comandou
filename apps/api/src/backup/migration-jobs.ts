import { createWriteStream } from 'node:fs';
import { mkdtemp, open as openFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { RELEASES } from '@comandou/shared';
import { open as openSecret } from '../common/secret-box';
import { migrate } from '../database/migrator';
import {
  databaseUrl,
  DbServer,
  libpqUrl,
  TENANT_DB_NAME_RE,
  tenantDatabaseName,
} from '../database/tenant-database';
import {
  countDiff,
  exportCentralRows,
  importCentralRows,
  tableCounts,
} from '../migration/central-rows';
import {
  CHUNK_SIZE,
  emptyPhases,
  keyFingerprint,
  knownMigrations,
  Manifest,
  Phase,
  PhaseRow,
  PhaseStatus,
  ReceptionView,
  STACK_TOKEN_CONTEXT,
} from '../migration/protocol';
import { RemoteStack, StackClient } from '../migration/stack-client';
import {
  APP_ROLES,
  checkServer,
  databaseExists,
  DbJob,
  DbJobContext,
  dropDatabase,
  finishJob,
  registry,
  serverById,
  serverPool,
  sleep,
  step,
  tx,
  withClient,
} from './db-jobs';
import { backupDatabase, backupKey, bin, run, sha256File } from './jobs';
import { purgeTenantRows } from './tenant-copy';

/**
 * Migrar cliente para outra instalação (ADR 0011, nível 3), na ideia do "Movimento de Site" do
 * Frappe. Na ORIGEM (trabalho "migrate"):
 *   preparar  confere o destino, põe o restaurante em manutenção, backup de segurança, pg_dump do
 *             banco dele (o pacote, com sha256) e o cadastro no banco central;
 *   enviar    manda o pacote em blocos (retoma de onde parou);
 *   criar     o destino cria o cadastro e o banco (serviço de backup de lá);
 *   restaurar o destino restaura, aplica as migrações dele e confere as contagens;
 *   virar     o destino libera o restaurante e aqui ele vira "migrated" (o site antigo aponta o
 *             endereço novo);
 *   encerrar  apaga o banco daqui (se pedido, com backup final) e fecha.
 * Falha antes da virada desfaz tudo: o destino apaga o que criou e o restaurante volta a
 * funcionar aqui. No DESTINO (trabalho "receive"): install, activate e discard.
 */

// ====================================================================== origem
interface MigrationRow {
  id: string;
  code: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  stack_id: string | null;
  mode: 'move' | 'copy';
  options: {
    targetSlug?: string;
    backupBefore?: boolean;
    keepSuspended?: boolean;
    dropAtOrigin?: boolean;
    ignoreKeyMismatch?: boolean;
    previousStatus?: string;
  };
  status: string;
  phases: PhaseRow[];
  package: Record<string, unknown>;
  remote_id: string | null;
}

/** Quanto tempo esperar o destino instalar (bancos grandes demoram). */
const INSTALL_TIMEOUT_MS = 6 * 60 * 60_000;
const MB = 1024 * 1024;
const human = (n: number) => (n >= MB ? `${(n / MB).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

class Tracker {
  constructor(
    private readonly pool: Pool,
    private readonly id: string,
    public phases: PhaseRow[],
  ) {}
  current: Phase | null = null;

  async set(name: Phase, status: PhaseStatus, detail?: string | null) {
    const p = this.phases.find((x) => x.name === name)!;
    const now = new Date().toISOString();
    if (status === 'rodando') {
      p.startedAt ??= now;
      this.current = name;
    }
    if (status !== 'rodando' && status !== 'pendente') p.finishedAt = now;
    p.status = status;
    if (detail !== undefined) p.detail = detail?.slice(0, 300) ?? null;
    await this.pool.query(`UPDATE tenant_migrations SET phases = $2, phase = $3 WHERE id = $1`, [
      this.id,
      JSON.stringify(this.phases),
      this.current,
    ]);
  }

  async detail(text: string) {
    if (!this.current) return;
    const p = this.phases.find((x) => x.name === this.current)!;
    if (p.detail === text) return;
    p.detail = text.slice(0, 300);
    await this.pool.query(`UPDATE tenant_migrations SET phases = $2 WHERE id = $1`, [
      this.id,
      JSON.stringify(this.phases),
    ]);
  }
}

async function savePackage(pool: Pool, id: string, pkg: Record<string, unknown>) {
  await pool.query(`UPDATE tenant_migrations SET package = package || $2::jsonb WHERE id = $1`, [
    id,
    pkg,
  ]);
}

/** Tenta de novo falhas de rede (o destino pode piscar no meio do envio). */
async function retry<T>(fn: () => Promise<T>, tries = 4, waitMs = 2_000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      // Recusa do destino (4xx com mensagem) não melhora tentando de novo.
      if (/Destino respondeu 4\d\d/.test((e as Error).message)) throw e;
      await sleep(waitMs * 2 ** i);
    }
  }
  throw last;
}

/** Espera o destino chegar num estado, mostrando o passo de lá na fase atual. */
async function waitRemote(
  ctx: DbJobContext,
  remote: RemoteStack,
  id: string,
  until: ReceptionView['status'][],
  t: Tracker,
  onView?: (v: ReceptionView) => Promise<void>,
): Promise<ReceptionView> {
  const started = Date.now();
  let errors = 0;
  for (;;) {
    let v: ReceptionView;
    try {
      v = await remote.view(id);
      errors = 0;
    } catch (e) {
      if (++errors >= 10) throw e;
      await sleep(ctx.pollMs ?? 3_000);
      continue;
    }
    if (onView) await onView(v);
    if (v.step) await t.detail(v.step);
    if (until.includes(v.status)) return v;
    if (v.status === 'failed' || v.status === 'discarded')
      throw new Error(`Destino: ${v.error ?? `instalação ${v.status}`}`);
    if (Date.now() - started > INSTALL_TIMEOUT_MS) throw new Error('O destino demorou demais');
    await sleep(ctx.pollMs ?? 3_000);
  }
}

export async function runMigrate(ctx: DbJobContext, job: DbJob) {
  const migrationId = String((job.payload as { migrationId?: string }).migrationId ?? '');
  const [m] = (
    await ctx.pool.query<MigrationRow>(`SELECT * FROM tenant_migrations WHERE id = $1`, [
      migrationId,
    ])
  ).rows;
  if (!m) throw new Error('Migração não encontrada');
  if (m.status === 'cancelled') {
    await finishJob(ctx, job, { migration: m.code, cancelled: true });
    return;
  }
  if (m.status !== 'queued' && m.status !== 'running')
    throw new Error(`Migração ${m.code} já está ${m.status}`);
  await ctx.pool.query(
    `UPDATE tenant_migrations SET status = 'running', started_at = coalesce(started_at, now()), error = NULL
      WHERE id = $1`,
    [m.id],
  );
  // Serviço reiniciado no meio: recomeça do zero (o que ficou pela metade lá é desfeito abaixo).
  const restarted = m.status === 'running';
  const t = new Tracker(ctx.pool, m.id, restarted ? emptyPhases() : m.phases);
  const opts = m.options;
  const previous = opts.previousStatus === 'suspended' ? 'suspended' : 'provisioned';
  const targetSlug = opts.targetSlug ?? m.tenant_slug;
  const move = m.mode === 'move';

  const [stack] = (
    await ctx.pool.query<{ id: string; url: string; token_enc: Buffer }>(
      `SELECT id, url, token_enc FROM platform_stacks WHERE id = $1`,
      [m.stack_id],
    )
  ).rows;
  const reg = await registry(ctx, m.tenant_id);
  const [now] = (
    await ctx.pool.query<{ status: string }>(`SELECT status FROM tenants WHERE id = $1`, [
      m.tenant_id,
    ])
  ).rows;
  if (now?.status === 'migrated') {
    // Serviço reiniciado depois da virada: nada mais a fazer aqui.
    await ctx.pool.query(
      `UPDATE tenant_migrations SET status = 'done', finished_at = now(),
              result = result || '{"warning": "O serviço de backup reiniciou depois da virada; o banco daqui foi guardado."}'::jsonb
        WHERE id = $1`,
      [m.id],
    );
    await finishJob(ctx, job, { migration: m.code, resumed: true });
    return;
  }
  // Já em manutenção por esta migração (serviço reiniciado): a falha devolve o acesso.
  let maintenance = restarted && now?.status === 'moving';
  let remoteId: string | null = m.remote_id;
  let switched = false;
  let tmp: string | null = null;
  let remote: RemoteStack | null = null;
  const result: Record<string, unknown> = { migration: m.code };
  try {
    // ------------------------------------------------------------------ preparar
    await t.set('preparar', 'rodando', 'Conferindo o destino');
    await step(ctx, job, `${m.code}: preparar`);
    if (!stack) throw new Error('A stack de destino foi removida');
    if (!ctx.integrationsKey) throw new Error('Serviço de backup sem INTEGRATIONS_KEY');
    if (!reg || !(reg.status === 'ready' || (maintenance && reg.status === 'transferring')))
      throw new Error('O banco deste restaurante não está pronto (precisa de banco próprio)');
    const token = openSecret(
      ctx.integrationsKey,
      stack.token_enc,
      `${STACK_TOKEN_CONTEXT}:${stack.id}`,
    );
    remote = ctx.remote
      ? ctx.remote({ id: stack.id, url: stack.url, token })
      : new StackClient(stack.url, token, 120_000);
    const r = remote;
    const dbUrl = databaseUrl(ctx.ownerUrl, reg.db_name, reg.server);

    /** Virada do lado daqui: o restaurante sai e o endereço antigo aponta o novo. */
    const switchHere = async (url: string) => {
      await tx(ctx.pool, async (c) => {
        await c.query(`UPDATE tenants SET status = 'migrated', moved_to = $2 WHERE id = $1`, [
          m.tenant_id,
          url,
        ]);
        await c.query(
          `UPDATE tenant_databases SET status = 'ready', last_error = NULL WHERE tenant_id = $1`,
          [m.tenant_id],
        );
        await c.query(`UPDATE tenant_migrations SET remote_url = $2 WHERE id = $1`, [m.id, url]);
      });
      switched = true;
      maintenance = false;
      // Cópia da situação no banco do restaurante (melhor esforço).
      await withClient(dbUrl, (c) =>
        c.query(`UPDATE tenants SET status = 'migrated', moved_to = $2 WHERE id = $1`, [
          m.tenant_id,
          url,
        ]),
      ).catch(() => undefined);
      result.url = url;
    };

    if (restarted && remoteId) {
      // O que a tentativa anterior deixou lá: já em uso (só falta virar aqui) ou desfaz.
      const old = await r.view(remoteId).catch(() => null);
      if (old?.status === 'active' && move) {
        await switchHere(old.url);
        await t.set('virar', 'ok', `Agora em ${old.url}`);
        result.warning =
          'O serviço de backup reiniciou no meio; a virada foi concluída. O banco daqui foi guardado.';
        await t.set('encerrar', 'ok', result.warning as string);
        throw new Error('__resumed__');
      }
      await r.discard(remoteId).catch(() => undefined);
      await waitRemote(ctx, r, remoteId, ['discarded'], t).catch(() => undefined);
      remoteId = null;
      await ctx.pool.query(`UPDATE tenant_migrations SET remote_id = NULL WHERE id = $1`, [m.id]);
    }

    const hello = await retry(() => r.hello(), 3);
    if (!hello.worker.alive)
      throw new Error('O serviço de backup do destino não está rodando (é ele que instala lá)');
    const applied = await withClient(dbUrl, (c) =>
      c.query<{ version: string }>(`SELECT version FROM schema_migrations ORDER BY version`),
    ).then((x) => x.rows.map((y) => y.version));
    const theirs = new Set(hello.migrations);
    const missing = applied.filter((v) => !theirs.has(v));
    if (missing.length)
      throw new Error(
        `O destino (${hello.version}) é mais antigo que este restaurante (falta ${missing[0]}). Atualize o destino antes.`,
      );
    const sameKey = keyFingerprint(ctx.integrationsKey) === hello.keyFingerprint;
    if (!sameKey && !opts.ignoreKeyMismatch)
      throw new Error(
        'A INTEGRATIONS_KEY do destino é diferente desta: tokens do fiscal, WhatsApp, iFood e cartões não abririam lá. Use a mesma chave no servidor novo (secret comandou_integrations_key) ou marque "seguir mesmo assim".',
      );
    const free = await r.slugCheck(targetSlug, m.tenant_id);
    if (!free.free)
      throw new Error(free.reason ?? `O endereço ${targetSlug} não está livre no destino`);
    result.destination = { version: hello.version, baseDomain: hello.baseDomain, sameKey };

    if (move) {
      await t.detail('Pondo o restaurante em manutenção');
      await tx(ctx.pool, async (c) => {
        const u = await c.query(
          `UPDATE tenants SET status = 'moving' WHERE id = $1 AND status IN ('provisioned','suspended','moving')`,
          [m.tenant_id],
        );
        if (!u.rowCount) throw new Error('O restaurante não está ativo nem suspenso');
        await c.query(
          `UPDATE tenant_databases SET status = 'transferring', last_error = NULL WHERE tenant_id = $1`,
          [m.tenant_id],
        );
      });
      maintenance = true;
      await t.detail('Esperando as conexões em uso terminarem');
      await sleep(ctx.settleMs ?? 15_000);
    }
    if (opts.backupBefore && ctx.backup) {
      await t.detail('Backup de segurança antes de sair');
      const bctx = ctx.backup();
      const target = { database: reg.db_name, tenantId: m.tenant_id, slug: m.tenant_slug };
      const b = await backupDatabase(
        { ...bctx, trigger: 'painel' },
        { ...target, url: dbUrl },
        backupKey(bctx.prefix, target, new Date()),
        { beforeMigration: true, migration: m.code },
      );
      result.backupKey = b.key;
    }

    await t.detail('Gerando o pacote (pg_dump)');
    const counts = await withClient(dbUrl, (c) => tableCounts(c));
    tmp = await mkdtemp(join(ctx.workDir ?? '/tmp', 'cm-mig-'));
    const file = join(tmp, 'pacote.dump');
    await run(bin(ctx, 'pg_dump'), [
      '--format=custom',
      '--compress=6',
      '--no-comments',
      `--file=${file}`,
      `--dbname=${libpqUrl(dbUrl)}`,
    ]);
    await run(bin(ctx, 'pg_restore'), ['--list', file]);
    const { size } = await stat(file);
    const sha256 = await sha256File(file);
    const central = await withClient(ctx.ownerUrl, (c) => exportCentralRows(c, m.tenant_id));
    const chunks = Math.ceil(size / CHUNK_SIZE);
    const manifest: Manifest = {
      code: m.code,
      tenantId: m.tenant_id,
      slug: m.tenant_slug,
      name: m.tenant_name,
      targetSlug,
      mode: m.mode,
      // Uma cópia nunca liga sozinha no destino (o restaurante continua aqui).
      keepSuspended: move ? !!opts.keepSuspended : true,
      previousStatus: previous,
      size,
      sha256,
      chunkSize: CHUNK_SIZE,
      chunks,
      migrations: applied,
      counts,
      central,
      source: { url: null, version: RELEASES[0]!.version },
    };
    const opened = await retry(() => r.open(manifest), 3);
    remoteId = opened.id;
    await ctx.pool.query(`UPDATE tenant_migrations SET remote_id = $2 WHERE id = $1`, [
      m.id,
      remoteId,
    ]);
    await savePackage(ctx.pool, m.id, {
      size,
      sha256,
      chunkSize: CHUNK_SIZE,
      chunks,
      sent: 0,
      tables: Object.keys(counts).length,
      rows: Object.values(counts).reduce((a, b) => a + b, 0),
      database: reg.db_name,
    });
    await t.set('preparar', 'ok', `Pacote ${human(size)}, sha256 ${sha256.slice(0, 12)}…`);

    // ------------------------------------------------------------------ enviar
    await t.set('enviar', 'rodando', `0 de ${chunks} blocos`);
    await step(ctx, job, `${m.code}: enviar`);
    const have = new Set((await retry(() => r.view(remoteId!))).received);
    const fh = await openFile(file, 'r');
    try {
      let sent = have.size;
      for (let idx = 0; idx < chunks; idx++) {
        if (have.has(idx)) continue;
        const len = Math.min(CHUNK_SIZE, size - idx * CHUNK_SIZE);
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, idx * CHUNK_SIZE);
        await retry(() => r.putChunk(remoteId!, idx, buf));
        sent++;
        if (sent % 4 === 0 || sent === chunks) {
          await savePackage(ctx.pool, m.id, { sent });
          await t.detail(
            `${sent} de ${chunks} blocos (${human(Math.min(size, sent * CHUNK_SIZE))})`,
          );
        }
      }
      await savePackage(ctx.pool, m.id, { sent: chunks });
    } finally {
      await fh.close();
    }
    await t.set('enviar', 'ok', `${chunks} blocos, ${human(size)}`);

    // ------------------------------------------------------------------ criar + restaurar
    await t.set('criar', 'rodando', 'Pedindo a instalação no destino');
    await step(ctx, job, `${m.code}: criar e restaurar`);
    await retry(() => r.install(remoteId!));
    const restored = await waitRemote(ctx, r, remoteId, ['restored', 'active'], t, async (v) => {
      if (v.stage === 'restaurar' && t.current === 'criar') {
        await t.set('criar', 'ok', 'Cadastro e banco criados no destino');
        await t.set('restaurar', 'rodando', v.step ?? 'Restaurando');
      }
    });
    if (t.current === 'criar') {
      await t.set('criar', 'ok', 'Cadastro e banco criados no destino');
      await t.set('restaurar', 'rodando');
    }
    const got = (restored.result.counts ?? {}) as Record<string, number>;
    const diff = countDiff(counts, got);
    if (diff.length && move)
      throw new Error(`Contagens não conferem no destino: ${diff.slice(0, 5).join(', ')}`);
    await t.set(
      'restaurar',
      'ok',
      diff.length
        ? `Restaurado (cópia com o restaurante funcionando: ${diff.length} tabela(s) mudaram no meio)`
        : `Restaurado e conferido: ${Object.keys(counts).length} tabelas`,
    );

    // ------------------------------------------------------------------ virar
    if (move) {
      await t.set('virar', 'rodando', 'Liberando o restaurante no destino');
      await step(ctx, job, `${m.code}: virar`);
      await retry(() => r.activate(remoteId!));
      const active = await waitRemote(ctx, r, remoteId, ['active'], t);
      await switchHere(active.url);
      await t.set('virar', 'ok', `Agora em ${active.url}`);
    } else {
      await t.set('virar', 'pulada', 'Cópia: o restaurante continua funcionando aqui');
    }

    // ------------------------------------------------------------------ encerrar
    await t.set('encerrar', 'rodando');
    await step(ctx, job, `${m.code}: encerrar`);
    const warnings: string[] = [];
    if (!move) {
      await t.detail('Deixando a cópia pronta (suspensa) no destino');
      await retry(() => r.activate(remoteId!));
      const v = await waitRemote(ctx, r, remoteId, ['active'], t);
      result.url = v.url;
      await ctx.pool.query(`UPDATE tenant_migrations SET remote_url = $2 WHERE id = $1`, [
        m.id,
        v.url,
      ]);
    }
    if (move && opts.dropAtOrigin) {
      try {
        if (ctx.backup) {
          await t.detail('Backup final do banco daqui');
          const bctx = ctx.backup();
          const target = { database: reg.db_name, tenantId: m.tenant_id, slug: m.tenant_slug };
          const b = await backupDatabase(
            { ...bctx, trigger: 'painel' },
            { ...target, url: dbUrl },
            backupKey(bctx.prefix, target, new Date(), true),
            { final: true, migration: m.code },
          );
          result.finalBackupKey = b.key;
        }
        await t.detail(`Apagando o banco ${reg.db_name} daqui`);
        await sleep(Math.min(ctx.settleMs ?? 15_000, 15_000));
        await dropDatabase(serverPool(ctx, reg.server), reg.db_name);
        await ctx.pool.query(`DELETE FROM tenant_databases WHERE tenant_id = $1`, [m.tenant_id]);
        result.droppedAtOrigin = reg.db_name;
      } catch (e) {
        warnings.push(`O banco daqui não foi apagado: ${(e as Error).message}`);
      }
    }
    if (warnings.length) result.warning = warnings.join('; ');
    await t.set(
      'encerrar',
      'ok',
      warnings[0] ??
        (move
          ? opts.dropAtOrigin
            ? 'Banco daqui apagado'
            : 'Banco daqui guardado (sem acesso); dá para apagar depois'
          : 'Cópia pronta no destino'),
    );
    await ctx.pool.query(
      `UPDATE tenant_migrations SET status = 'done', finished_at = now(), result = $2 WHERE id = $1`,
      [m.id, result],
    );
    await ctx.pool.query(
      `INSERT INTO platform_audit_log (action, entity, entity_id, tenant_id, data)
       VALUES ($1, 'tenant', $2::text, $2::uuid, $3)`,
      [move ? 'platform.tenant.migrated' : 'platform.tenant.copied', m.tenant_id, result],
    );
    await finishJob(ctx, job, result);
  } catch (e) {
    const msg = (e as Error).message;
    if (switched && msg === '__resumed__') {
      await ctx.pool.query(
        `UPDATE tenant_migrations SET status = 'done', finished_at = now(), result = $2 WHERE id = $1`,
        [m.id, result],
      );
      await finishJob(ctx, job, result);
      return;
    }
    if (switched) {
      // Já está no destino: o que falhou foi só a limpeza daqui.
      result.warning = msg;
      await t.set('encerrar', 'falhou', msg).catch(() => undefined);
      await ctx.pool
        .query(
          `UPDATE tenant_migrations SET status = 'done', finished_at = now(), result = $2 WHERE id = $1`,
          [m.id, result],
        )
        .catch(() => undefined);
      await finishJob(ctx, job, result);
      return;
    }
    if (t.current) await t.set(t.current, 'falhou', msg).catch(() => undefined);
    // Desfaz: o destino apaga o que criou e o restaurante volta a funcionar aqui.
    let undo = '';
    if (remoteId && remote) {
      const r = remote;
      try {
        await r.discard(remoteId);
        await waitRemote(ctx, r, remoteId, ['discarded'], t).catch(() => undefined);
      } catch (d) {
        undo = ` (o destino não desfez: ${(d as Error).message})`;
      }
    }
    if (maintenance) {
      await ctx.pool
        .query(`UPDATE tenants SET status = $2 WHERE id = $1 AND status = 'moving'`, [
          m.tenant_id,
          previous,
        ])
        .catch(() => undefined);
      await ctx.pool
        .query(
          `UPDATE tenant_databases SET status = 'ready', last_error = $2
            WHERE tenant_id = $1 AND status = 'transferring'`,
          [m.tenant_id, msg.slice(0, 1000)],
        )
        .catch(() => undefined);
    }
    for (const p of t.phases)
      if (p.status === 'ok' && p.name !== 'virar' && p.name !== 'encerrar') p.status = 'desfeita';
    await ctx.pool
      .query(
        `UPDATE tenant_migrations SET status = 'failed', finished_at = now(), error = $2, phases = $3
          WHERE id = $1`,
        [m.id, `${msg}${undo}`.slice(0, 1000), JSON.stringify(t.phases)],
      )
      .catch(() => undefined);
    throw e;
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ====================================================================== destino
interface ReceptionRow {
  id: string;
  tenant_id: string;
  tenant_slug: string;
  status: string;
  manifest: Manifest;
  result: Record<string, unknown>;
}

async function reception(ctx: DbJobContext, id: string): Promise<ReceptionRow> {
  const [r] = (
    await ctx.pool.query<ReceptionRow>(`SELECT * FROM tenant_receptions WHERE id = $1`, [id])
  ).rows;
  if (!r) throw new Error('Recebimento não encontrado');
  return r;
}

async function receptionStep(
  ctx: DbJobContext,
  job: DbJob,
  id: string,
  text: string,
  stage?: 'criar' | 'restaurar',
) {
  await step(ctx, job, text);
  await ctx.pool.query(
    `UPDATE tenant_receptions SET step = $2,
            result = CASE WHEN $3::text IS NULL THEN result ELSE result || jsonb_build_object('stage', $3::text) END
      WHERE id = $1`,
    [id, text, stage ?? null],
  );
}

/** Cria o banco vazio (a restauração traz as tabelas, as permissões e as políticas). */
async function createEmptyDatabase(ctx: DbJobContext, dbName: string, server: DbServer | null) {
  if (!TENANT_DB_NAME_RE.test(dbName)) throw new Error('nome de banco inválido');
  const pool = serverPool(ctx, server);
  await checkServer(pool);
  if (await databaseExists(pool, dbName))
    throw new Error(`Já existe um banco ${dbName} neste servidor. Nada foi mudado.`);
  await pool.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);
  await pool.query(`REVOKE ALL ON DATABASE "${dbName}" FROM PUBLIC`);
  for (const r of APP_ROLES) await pool.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${r}`);
}

/** Junta os blocos num arquivo e confere tamanho e sha256 do pacote. */
async function assemble(ctx: DbJobContext, r: ReceptionRow, file: string) {
  const m = r.manifest;
  const out = createWriteStream(file, { mode: 0o600 });
  try {
    for (let idx = 0; idx < m.chunks; idx++) {
      const { rows } = await ctx.pool.query<{ data: Buffer }>(
        `SELECT data FROM tenant_reception_chunks WHERE reception_id = $1 AND idx = $2`,
        [r.id, idx],
      );
      if (!rows[0]) throw new Error(`Falta o bloco ${idx} do pacote`);
      if (!out.write(rows[0].data)) await new Promise<void>((ok) => out.once('drain', () => ok()));
    }
  } finally {
    await new Promise<void>((ok, fail) => out.end((e?: Error | null) => (e ? fail(e) : ok())));
  }
  const { size } = await stat(file);
  if (size !== m.size) throw new Error(`Pacote com ${size} bytes (esperado ${m.size})`);
  if ((await sha256File(file)) !== m.sha256) throw new Error('sha256 do pacote não confere');
}

async function receiveInstall(ctx: DbJobContext, job: DbJob, r: ReceptionRow) {
  if (r.status === 'restored' || r.status === 'active') return { already: r.status };
  if (r.status !== 'installing') throw new Error(`Recebimento ${r.status}`);
  const m = r.manifest;
  const known = new Set(knownMigrations(ctx.migrationsDir));
  const missing = m.migrations.filter((v) => !known.has(v));
  if (missing.length)
    throw new Error(`Esta instalação é mais antiga que a de origem (falta ${missing[0]})`);
  const dbName = tenantDatabaseName(r.tenant_slug);
  const [def] = (
    await ctx.pool.query<{ id: string }>(
      `SELECT id FROM platform_db_servers WHERE accepts_new AND status = 'active' LIMIT 1`,
    )
  ).rows;
  const server = (await serverById(ctx, def?.id))?.server ?? null;
  const tmp = await mkdtemp(join(ctx.workDir ?? '/tmp', 'cm-rcv-'));
  let createdCentral = false;
  let createdDb = false;
  try {
    await receptionStep(ctx, job, r.id, 'Juntando e conferindo o pacote', 'criar');
    const file = join(tmp, 'pacote.dump');
    await assemble(ctx, r, file);

    await receptionStep(ctx, job, r.id, 'Criando o cadastro do restaurante', 'criar');
    await tx(ctx.pool, async (c) => {
      await importCentralRows(c, m.central, { slug: r.tenant_slug, status: 'moving' });
      await c.query(
        `INSERT INTO tenant_databases (tenant_id, db_name, status, server_id) VALUES ($1, $2, 'receiving', $3)`,
        [r.tenant_id, dbName, def?.id ?? null],
      );
      await c.query(
        `UPDATE tenant_receptions SET result = result || '{"created": true}'::jsonb WHERE id = $1`,
        [r.id],
      );
    });
    createdCentral = true;
    await receptionStep(
      ctx,
      job,
      r.id,
      `Criando o banco ${dbName}${server ? ` em ${server.host}` : ''}`,
      'criar',
    );
    await createEmptyDatabase(ctx, dbName, server);
    createdDb = true;

    const url = databaseUrl(ctx.ownerUrl, dbName, server);
    await receptionStep(ctx, job, r.id, 'Restaurando o banco', 'restaurar');
    await run(bin(ctx, 'pg_restore'), [
      '--exit-on-error',
      '--no-owner',
      `--dbname=${libpqUrl(url)}`,
      file,
    ]);
    await rm(file, { force: true });
    await receptionStep(ctx, job, r.id, 'Aplicando as migrações desta versão', 'restaurar');
    await migrate(url, ctx.migrationsDir, () => undefined);
    await receptionStep(ctx, job, r.id, 'Conferindo as contagens', 'restaurar');
    const counts = await withClient(url, async (c) => {
      await c.query(
        `UPDATE tenants SET slug = $2, status = 'moving', moved_to = NULL WHERE id = $1`,
        [r.tenant_id, r.tenant_slug],
      );
      return tableCounts(c);
    });
    const diff = countDiff(m.counts, counts);
    if (diff.length && m.mode === 'move')
      throw new Error(`Contagens não conferem: ${diff.slice(0, 5).join(', ')}`);
    await tx(ctx.pool, async (c) => {
      await c.query(`DELETE FROM tenant_reception_chunks WHERE reception_id = $1`, [r.id]);
      await c.query(
        `UPDATE tenant_receptions SET status = 'restored', step = 'Restaurado; esperando a virada',
                result = result || $2::jsonb WHERE id = $1`,
        [
          r.id,
          { stage: 'restaurar', counts, database: dbName, server: server?.host ?? 'principal' },
        ],
      );
    });
    return { database: dbName, tables: Object.keys(counts).length };
  } catch (e) {
    if (createdDb) await dropDatabase(serverPool(ctx, server), dbName).catch(() => undefined);
    if (createdCentral)
      await withClient(ctx.ownerUrl, (c) => purgeTenantRows(c, r.tenant_id, true)).catch(
        () => undefined,
      );
    await ctx.pool
      .query(
        `UPDATE tenant_receptions SET status = 'failed', error = $2, finished_at = now(),
                result = result || '{"created": false}'::jsonb
          WHERE id = $1`,
        [r.id, (e as Error).message.slice(0, 1000)],
      )
      .catch(() => undefined);
    throw e;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function receiveActivate(ctx: DbJobContext, job: DbJob, r: ReceptionRow) {
  if (r.status === 'active') return { already: 'active' };
  if (r.status !== 'restored') throw new Error('O restaurante ainda não foi restaurado aqui');
  const m = r.manifest;
  const final = m.keepSuspended
    ? 'suspended'
    : m.previousStatus === 'suspended'
      ? 'suspended'
      : 'provisioned';
  await receptionStep(ctx, job, r.id, 'Liberando o restaurante');
  const reg = await registry(ctx, r.tenant_id);
  if (!reg) throw new Error('Registro do banco não encontrado');
  await withClient(databaseUrl(ctx.ownerUrl, reg.db_name, reg.server), (c) =>
    c.query(`UPDATE tenants SET status = $2 WHERE id = $1`, [r.tenant_id, final]),
  );
  await tx(ctx.pool, async (c) => {
    await c.query(
      `UPDATE tenant_databases SET status = 'ready', ready_at = now(), last_error = NULL WHERE tenant_id = $1`,
      [r.tenant_id],
    );
    await c.query(`UPDATE tenants SET status = $2 WHERE id = $1`, [r.tenant_id, final]);
    await c.query(
      `UPDATE tenant_receptions SET status = 'active', step = $2, finished_at = now() WHERE id = $1`,
      [r.id, final === 'suspended' ? 'Instalado (suspenso)' : 'Em uso aqui'],
    );
    await c.query(
      `INSERT INTO platform_audit_log (action, entity, entity_id, tenant_id, data)
       VALUES ('platform.tenant.received', 'tenant', $1::text, $1::uuid, $2)`,
      [r.tenant_id, { code: m.code, from: m.source.url, slug: r.tenant_slug, status: final }],
    );
  });
  return { status: final };
}

async function receiveDiscard(ctx: DbJobContext, job: DbJob, r: ReceptionRow) {
  if (r.status === 'discarded') return { already: 'discarded' };
  if (r.status === 'active') throw new Error('O restaurante já está em uso aqui');
  await receptionStep(ctx, job, r.id, 'Desfazendo a instalação');
  const reg = await registry(ctx, r.tenant_id);
  if (reg && reg.status === 'receiving') {
    await dropDatabase(serverPool(ctx, reg.server), reg.db_name);
    await withClient(ctx.ownerUrl, (c) => purgeTenantRows(c, r.tenant_id, true));
  }
  await tx(ctx.pool, async (c) => {
    await c.query(`DELETE FROM tenant_reception_chunks WHERE reception_id = $1`, [r.id]);
    await c.query(
      `UPDATE tenant_receptions SET status = 'discarded', step = 'Desfeito', finished_at = now()
        WHERE id = $1`,
      [r.id],
    );
  });
  return { discarded: true };
}

export async function runReceive(ctx: DbJobContext, job: DbJob) {
  const p = job.payload as { receptionId?: string; action?: string };
  const r = await reception(ctx, String(p.receptionId ?? ''));
  const out =
    p.action === 'install'
      ? await receiveInstall(ctx, job, r)
      : p.action === 'activate'
        ? await receiveActivate(ctx, job, r)
        : p.action === 'discard'
          ? await receiveDiscard(ctx, job, r)
          : null;
  if (!out) throw new Error(`Ação desconhecida: ${p.action}`);
  await finishJob(ctx, job, { reception: r.id, action: p.action, ...out });
}
