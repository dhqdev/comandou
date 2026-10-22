import { validateTenantSlug } from '@comandou/shared';

export type HostResolution =
  | { kind: 'tenant-subdomain'; slug: string; hostname: string }
  | { kind: 'custom-domain'; hostname: string }
  | { kind: 'platform'; hostname: string }
  /** Painel Super Admin: admin.<base>. Nunca resolve um restaurante. */
  | { kind: 'platform-admin'; hostname: string }
  | { kind: 'invalid'; reason: string };

/** Subdomínio do painel Super Admin (reservado em RESERVED_SLUGS). */
export const PLATFORM_ADMIN_LABEL = 'admin';

const HOST_RE = /^[a-z0-9.-]{1,253}$/;

/**
 * Normaliza e classifica o Host. Não consulta banco: apenas decide qual chave usar.
 * Defesa contra host-header injection: só aceitamos caracteres de hostname, sem userinfo,
 * sem múltiplos hosts, e um único nível de subdomínio sob o domínio base.
 */
export function classifyHost(rawHost: string | undefined, baseDomain: string): HostResolution {
  if (!rawHost) return { kind: 'invalid', reason: 'Host ausente' };
  let host = rawHost.trim().toLowerCase();
  if (host.includes(',') || host.includes('@') || host.includes('/')) {
    return { kind: 'invalid', reason: 'Host malformado' };
  }
  host = host.replace(/:\d{1,5}$/, '').replace(/\.$/, '');
  if (!HOST_RE.test(host) || host.includes('..'))
    return { kind: 'invalid', reason: 'Host malformado' };

  const base = baseDomain.toLowerCase();
  if (host === base || host === `www.${base}`) return { kind: 'platform', hostname: host };
  const suffix = `.${base}`;
  if (host.endsWith(suffix)) {
    const label = host.slice(0, -suffix.length);
    if (label.includes('.')) return { kind: 'invalid', reason: 'Subdomínio não suportado' };
    if (label === PLATFORM_ADMIN_LABEL) return { kind: 'platform-admin', hostname: host };
    const v = validateTenantSlug(label);
    if (!v.ok) return { kind: 'invalid', reason: 'Identificador inválido' };
    return { kind: 'tenant-subdomain', slug: label, hostname: host };
  }
  return { kind: 'custom-domain', hostname: host };
}
