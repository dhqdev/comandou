import '../config/one-shot';
import { resolveFileSecrets } from '../config/env';
import {
  databaseList,
  DatabaseMigrationReport,
  describeDatabase,
  migrateAll,
  registeredDatabases,
} from './migrate-all';
import { migrate } from './migrator';

function print(reports: DatabaseMigrationReport[]) {
  for (const r of reports) {
    if (r.status === 'ok')
      console.log(
        `${r.database}: migrações aplicadas: ${r.applied.length}, já existentes: ${r.skipped.length}`,
      );
    else if (r.status === 'failed') console.error(`${r.database}: FALHOU: ${r.error}`);
    else console.error(`${r.database}: não executado (o banco central falhou)`);
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
  // 1) O banco central (ele define a versão da plataforma e tem o registro dos outros bancos).
  const [central] = await migrateAll([url]);
  if (central!.status !== 'ok') {
    print([central!]);
    process.exit(1);
  }
  // 2) Os bancos dos restaurantes, lidos do registro já migrado (+ lista manual opcional).
  const registered = await registeredDatabases(url);
  const urls = databaseList(
    url,
    [process.env.TENANT_DATABASE_OWNER_URLS ?? '', ...registered].filter(Boolean).join(','),
  );
  const reports = await migrateAll(urls, (u) =>
    u === url
      ? Promise.resolve({ applied: central!.applied, skipped: central!.skipped })
      : migrate(u, undefined, (m) => console.log(`${describeDatabase(u)}: ${m}`)),
  );
  print(reports);
  if (reports.some((r) => r.status !== 'ok')) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
