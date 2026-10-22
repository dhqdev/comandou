import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ctxOf } from '../common/context';
import { CurrentTenant, CurrentUser, RequirePermission } from '../common/decorators';
import { one, q } from '../common/sql';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { PlanService } from '../plans/plan.service';
import type { AuthenticatedUser, ResolvedTenant } from '../tenancy/tenant.types';

/** Domínios vivos (não removidos) por restaurante. */
export const MAX_DOMAINS = 3;
export const TXT_PREFIX = '_pedemais';

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Normaliza e valida um domínio informado pelo restaurante. Recusa IP, subdomínios da própria
 * plataforma e nomes sem TLD. Devolve null se inválido.
 */
export function normalizeHostname(raw: string, baseDomain: string): string | null {
  const h = raw.trim().toLowerCase().replace(/\.$/, '');
  if (h.length < 4 || h.length > 253) return null;
  const labels = h.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1])) return null; // TLD com letras (não IP)
  const base = baseDomain.toLowerCase();
  if (h === base || h.endsWith(`.${base}`)) return null;
  return h;
}

/** Consulta DNS isolada para os testes poderem substituir (app.get(DomainVerifier).resolveTxt). */
@Injectable()
export class DomainVerifier {
  resolveTxt: (name: string) => Promise<string[][]> = (name) => dns.resolveTxt(name);

  async check(hostname: string, token: string): Promise<{ ok: boolean; error?: string }> {
    const name = `${TXT_PREFIX}.${hostname}`;
    try {
      const records = (await this.resolveTxt(name)).map((chunks) => chunks.join(''));
      if (records.includes(`pedemais-verify=${token}`)) return { ok: true };
      return { ok: false, error: `O registro TXT em ${name} não tem o valor esperado` };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'ENOTFOUND' || code === 'ENODATA')
        return { ok: false, error: `Nenhum registro TXT encontrado em ${name}` };
      return { ok: false, error: `Falha ao consultar o DNS (${code ?? 'erro'}); tente de novo` };
    }
  }
}

const AddDomain = z.object({ hostname: z.string().max(253) });

interface DomainRow {
  id: string;
  hostname: string;
  verification_token: string | null;
  verified_at: Date | null;
  last_checked_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

const COLS = `id, hostname::text AS hostname, verification_token, verified_at, last_checked_at, last_error, created_at`;

/**
 * Domínio próprio do restaurante (ex.: pedidos.meurestaurante.com.br).
 * Prova de posse por registro DNS TXT; só depois o domínio passa a abrir o restaurante.
 * O roteador (Traefik) recebe a lista de domínios verificados em /api/v1/internal/traefik.
 */
@Controller({ path: 'domains', version: '1' })
export class DomainsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly plans: PlanService,
    private readonly verifier: DomainVerifier,
  ) {}

  private view(t: ResolvedTenant, d: DomainRow) {
    return {
      id: d.id,
      hostname: d.hostname,
      verified: !!d.verified_at,
      verifiedAt: d.verified_at,
      lastCheckedAt: d.last_checked_at,
      lastError: d.last_error,
      createdAt: d.created_at,
      dns: {
        txtName: `${TXT_PREFIX}.${d.hostname}`,
        txtValue: `pedemais-verify=${d.verification_token}`,
        cnameTarget: `${t.slug}.${this.env.PEDEMAIS_BASE_DOMAIN}`,
      },
    };
  }

  @Get()
  @RequirePermission('domains:manage')
  list(@CurrentTenant() t: ResolvedTenant, @CurrentUser() u: AuthenticatedUser) {
    return this.db.withTenant(ctxOf(t, u), async (tx) =>
      (
        await q<DomainRow>(
          tx,
          `SELECT ${COLS} FROM tenant_domains WHERE removed_at IS NULL ORDER BY created_at`,
        )
      ).map((d) => this.view(t, d)),
    );
  }

  @Post()
  @RequirePermission('domains:manage')
  add(
    @Body(new ZodPipe(AddDomain)) b: z.infer<typeof AddDomain>,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const hostname = normalizeHostname(b.hostname, this.env.PEDEMAIS_BASE_DOMAIN);
    if (!hostname)
      throw new UnprocessableEntityException(
        'Domínio inválido: use um endereço como pedidos.seurestaurante.com.br',
      );
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      await this.plans.assertFeature(tx, 'custom_domain');
      // Duas inclusões simultâneas do mesmo restaurante não passam do limite.
      await q(tx, `SELECT pg_advisory_xact_lock(hashtext('domains:' || $1))`, [t.id]);
      const live = await q<{ hostname: string }>(
        tx,
        `SELECT hostname::text AS hostname FROM tenant_domains WHERE removed_at IS NULL`,
      );
      if (live.some((d) => d.hostname === hostname))
        throw new ConflictException('Este domínio já está cadastrado');
      if (live.length >= MAX_DOMAINS)
        throw new ConflictException(`No máximo ${MAX_DOMAINS} domínios por restaurante`);
      const row = await one<DomainRow>(
        tx,
        `INSERT INTO tenant_domains (tenant_id, hostname, verification_token, created_by)
         VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
        [t.id, hostname, randomBytes(24).toString('base64url'), u.id],
      );
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'domain.added',
        entity: 'tenant_domain',
        entityId: row!.id,
        data: { hostname },
        ip: req.ip,
      });
      return this.view(t, row!);
    });
  }

  @Post(':id/verify')
  @RequirePermission('domains:manage')
  async verify(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const ctx = ctxOf(t, u);
    const d = await this.db.withTenant(ctx, async (tx) => {
      await this.plans.assertFeature(tx, 'custom_domain');
      return one<DomainRow>(
        tx,
        `SELECT ${COLS} FROM tenant_domains WHERE id = $1 AND removed_at IS NULL`,
        [id],
      );
    });
    if (!d) throw new NotFoundException('Domínio não encontrado');
    if (d.verified_at) return this.view(t, d);
    // Consulta DNS fora da transação (pode demorar alguns segundos).
    const r = await this.verifier.check(d.hostname, d.verification_token ?? '');
    return this.db.withTenant(ctx, async (tx) => {
      let row: DomainRow | undefined;
      try {
        row = await one<DomainRow>(
          tx,
          `UPDATE tenant_domains
              SET last_checked_at = now(), last_error = $2,
                  verified_at = CASE WHEN $3::boolean THEN now() ELSE verified_at END
            WHERE id = $1 AND removed_at IS NULL RETURNING ${COLS}`,
          [id, r.ok ? null : (r.error ?? 'não verificado').slice(0, 300), r.ok],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new ConflictException('Este domínio já está verificado por outro restaurante');
        throw e;
      }
      if (!row) throw new NotFoundException('Domínio não encontrado');
      if (r.ok) {
        await this.audit.record(tx, {
          tenantId: t.id,
          actorUserId: u.id,
          action: 'domain.verified',
          entity: 'tenant_domain',
          entityId: id,
          data: { hostname: row.hostname },
          ip: req.ip,
        });
      }
      return this.view(t, row);
    });
  }

  @Post(':id/remove')
  @RequirePermission('domains:manage')
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() t: ResolvedTenant,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.db.withTenant(ctxOf(t, u), async (tx) => {
      const row = await one<{ hostname: string; verified_at: Date | null }>(
        tx,
        `UPDATE tenant_domains SET removed_at = now() WHERE id = $1 AND removed_at IS NULL
         RETURNING hostname::text AS hostname, verified_at`,
        [id],
      );
      if (!row) throw new NotFoundException('Domínio não encontrado');
      await this.audit.record(tx, {
        tenantId: t.id,
        actorUserId: u.id,
        action: 'domain.removed',
        entity: 'tenant_domain',
        entityId: id,
        data: { hostname: row.hostname, wasVerified: !!row.verified_at },
        ip: req.ip,
      });
      return { removed: true };
    });
  }
}
