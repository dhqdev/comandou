import { Controller, Get, Inject, NotFoundException, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { bearerOrQueryMatches } from '../common/bearer';
import { Public, SkipTenant } from '../common/decorators';
import { ENV, Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { ServerAgentClient } from '../platform/server-agent.service';

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
function fallbackRouters(id: string, host: string, env: Env, tls: unknown, boost = 0) {
  return {
    [`${id}-api-fallback`]: {
      rule: `${host} && PathPrefix(\`/api\`)`,
      service: env.TRAEFIK_API_SERVICE,
      entryPoints: [env.TRAEFIK_ENTRYPOINT],
      priority: 99 + boost,
      tls,
    },
    [`${id}-web-fallback`]: {
      rule: host,
      service: env.TRAEFIK_WEB_SERVICE,
      entryPoints: [env.TRAEFIK_ENTRYPOINT],
      priority: 9 + boost,
      tls,
    },
  };
}

/**
 * Serviço do Traefik da cópia de uma versão antiga (host-agent/versions.ts):
 * comandou-api@swarm + v0.108.5 -> comandou-api-v0-108-5@swarm.
 */
export function pinnedService(service: string, version: string) {
  const at = service.indexOf('@');
  const slug = version.replace(/\./g, '-');
  return at < 0 ? `${service}-${slug}` : `${service.slice(0, at)}-${slug}${service.slice(at)}`;
}

/**
 * Monta a configuração dinâmica do Traefik (provider HTTP) para os domínios verificados.
 * `pinned`: endereço -> versão antiga em que o restaurante ficou (só versões com a cópia no ar);
 * esses endereços vão para os serviços daquela versão, com prioridade acima de tudo.
 */
export function traefikConfig(
  hostnames: string[],
  env: Env,
  tenantSlugs: string[] = [],
  pinned: Map<string, string> = new Map(),
) {
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
  // Certificado coringa: os subdomínios dos restaurantes não estão na lista (vêm dos labels),
  // mas os que ficaram numa versão antiga precisam de roteador próprio para ir à cópia.
  for (const h of pinned.keys()) if (!all.some((x) => x.h === h)) all.push({ h, tls: tenantTls });
  for (const { h, tls } of all) {
    const id = `cm-domain-${createHash('sha256').update(h).digest('hex').slice(0, 12)}`;
    const v = pinned.get(h);
    const api = v ? pinnedService(env.TRAEFIK_API_SERVICE, v) : env.TRAEFIK_API_SERVICE;
    const web = v ? pinnedService(env.TRAEFIK_WEB_SERVICE, v) : env.TRAEFIK_WEB_SERVICE;
    // Acima dos roteadores dos labels (certificado coringa), que ganham pelo tamanho da regra.
    const boost = v ? 1000 : 0;
    if (crowdsec)
      routers[`${id}-open`] = {
        rule: `Host(\`${h}\`) && (${CROWDSEC_OPEN_PATHS})`,
        service: api,
        entryPoints: [env.TRAEFIK_ENTRYPOINT],
        priority: 200 + boost,
        tls,
      };
    routers[`${id}-api`] = {
      rule: `Host(\`${h}\`) && PathPrefix(\`/api\`)`,
      service: api,
      entryPoints: [env.TRAEFIK_ENTRYPOINT],
      priority: 100 + boost,
      ...guarded,
      tls,
    };
    routers[`${id}-web`] = {
      rule: `Host(\`${h}\`)`,
      service: web,
      entryPoints: [env.TRAEFIK_ENTRYPOINT],
      priority: 10 + boost,
      ...guarded,
      tls,
    };
    if (crowdsec)
      Object.assign(
        routers,
        fallbackRouters(
          id,
          `Host(\`${h}\`)`,
          { ...env, TRAEFIK_API_SERVICE: api, TRAEFIK_WEB_SERVICE: web },
          tls,
          boost,
        ),
      );
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

  private agentClient?: ServerAgentClient;
  private get agent() {
    return (this.agentClient ??= new ServerAgentClient(this.env));
  }
  private live: { at: number; versions: Set<string> } | null = null;

  /**
   * Versões antigas com a cópia rodando (agente do servidor), guardadas por 10 s. Se o agente não
   * responder, vale a última resposta por até 10 min (melhor que mandar o restaurante para uma
   * versão em que o banco dele ainda não está).
   */
  private async liveVersions(): Promise<Set<string>> {
    if (!this.env.COMANDOU_VERSION || !this.agent.enabled) return new Set();
    const now = Date.now();
    if (this.live && now - this.live.at < 10_000) return this.live.versions;
    try {
      const r = await this.agent.call<{ versions: { version: string; ready: boolean }[] }>(
        'GET',
        '/v1/versions',
        undefined,
        5_000,
      );
      this.live = {
        at: now,
        versions: new Set(r.versions.filter((v) => v.ready).map((v) => v.version)),
      };
    } catch {
      if (!this.live || now - this.live.at > 600_000)
        this.live = { at: now - 9_000, versions: new Set() };
    }
    return this.live.versions;
  }

  /** Endereço -> versão antiga, só para restaurantes fora da versão principal com a cópia no ar. */
  private async pinnedHosts(): Promise<Map<string, string>> {
    const main = this.env.COMANDOU_VERSION;
    const out = new Map<string, string>();
    if (!main) return out;
    const live = await this.liveVersions();
    if (!live.size) return out;
    const rows = await this.db
      .queryUnscoped<{ hostname: string; app_version: string | null; custom: boolean }>(
        'SELECT hostname, app_version, custom FROM app_tenant_routes()',
        [],
      )
      .catch(() => []);
    for (const r of rows) {
      if (!r.app_version || r.app_version === main || !live.has(r.app_version)) continue;
      out.set(
        r.custom ? r.hostname : `${r.hostname}.${this.env.COMANDOU_BASE_DOMAIN}`,
        r.app_version,
      );
    }
    return out;
  }

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
      await this.pinnedHosts(),
    );
  }
}
