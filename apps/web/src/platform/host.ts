/** admin.<domínio>: painel Super Admin (arquivo leve, para não baixar o painel inteiro antes). */
export function isPlatformHost(hostname = window.location.hostname): boolean {
  return hostname.startsWith('admin.');
}
