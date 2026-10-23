/**
 * Identificador de restaurante (slug) usado no subdomínio: <slug>.comandou.com
 * Regras: 3–40 caracteres, letras minúsculas, dígitos e hífen; não começa/termina com hífen;
 * sem hífens duplos; não pode ser um nome reservado da plataforma.
 */
export const RESERVED_SLUGS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'painel',
  'status',
  'mail',
  'smtp',
  'ftp',
  'cdn',
  'static',
  'assets',
  'traefik',
  'portainer',
  'grafana',
  'docs',
  'help',
  'ajuda',
  'suporte',
  'blog',
  'login',
  'auth',
  'billing',
  'super',
  'superadmin',
  'root',
  'dev',
  'staging',
  'test',
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/;

export function validateTenantSlug(slug: string): { ok: true } | { ok: false; reason: string } {
  if (typeof slug !== 'string') return { ok: false, reason: 'slug ausente' };
  if (!SLUG_RE.test(slug)) {
    return { ok: false, reason: 'use 3 a 40 caracteres: letras minúsculas, números e hífen' };
  }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'identificador reservado' };
  return { ok: true };
}

export const TENANT_STATUSES = [
  'requested',
  'provisioning',
  'provisioned',
  'failed',
  'recovering',
  'suspended',
  'moving',
  'deleting',
] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

/** Apenas tenants provisionados aceitam login e operação. */
export function tenantAcceptsTraffic(status: TenantStatus): boolean {
  return status === 'provisioned';
}
