import type { PlatformDb } from './platform-db.service';

/**
 * Ícone de cada restaurante no Super Admin: o que ele pôs na Loja online (favicon, senão o logo).
 * A imagem mora no banco do restaurante (central ou próprio) e o painel lê só pelas funções da
 * migração 0106. O endereço leva o id da imagem: trocou o ícone, muda o endereço.
 */
export const tenantIconUrl = (tenantId: string, iconId: string | null | undefined) =>
  iconId ? `/api/v1/platform/tenants/${tenantId}/icon/${iconId}` : null;

const ICONS_SQL = `SELECT tenant_id AS "tenantId", icon_id AS "iconId" FROM platform_tenant_icons()`;
type IconRow = { tenantId: string; iconId: string };

// A lista de Conversas se atualiza a cada poucos segundos: lá uma leitura vale por 15 s, para não
// varrer todos os bancos próprios a cada vez. A lista de Restaurantes lê na hora (`maxAgeMs` 0).
const cache = new WeakMap<PlatformDb, { at: number; icons: Promise<Map<string, string>> }>();

/** Ícones (endereço por restaurante) de todos os restaurantes, em todos os bancos. */
export function tenantIcons(db: PlatformDb, maxAgeMs = 0): Promise<Map<string, string>> {
  const hit = cache.get(db);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.icons;
  const icons = readIcons(db);
  cache.set(db, { at: Date.now(), icons });
  icons.catch(() => cache.delete(db));
  return icons;
}

async function readIcons(db: PlatformDb): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const [central, dedicated] = await Promise.all([
    db.query<IconRow>(ICONS_SQL).catch(() => [] as IconRow[]),
    db.eachDedicated<IconRow>(ICONS_SQL),
  ]);
  for (const i of central) out.set(i.tenantId, i.iconId);
  // No banco próprio pronto vale o dele (o central pode ter ficado com a imagem de antes da mudança).
  const ready = new Set(dedicated.map((d) => d.tenantId));
  for (const id of ready) out.delete(id);
  for (const d of dedicated)
    for (const i of d.rows) if (i.tenantId === d.tenantId) out.set(d.tenantId, i.iconId);
  for (const [id, icon] of out) out.set(id, tenantIconUrl(id, icon)!);
  return out;
}

/** Ícone de um restaurante (endereço), lido no banco dele; null sem ícone ou sem banco pronto. */
export async function tenantIcon(db: PlatformDb, tenantId: string): Promise<string | null> {
  try {
    const h = await db.tenantDb(tenantId);
    const [i] = await h.query<IconRow>(`${ICONS_SQL} WHERE tenant_id = $1`, [tenantId]);
    return tenantIconUrl(tenantId, i?.iconId);
  } catch {
    return null;
  }
}

/** A imagem do ícone, só se o id for o favicon ou o logo ATUAL do restaurante. */
export async function tenantIconImage(db: PlatformDb, tenantId: string, iconId: string) {
  try {
    const h = await db.tenantDb(tenantId);
    const [m] = await h.query<{ content_type: string; bytes: Buffer }>(
      `SELECT content_type, bytes FROM platform_tenant_icon($1, $2)`,
      [tenantId, iconId],
    );
    return m ?? null;
  } catch {
    return null;
  }
}
