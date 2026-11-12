import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { notify } from './platform-databases.service';
import { PlatformDb, platformAudit } from './platform-db.service';
import type { Actor } from './platform.service';
import { ServerAgentClient } from './server-agent.service';

export interface PinnedVersionInfo {
  version: string;
  services: { name: string; role: 'api' | 'web'; running: number }[];
  ready: boolean;
}

export interface TenantVersionInfo {
  /** Versão em que o restaurante roda (a principal quando ainda não foi separado). */
  version: string | null;
  /** Versão do sistema principal (a do Super Admin). */
  main: string | null;
  /** Dá para atualizar separado (banco próprio pronto, versão principal conhecida). */
  separable: boolean;
  reason: string | null;
  scheduled: { to: string; at: string } | null;
  /** Último trabalho de atualização do restaurante. */
  lastUpgrade: {
    status: string;
    step: string | null;
    error: string | null;
    createdAt: string;
    finishedAt: string | null;
  } | null;
}

const cmp = (a: string, b: string) => {
  const x = a.slice(1).split('.').map(Number);
  const y = b.slice(1).split('.').map(Number);
  return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
};

/**
 * Versão por restaurante (docs/versao-por-cliente.md). O Super Admin e o sistema principal ficam
 * sempre na versão mais nova; cada restaurante com banco próprio fica na versão dele até ser
 * atualizado aqui (na hora ou agendado). Quem migra o banco do restaurante é o serviço de backup
 * (trabalho "upgrade"); quem mantém as versões antigas no ar é o agente do servidor.
 */
@Injectable()
export class PlatformVersionsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('TenantVersions');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: PlatformDb,
    private readonly agent: ServerAgentClient,
  ) {}

  get main(): string | null {
    return this.env.COMANDOU_VERSION ?? null;
  }

  onApplicationBootstrap() {
    const s = this.env.TENANT_UPDATE_INTERVAL_SECONDS;
    if (!s || !this.db.pool) return;
    this.timer = setInterval(() => void this.tick(), s * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Versões antigas no ar (pelo agente). Sem agente: lista vazia. */
  async pinned(): Promise<PinnedVersionInfo[]> {
    if (!this.agent.enabled) return [];
    const r = await this.agent.call<{ versions: PinnedVersionInfo[] }>('GET', '/v1/versions');
    return r.versions;
  }

  /** Restaurantes por versão, para a tela de atualização do sistema. */
  async overview() {
    const rows = await this.db.query<{
      version: string | null;
      tenants: number;
      scheduled: number;
    }>(
      `SELECT t.app_version AS version, count(*)::int AS tenants,
              count(*) FILTER (WHERE t.app_update_at IS NOT NULL)::int AS scheduled
         FROM tenants t WHERE t.status IN ('provisioned', 'suspended')
        GROUP BY t.app_version`,
    );
    const pinned = await this.pinned().catch(() => []);
    const main = this.main;
    const byVersion = new Map<string, { tenants: number; scheduled: number }>();
    for (const r of rows) {
      const v = r.version ?? main ?? 'principal';
      const cur = byVersion.get(v) ?? { tenants: 0, scheduled: 0 };
      cur.tenants += r.tenants;
      cur.scheduled += r.scheduled;
      byVersion.set(v, cur);
    }
    return {
      main,
      enabled: !!main && this.agent.enabled,
      versions: [...byVersion]
        .map(([version, c]) => ({
          version,
          ...c,
          main: version === main,
          running:
            version === main ? true : (pinned.find((p) => p.version === version)?.ready ?? false),
        }))
        .sort((a, b) =>
          /^v\d/.test(a.version) && /^v\d/.test(b.version) ? cmp(b.version, a.version) : 0,
        ),
    };
  }

  async info(tenantId: string): Promise<TenantVersionInfo> {
    const [t] = await this.db.query<{
      app_version: string | null;
      app_update_to: string | null;
      app_update_at: Date | null;
      db_status: string | null;
    }>(
      `SELECT t.app_version, t.app_update_to, t.app_update_at, d.status AS db_status
         FROM tenants t LEFT JOIN tenant_databases d ON d.tenant_id = t.id WHERE t.id = $1`,
      [tenantId],
    );
    if (!t) throw new NotFoundException('Restaurante não encontrado');
    const [job] = await this.db.query<NonNullable<TenantVersionInfo['lastUpgrade']>>(
      `SELECT status, step, error, created_at AS "createdAt", finished_at AS "finishedAt"
         FROM tenant_db_jobs WHERE tenant_id = $1 AND kind = 'upgrade'
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    const reason = !this.main
      ? 'A versão do sistema principal não é conhecida (instalação sem a versão na imagem).'
      : !this.agent.enabled
        ? 'Instale o agente do servidor para manter versões antigas no ar.'
        : t.db_status !== 'ready'
          ? 'Restaurante no banco central: acompanha sempre o sistema principal.'
          : null;
    return {
      version: t.app_version ?? this.main,
      main: this.main,
      separable: !reason,
      reason,
      scheduled:
        t.app_update_to && t.app_update_at
          ? { to: t.app_update_to, at: t.app_update_at.toISOString() }
          : null,
      lastUpgrade: job ?? null,
    };
  }

  private requireMain(): string {
    if (!this.main)
      throw new UnprocessableEntityException(
        'A versão do sistema principal não é conhecida; atualize o sistema primeiro.',
      );
    return this.main;
  }

  /** Atualiza o restaurante agora para a versão principal (o serviço de backup migra o banco). */
  async upgrade(tenantId: string, a: Actor) {
    const main = this.requireMain();
    await this.db.tx(async (c) => {
      const t = (
        await c.query<{
          slug: string;
          name: string;
          app_version: string | null;
          db: string | null;
        }>(
          `SELECT t.slug, t.name, t.app_version, d.status AS db FROM tenants t
             LEFT JOIN tenant_databases d ON d.tenant_id = t.id WHERE t.id = $1 FOR UPDATE OF t`,
          [tenantId],
        )
      ).rows[0];
      if (!t) throw new NotFoundException('Restaurante não encontrado');
      if (t.db !== 'ready')
        throw new ConflictException(
          'Só restaurantes com banco próprio pronto são atualizados separados',
        );
      if (!t.app_version || t.app_version === main)
        throw new ConflictException(`O restaurante já está na ${main}`);
      if (cmp(t.app_version, main) > 0)
        throw new ConflictException('O restaurante está numa versão mais nova que a principal');
      const busy = await c.query(
        `SELECT 1 FROM tenant_db_jobs WHERE tenant_id = $1 AND status IN ('queued','running')`,
        [tenantId],
      );
      if (busy.rowCount)
        throw new ConflictException('Já há um trabalho em andamento neste restaurante');
      await c.query(
        `INSERT INTO tenant_db_jobs (tenant_id, tenant_slug, tenant_name, kind, payload, requested_by)
         VALUES ($1, $2, $3, 'upgrade', $4, $5)`,
        [tenantId, t.slug, t.name, { version: main }, a.admin.id],
      );
      await c.query(`UPDATE tenants SET app_update_to = NULL, app_update_at = NULL WHERE id = $1`, [
        tenantId,
      ]);
      await platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.tenant_version.upgrade',
        entity: 'tenant',
        entityId: tenantId,
        tenantId,
        data: { from: t.app_version, to: main },
        ip: a.ip,
      });
      await notify(c);
    });
    return this.info(tenantId);
  }

  /** Agenda (ou cancela, com at = null) a atualização do restaurante para a versão principal. */
  async schedule(tenantId: string, at: string | null, a: Actor) {
    const main = this.requireMain();
    if (at && new Date(at).getTime() < Date.now() - 60_000)
      throw new UnprocessableEntityException('Escolha uma data e hora no futuro');
    await this.db.tx(async (c) => {
      const r = await c.query<{ app_version: string | null }>(
        `SELECT app_version FROM tenants WHERE id = $1 FOR UPDATE`,
        [tenantId],
      );
      if (!r.rows[0]) throw new NotFoundException('Restaurante não encontrado');
      if (at && (!r.rows[0].app_version || r.rows[0].app_version === main))
        throw new ConflictException(`O restaurante já está na ${main}`);
      await c.query(`UPDATE tenants SET app_update_to = $2, app_update_at = $3 WHERE id = $1`, [
        tenantId,
        at ? main : null,
        at,
      ]);
      await platformAudit(c, {
        adminId: a.admin.id,
        action: at ? 'platform.tenant_version.scheduled' : 'platform.tenant_version.unscheduled',
        entity: 'tenant',
        entityId: tenantId,
        tenantId,
        data: at ? { to: main, at } : {},
        ip: a.ip,
      });
    });
    return this.info(tenantId);
  }

  /**
   * Antes de o sistema principal mudar de versão: os restaurantes que estavam acompanhando o
   * principal ficam presos à versão atual, e a cópia dessa versão sobe (e precisa estar rodando)
   * antes de a atualização começar. Se a cópia não subir, desfaz e não atualiza.
   */
  async holdBeforeSystemUpdate(target: string, a: Actor) {
    const main = this.main;
    if (!main || !this.agent.enabled || main === target) return { held: 0 };
    const held = await this.db.tx(async (c) => {
      const r = await c.query<{ id: string }>(
        `UPDATE tenants t SET app_version = $1
           FROM tenant_databases d
          WHERE d.tenant_id = t.id AND d.status = 'ready' AND t.app_version IS NULL
          RETURNING t.id`,
        [main],
      );
      return r.rows.map((x) => x.id);
    });
    const [{ n }] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tenants WHERE app_version = $1`,
      [main],
    );
    if (n > 0) {
      try {
        await this.agent.call('POST', `/v1/versions/${main}`, undefined, 330_000);
      } catch (e) {
        if (held.length)
          await this.db.query(
            `UPDATE tenants SET app_version = NULL WHERE id = ANY($1::uuid[]) AND app_version = $2`,
            [held, main],
          );
        throw new UnprocessableEntityException(
          `Não consegui manter a ${main} no ar para os restaurantes que ficam nela: ${(e as Error).message}`,
        );
      }
    }
    await this.db.tx((c) =>
      platformAudit(c, {
        adminId: a.admin.id,
        action: 'platform.tenant_version.held',
        entity: 'server',
        data: { version: main, newTenants: held.length, tenants: n, target },
        ip: a.ip,
      }),
    );
    return { held: n };
  }

  /** A cada minuto: atualizações agendadas que venceram e versões antigas sem ninguém. */
  async tick() {
    if (this.running || !this.db.pool) return;
    this.running = true;
    try {
      await this.runDue();
      await this.prune();
    } catch (e) {
      this.logger.warn(`versões por restaurante: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async runDue() {
    const main = this.main;
    if (!main) return;
    for (;;) {
      const done = await this.db.tx(async (c) => {
        const t = (
          await c.query<{ id: string; slug: string; name: string; app_version: string | null }>(
            `SELECT t.id, t.slug, t.name, t.app_version FROM tenants t
               JOIN tenant_databases d ON d.tenant_id = t.id AND d.status = 'ready'
              WHERE t.app_update_at <= now()
                AND NOT EXISTS (SELECT 1 FROM tenant_db_jobs j WHERE j.tenant_id = t.id
                                 AND j.status IN ('queued','running'))
              ORDER BY t.app_update_at LIMIT 1 FOR UPDATE OF t SKIP LOCKED`,
          )
        ).rows[0];
        if (!t) return true;
        await c.query(
          `UPDATE tenants SET app_update_to = NULL, app_update_at = NULL WHERE id = $1`,
          [t.id],
        );
        if (t.app_version && t.app_version !== main && cmp(t.app_version, main) < 0) {
          // Sempre para a versão principal de agora (a mais nova), mesmo se saiu outra depois.
          await c.query(
            `INSERT INTO tenant_db_jobs (tenant_id, tenant_slug, tenant_name, kind, payload)
             VALUES ($1, $2, $3, 'upgrade', $4)`,
            [t.id, t.slug, t.name, { version: main, scheduled: true }],
          );
          await platformAudit(c, {
            action: 'platform.tenant_version.upgrade',
            entity: 'tenant',
            entityId: t.id,
            tenantId: t.id,
            data: { from: t.app_version, to: main, scheduled: true },
          });
          await notify(c);
        }
        return false;
      });
      if (done) return;
    }
  }

  /** Tira do ar as versões antigas que nenhum restaurante usa mais. */
  async prune() {
    const main = this.main;
    if (!main || !this.agent.enabled) return;
    const pinned = await this.pinned();
    if (!pinned.length) return;
    const used = new Set(
      (
        await this.db.query<{ v: string }>(
          `SELECT DISTINCT app_version AS v FROM tenants WHERE app_version IS NOT NULL`,
        )
      ).map((r) => r.v),
    );
    for (const p of pinned) {
      // Uma cópia na mesma versão do principal fica: é ela que segura esses restaurantes
      // quando o principal mudar de versão (holdBeforeSystemUpdate cria antes de atualizar).
      if (used.has(p.version)) continue;
      await this.agent.call('DELETE', `/v1/versions/${p.version}`, undefined, 60_000);
      this.logger.log(`versão ${p.version} saiu do ar (nenhum restaurante usa mais)`);
    }
  }
}
