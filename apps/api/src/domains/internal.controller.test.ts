import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env';
import { CROWDSEC_MIDDLEWARE, traefikConfig } from './internal.controller';

const site = { DATABASE_URL: 'postgres://u:p@localhost/db', COMANDOU_BASE_DOMAIN: 'comandou.com' };
/** Sem o site público (domínio base e www), para os testes abaixo olharem só os restaurantes. */
const base = { ...site, TRAEFIK_SITE_HOSTS: 'false' };
const rules = (c: ReturnType<typeof traefikConfig>) =>
  Object.values(c.http.routers as Record<string, { rule: string }>).map((r) => r.rule);

describe('traefikConfig', () => {
  it('site público: o domínio base e o www entram sozinhos, com o resolver de restaurantes', () => {
    const env = loadEnv({ ...site, TRAEFIK_TENANT_CERT_RESOLVER: 'letsencryptresolver' });
    const c = traefikConfig(['loja.exemplo.com'], env, ['demo']);
    expect(rules(c).filter((r) => !r.includes('PathPrefix'))).toEqual([
      'Host(`loja.exemplo.com`)',
      'Host(`comandou.com`)',
      'Host(`www.comandou.com`)',
    ]);
    const routers = Object.values(c.http.routers) as { rule: string; tls: unknown }[];
    expect(routers.find((r) => r.rule === 'Host(`comandou.com`)')!.tls).toEqual({
      certResolver: 'letsencryptresolver',
    });
  });

  it('desligado: só domínios personalizados', () => {
    const env = loadEnv({ ...base });
    expect(rules(traefikConfig(['loja.exemplo.com'], env, ['demo']))).toEqual([
      'Host(`loja.exemplo.com`) && PathPrefix(`/api`)',
      'Host(`loja.exemplo.com`)',
    ]);
  });

  it('ligado: admin e um endereço por restaurante, com o resolver de restaurantes', () => {
    const env = loadEnv({
      ...base,
      TRAEFIK_TENANT_HOSTS: 'true',
      TRAEFIK_TENANT_CERT_RESOLVER: 'letsencryptresolver',
    });
    const c = traefikConfig([], env, ['demo', 'divinamente']);
    expect(rules(c).filter((r) => !r.includes('PathPrefix'))).toEqual([
      'Host(`admin.comandou.com`)',
      'Host(`demo.comandou.com`)',
      'Host(`divinamente.comandou.com`)',
    ]);
    expect(Object.values(c.http.routers)[0]).toMatchObject({
      tls: { certResolver: 'letsencryptresolver' },
    });
  });

  it('ligado sem resolver próprio: usa o resolver HTTP-01 padrão', () => {
    const env = loadEnv({ ...base, TRAEFIK_TENANT_HOSTS: 'true' });
    expect(Object.values(traefikConfig([], env, ['demo']).http.routers)[0]).toMatchObject({
      tls: { certResolver: 'letsencrypt-http' },
    });
  });
});

describe('traefikConfig com CrowdSec', () => {
  const key = 'k'.repeat(32);

  it('desligado por padrão: sem middleware nem roteadores extras', () => {
    const c = traefikConfig(['loja.exemplo.com'], loadEnv({ ...base, CROWDSEC_BOUNCER_KEY: key }));
    expect(c.http).not.toHaveProperty('middlewares');
    expect(Object.keys(c.http.routers)).toHaveLength(2);
  });

  it('ligado sem chave: não liga (o Traefik não conseguiria falar com o CrowdSec)', () => {
    const c = traefikConfig(['loja.exemplo.com'], loadEnv({ ...base, CROWDSEC_BOUNCER: 'true' }));
    expect(c.http).not.toHaveProperty('middlewares');
  });

  it('ligado: API e site passam pelo bouncer; webhook, status e métricas ficam livres', () => {
    const env = loadEnv({
      ...base,
      TRAEFIK_TENANT_HOSTS: 'true',
      CROWDSEC_BOUNCER: 'true',
      CROWDSEC_BOUNCER_KEY: key,
      CROWDSEC_TRUSTED_IPS: '203.0.113.7, 198.51.100.0/24',
    });
    const c = traefikConfig([], env, ['demo']);
    const routers = c.http.routers as Record<
      string,
      { rule: string; priority: number; middlewares?: string[] }
    >;
    const open = Object.values(routers).filter((r) => r.rule.includes('asaas/webhook'));
    expect(open.map((r) => r.rule)).toEqual([
      'Host(`admin.comandou.com`) && (PathPrefix(`/api/v1/health/`) || Path(`/api/v1/platform/billing/asaas/webhook`) || Path(`/api/v1/metrics`))',
      'Host(`demo.comandou.com`) && (PathPrefix(`/api/v1/health/`) || Path(`/api/v1/platform/billing/asaas/webhook`) || Path(`/api/v1/metrics`))',
    ]);
    for (const r of open) {
      expect(r.middlewares).toBeUndefined();
      expect(r.priority).toBeGreaterThan(100);
    }
    const rest = Object.entries(routers).filter(([, r]) => !r.rule.includes('asaas/webhook'));
    const guarded = rest.filter(([n]) => !n.endsWith('-fallback')).map(([, r]) => r);
    expect(guarded).toHaveLength(4);
    for (const r of guarded) expect(r.middlewares).toEqual([CROWDSEC_MIDDLEWARE]);
    // Reserva sem o middleware, logo abaixo de cada protegido: Traefik sem o plugin não derruba o site.
    const fallback = rest.filter(([n]) => n.endsWith('-fallback')).map(([, r]) => r);
    expect(fallback).toHaveLength(4);
    for (const r of fallback) {
      expect(r.middlewares).toBeUndefined();
      const twin = guarded.find((g) => g.rule === r.rule);
      expect(twin && twin.priority).toBe(r.priority + 1);
    }

    const mw = (c.http as { middlewares: Record<string, any> }).middlewares[CROWDSEC_MIDDLEWARE];
    expect(mw.plugin.crowdsec).toMatchObject({
      enabled: true,
      crowdsecMode: 'stream',
      crowdsecLapiHost: 'crowdsec_crowdsec:8080',
      crowdsecLapiKey: key,
      // CrowdSec fora do ar não derruba os sites.
      updateMaxFailure: -1,
      streamStartupBlock: false,
    });
    expect(mw.plugin.crowdsec.clientTrustedIPs).toEqual(
      expect.arrayContaining(['10.0.0.0/8', '172.16.0.0/12', '203.0.113.7', '198.51.100.0/24']),
    );
  });

  it('coringa: uma porta livre para todos os subdomínios', () => {
    const env = loadEnv({ ...base, CROWDSEC_BOUNCER: 'true', CROWDSEC_BOUNCER_KEY: key });
    const routers = traefikConfig([], env).http.routers as Record<string, { rule: string }>;
    expect(Object.keys(routers)).toEqual([
      'cm-wildcard-open',
      'cm-wildcard-api-fallback',
      'cm-wildcard-web-fallback',
    ]);
    const r = routers['cm-wildcard-open'];
    expect(r.rule).toBe(
      'HostRegexp(`^[a-z0-9-]+\\.comandou\\.com$`) && (PathPrefix(`/api/v1/health/`) || Path(`/api/v1/platform/billing/asaas/webhook`) || Path(`/api/v1/metrics`))',
    );
  });
});

describe('traefikConfig com restaurantes em versão anterior', () => {
  it('manda o restaurante da versão anterior para a cópia daquela versão, acima de tudo', () => {
    const env = loadEnv({ ...base, TRAEFIK_TENANT_HOSTS: 'true' });
    const c = traefikConfig(
      ['loja.exemplo.com'],
      env,
      ['demo', 'nova'],
      new Map([
        ['demo.comandou.com', 'v0.108.5'],
        ['loja.exemplo.com', 'v0.108.5'],
      ]),
    );
    const routers = Object.values(c.http.routers) as {
      rule: string;
      service: string;
      priority: number;
    }[];
    const of = (rule: string) => routers.find((r) => r.rule === rule)!;
    expect(of('Host(`demo.comandou.com`) && PathPrefix(`/api`)')).toMatchObject({
      service: 'comandou-api-v0-108-5@swarm',
      priority: 1100,
    });
    expect(of('Host(`demo.comandou.com`)')).toMatchObject({
      service: 'comandou-web-v0-108-5@swarm',
      priority: 1010,
    });
    expect(of('Host(`loja.exemplo.com`)').service).toBe('comandou-web-v0-108-5@swarm');
    // Quem está na versão principal e o Super Admin seguem no principal.
    expect(of('Host(`nova.comandou.com`)').service).toBe('comandou-web@swarm');
    expect(of('Host(`admin.comandou.com`)').service).toBe('comandou-web@swarm');
  });

  it('certificado coringa: cria roteadores só para os restaurantes da versão anterior', () => {
    const env = loadEnv({ ...base, TRAEFIK_TENANT_HOSTS: 'false' });
    const c = traefikConfig([], env, [], new Map([['demo.comandou.com', 'v0.108.5']]));
    expect(rules(c)).toEqual([
      'Host(`demo.comandou.com`) && PathPrefix(`/api`)',
      'Host(`demo.comandou.com`)',
    ]);
  });

  it('com CrowdSec, as rotas livres e as de reserva também vão para a cópia', () => {
    const env = loadEnv({
      ...base,
      TRAEFIK_TENANT_HOSTS: 'true',
      CROWDSEC_BOUNCER: 'true',
      CROWDSEC_BOUNCER_KEY: 'k'.repeat(32),
    });
    const c = traefikConfig([], env, ['demo'], new Map([['demo.comandou.com', 'v0.108.5']]));
    const demo = Object.values(c.http.routers as Record<string, { rule: string; service: string }>)
      .filter((r) => r.rule.includes('demo.comandou.com'))
      .map((r) => r.service);
    expect(demo.length).toBe(5);
    expect(demo.every((s) => s.includes('-v0-108-5@swarm'))).toBe(true);
  });
});
