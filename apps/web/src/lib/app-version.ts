/** Build deste app (embutida no bundle). */
export const APP_BUILD: string = __APP_BUILD__;

/**
 * Build que o servidor está entregando agora. /version.json não entra no cache do service worker
 * e o Nginx manda revalidar, então a resposta é sempre a do deploy atual. null = não deu para saber.
 */
export async function fetchServerBuild(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { build?: unknown };
    return typeof body.build === 'string' ? body.build : null;
  } catch {
    return null;
  }
}
