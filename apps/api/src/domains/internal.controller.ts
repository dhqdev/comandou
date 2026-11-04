import { Controller, Get, Inject, NotFoundException, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { bearerOrQueryMatches } from '../common/bearer';
import { Public, SkipTenant } from '../common/decorators';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';

/** Nome do middleware do CrowdSec no provider HTTP (referência: comandou-crowdsec@http). */
export const CROWDSEC_MIDDLEWARE = 'comandou-crowdsec';

/**
 * Caminhos que o CrowdSec nunca bloqueia: chegam por roteadores de prioridade maior, sem o
 * middleware. Webhook do Asaas (pagamentos), teste de status do Super Admin e health checks
 * (/api/v1/health/...) e as métricas do Prometheus. Todos já exigem token ou não expõem dados.
 */
export const CROWDSEC_OPEN_PATHS =
  'PathPrefix(`/api/v1/health/`) || Path(`/api/v1/platform/billing/asaas/webhook`) || Path(`/api/v1/metrics`)';

/** Redes que nunca são bloqueadas: o próprio servidor, a rede do Docker e a rede local. */
const PRIVATE_NETS = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128'];

/** Middleware do plugin do CrowdSec (github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin). */
export function crowdsecMiddleware(env: Env) {
  return {
    plugin: {
      [env.CROWDSEC_PLUGIN_NAME]: {
        enabled: true,
        logLevel: 'INFO',
        // stream: o Traefik baixa a lista de IPs bloqueados a cada minuto e decide na memória,
        // sem perguntar ao CrowdSec a cada requisição.
        crowdsecMode: 'stream',
        updateIntervalSeconds: 60,
        // Se o CrowdSec cair, o site continua no ar (sem bloqueio) em vez de recusar todo mundo,
        // e o Traefik não espera o CrowdSec para começar a atender.
        updateMaxFailure: -1,
        streamStartupBlock: false,
        crowdsecLapiScheme: 'http',
        crowdsecLapiHost: env.CROWDSEC_LAPI_HOST,
        crowdsecLapiKey: env.CROWDSEC_BOUNCER_KEY,
        clientTrustedIPs: [...PRIVATE_NETS, ...env.CROWDSEC_TRUSTED_IPS],
      },
    },
  };
}

export function crowdsecEnabled(env: Env): boolean {
  return env.CROWDSEC_BOUNCER && Boolean(env.CROWDSEC_BOUNCER_KEY);
}

/**
 * Reserva para o Traefik sem o plugin do CrowdSec (ex.: o Portainer recriou o Traefik sem os
 * argumentos do plugin): roteadores iguais, sem o middleware, logo abaixo dos protegidos. Com o
 * plugin, o roteador protegido (prioridade maior, mesma regra) sempre ganha; sem o plugin, o
 * Traefik descarta o protegido (middleware inválido) e estes atendem. Pior caso: fica sem
 * bloqueio, nunca fora do ar.
 */
function fallbackRouters(id: string, host: string, env: Env, tls: unknown) {
  return {
    [`${id}-api-fallback`]: {
      rule: `${host} && PathPrefix(\`/api\`)`,
      service: env.TRAEFIK_API_SERVICE,
      entryPoints: [env.TRAEFIK_ENTRYPOINT],
      priority: 99,
      tls,
    },
    [`${id}-web-fallback`]: {
      rule: host,
      service: env.TRAEFIK_WEB_SERVICE,
      entryPoints: [env.TRAEFIK_ENTRYPOINT],
      priority: 9,
      tls,
    },
  };
}

/** Monta a configuração dinâmica do Traefik (provider HTTP) para os domínios verificados. */
export function traefikConfig(hostnames: string[], env: Env, tenantSlugs: string[] = []) {
  const routers: Record<string, unknown> = {};
  const crowdsec = crowdsecEnabled(env);
  const guarded = crowdsec ? { middlewares: [CROWDSEC_MIDDLEWARE] } : {};
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
    if (crowdsec)
      routers[`${id}-open`] = {
        rule: `Host(\`${h}\`) && (${CROWDSEC_OPEN_PATHS})`,
        service: env.TRAEFIK_API_SERVICE,
        entryPoints: [env.TRAEFIK_ENTRYPOINT],
        priority: 200,
        tls,
      };
    routers[`${id}-api`] = {
      rule: `Host(\`${h}\`) && PathPrefix(\`/api\`)`,
      service: env.TRAEFIK_API_SERVICE,
      entryPoints: [env.TRAEFIK_ENTRYPOINT],
      priority: 100,
      ...guarded,
      tls,
    };
    routers[`${id}-web`] = {
      rule: `Host(\`${h}\`)`,
      service: env.TRAEFIK_WEB_SERVICE,
      entryPoints: [env.TRAEFIK_ENTRYPOINT],
      priority: 10,
      ...guarded,
      tls,
    };
    if (crowdsec) Object.assign(routers, fallbackRouters(id, `Host(\`${h}\`)`, env, tls));
  }
  // Certificado coringa (wildcard.yml): os roteadores dos restaurantes vêm dos labels da stack
  // (com o middleware pelo overlay wildcard-crowdsec.yml); aqui só a porta livre para eles.
  if (crowdsec && !env.TRAEFIK_TENANT_HOSTS) {
    const base = env.COMANDOU_BASE_DOMAIN.replace(/\./g, '\\.');
    routers['cm-wildcard-open'] = {
      rule: `HostRegexp(\`^[a-z0-9-]+\\.${base}$\`) && (${CROWDSEC_OPEN_PATHS})`,
      service: env.TRAEFIK_API_SERVICE,
      entryPoints: [env.TRAEFIK_ENTRYPOINT],
      priority: 200,
      tls: tenantTls,
    };
    Object.assign(
      routers,
      fallbackRouters('cm-wildcard', `HostRegexp(\`^[a-z0-9-]+\\.${base}$\`)`, env, tenantTls),
    );
  }
  return crowdsec
    ? { http: { routers, middlewares: { [CROWDSEC_MIDDLEWARE]: crowdsecMiddleware(env) } } }
    : { http: { routers } };
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
