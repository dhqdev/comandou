/** Só o Google de verdade: google.com, google.com.br, google.pt, google.co.uk (nada de google.x.io). */
const GOOGLE_HOST = /^(?:maps\.)?google\.(?:com|[a-z]{2}|com?\.[a-z]{2})$/;

/** É um link do Google Maps? (google.com/maps, maps.google.com, maps.app.goo.gl, g.page...) */
export function isMapsLink(raw: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    if (h === 'maps.app.goo.gl' || h === 'g.page' || h === 'g.co') return true;
    if (h === 'goo.gl') return u.pathname.startsWith('/maps');
    if (!GOOGLE_HOST.test(h)) return false;
    return h.startsWith('maps.') || u.pathname.startsWith('/maps');
  } catch {
    return false;
  }
}

/**
 * Nome do lugar num link do Google Maps (/maps/place/Fuma%C3%A7a+Burger/@...). `undefined`: não
 * é link do Maps; `null`: é, mas o nome não vem no link (link curto).
 */
export function mapsPlaceName(raw: string): string | null | undefined {
  if (!isMapsLink(raw)) return undefined;
  const m = /\/maps\/place\/([^/@?]+)/.exec(raw);
  if (!m) return null;
  try {
    const name = decodeURIComponent(m[1]!.replace(/\+/g, ' ')).trim();
    return name.slice(0, 80) || null;
  } catch {
    return null;
  }
}
