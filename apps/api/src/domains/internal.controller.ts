import { Controller, Get, Inject, NotFoundException, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { bearerOrQueryMatches } from '../common/bearer';
import { Public, SkipTenant } from '../common/decorators';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';

/** Monta a configuração dinâmica do Traefik (provider HTTP) para os domínios verificados. */
export function traefikConfig(hostnames: string[], env: Env, tenantSlugs: string[] = []) {
  const routers: Record<string, unknown> = {};
  const customTls = { certResolver: env.TRAEFIK_CUSTOM_CERT_RESOLVER };
  const tenantTls = {
    certResolver: env.TRAEFIK_TENANT_CERT_RESOLVER ?? env.TRAEFIK_CUSTOM_CERT_RESOLVER,
  };
  // Subdomínios da plataforma (opcional): admin + um por restaurante, sem repetir domínios próprios.
  const platformHosts = env.TRAEFIK_TENANT_HOSTS
    ? ['admin', ...tenantSlugs].map((s) => `${s}.${env.COMANDOU_BASE_DOMAIN}`)
    : [];
  const all = [
    ...hostnames.map((h) => ({ h, tls: customTls })),
    ...platformHosts.filter((h) => !hostnames.includes(h)).map((h) => ({ h, tls: tenantTls })),
  ];
  for (const { h, tls } of all) {
    const id = `cm-domain-${createHash('sha256').update(h).digest('hex').slice(0, 12)}`;
    routers[`${id}-api`] = {
      rule: `Host(\`${h}\`) && PathPrefix(\`/api\`)`,
      service: env.TRAEFIK_API_SERVICE,
      entryPoints: [env.TRAEFIK_ENTRYPOINT],
      priority: 100,
      tls,
    };
    routers[`${id}-web`] = {
      rule: `Host(\`${h}\`)`,
      service: env.TRAEFIK_WEB_SERVICE,
      entryPoints: [env.TRAEFIK_ENTRYPOINT],
      priority: 10,
      tls,
    };
  }
  return { http: { routers } };
}

/**
 * Rotas internas da infraestrutura (fora do restaurante e sem sessão), protegidas por token.
 * Sem o token configurado, não existem (404).
 */
@Controller({ path: 'internal', version: '1' })
@SkipTenant()
@Public()
@SkipThrottle()
export class InternalController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
  ) {}

  /** Provider HTTP do Traefik: um roteador por domínio personalizado verificado (e, se ligado, por restaurante). */
  @Get('traefik')
  async traefik(@Req() req: Request) {
    if (!bearerOrQueryMatches(req, this.env.TRAEFIK_PROVIDER_TOKEN)) throw new NotFoundException();
    const rows = await this.db.queryUnscoped<{ hostname: string }>(
      'SELECT hostname FROM app_verified_domains()',
      [],
    );
    const slugs = this.env.TRAEFIK_TENANT_HOSTS
      ? await this.db.queryUnscoped<{ slug: string }>('SELECT slug FROM app_tenant_slugs()', [])
      : [];
    return traefikConfig(
      rows.map((r) => r.hostname),
      this.env,
      slugs.map((r) => r.slug),
    );
  }
}
