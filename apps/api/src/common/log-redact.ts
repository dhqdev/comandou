/**
 * Partes de URL que funcionam como senha (link público de rastreio) não vão para os logs.
 * O resto da URL fica, para ainda dar para investigar uma requisição.
 */
export function maskSecretsInUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url
    .replace(/(\/track\/)[^/?#]+/g, '$1[oculto]')
    .replace(/([?&]token=)[^&#]+/g, '$1[oculto]');
}
