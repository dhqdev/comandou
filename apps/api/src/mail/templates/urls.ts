import type { Env } from '../../config/env';

/** Endereços que os e-mails usam (mesma regra do site: https em produção, porta nos testes). */
export function siteUrlOf(env: Env): string {
  const port = env.SITE_CHECK_PORT ? `:${env.SITE_CHECK_PORT}` : '';
  return `${env.COOKIE_SECURE ? 'https' : 'http'}://${env.COMANDOU_BASE_DOMAIN}${port}`;
}

/** Endereço do restaurante: https://<slug>.<domínio>. */
export function tenantUrlOf(env: Env, slug: string): string {
  const port = env.SITE_CHECK_PORT ? `:${env.SITE_CHECK_PORT}` : '';
  return `${env.COOKIE_SECURE ? 'https' : 'http'}://${slug}.${env.COMANDOU_BASE_DOMAIN}${port}`;
}

/** Painel Super Admin: https://admin.<domínio>. */
export function adminUrlOf(env: Env): string {
  return tenantUrlOf(env, 'admin');
}
