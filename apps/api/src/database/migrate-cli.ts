import { Client } from 'pg';
import { resolveFileSecrets } from '../config/env';
import { databaseList, migrateAll } from './migrate-all';
import { databaseUrl, serverOf } from './tenant-database';

/**
 * Bancos próprios dos restaurantes, pelo registro do banco central (vazio antes da 0018). Com a
 * versão desta imagem conhecida (0062), ficam de fora os restaurantes que estão em outra versão:
 * eles só migram quando o Super Admin atualiza cada um (trabalho "upgrade").
 */
async function registeredDatabases(
  centralUrl: string,
  version = process.env.COMANDOU_VERSION,
): Promise<string[]> {
  const c = new Client({ connectionString: centralUrl });
  await c.connect();
  try {
    type Row = { db_name: string; host?: string | null; port?: number | null; ssl?: string | null };
    const live = `status IN ('ready', 'deleting', 'transferring')`;
    const v = version?.trim().replace(/^v?/, 'v');
    const pinned = v && /^v\d+\.\d+\.\d+$/.test(v) ? v : null;
    const all = `SELECT d.db_name, s.host, s.port, s.ssl FROM tenant_databases d
           LEFT JOIN platform_db_servers s ON s.id = d.server_id WHERE d.${live} ORDER BY d.db_name`;
    // Com servidores extras (0037) cada banco vai para o servidor dele; antes da 0037, só o nome.
    const rows = await (
      pinned
        ? c.query<Row>(
            `SELECT d.db_name, s.host, s.port, s.ssl FROM tenant_databases d
               JOIN tenants t ON t.id = d.tenant_id
               LEFT JOIN platform_db_servers s ON s.id = d.server_id
              WHERE d.${live} AND (t.app_version IS NULL OR t.app_version = $1) ORDER BY d.db_name`,
            [pinned],
          )
        : Promise.reject(new Error('sem versão'))
    )
      .catch(() => c.query<Row>(all))
      .then((r) => r.rows)
      .catch(
        async () =>
          (
            await c.query<Row>(
              `SELECT db_name FROM tenant_databases WHERE ${live.replace(", 'transferring'", '')} ORDER BY db_name`,
            )
          ).rows,
      );
    return rows.map((r) => databaseUrl(centralUrl, r.db_name, serverOf(r)));
  } catch {
    return [];
  } finally {
    await c.end();
  }
}

async function main() {
  Object.assign(process.env, resolveFileSecrets(process.env));
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) {
    console.error(
      'DATABASE_OWNER_URL não definido (migrações usam o papel dono, não o da aplicação).',
    );
    process.exit(2);
  }
  // Central primeiro; depois cada banco de restaurante (registro + lista manual opcional).
  const registered = await registeredDatabases(url);
  const urls = databaseList(
    url,
    [process.env.TENANT_DATABASE_OWNER_URLS ?? '', ...registered].filter(Boolean).join(','),
  );
  const reports = await migrateAll(urls);
  for (const r of reports) {
    if (r.status === 'ok')
      console.log(
        `${r.database}: migrações aplicadas: ${r.applied.length}, já existentes: ${r.skipped.length}`,
      );
    else if (r.status === 'failed') console.error(`${r.database}: FALHOU: ${r.error}`);
    else console.error(`${r.database}: não executado (o banco central falhou)`);
  }
  if (reports.some((r) => r.status !== 'ok')) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
