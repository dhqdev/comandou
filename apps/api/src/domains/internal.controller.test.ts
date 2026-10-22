import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env';
import { traefikConfig } from './internal.controller';

const base = { DATABASE_URL: 'postgres://u:p@localhost/db', COMANDOU_BASE_DOMAIN: 'comandou.com' };
const rules = (c: ReturnType<typeof traefikConfig>) =>
  Object.values(c.http.routers as Record<string, { rule: string }>).map((r) => r.rule);

describe('traefikConfig', () => {
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
