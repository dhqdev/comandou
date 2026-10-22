import { resolveFileSecrets } from '../config/env';
import { databaseList, migrateAll } from './migrate-all';

async function main() {
  Object.assign(process.env, resolveFileSecrets(process.env));
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) {
    console.error(
      'DATABASE_OWNER_URL não definido (migrações usam o papel dono, não o da aplicação).',
    );
    process.exit(2);
  }
  const urls = databaseList(url, process.env.TENANT_DATABASE_OWNER_URLS);
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
