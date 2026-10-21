import { migrate } from './migrator';

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) {
    console.error(
      'DATABASE_OWNER_URL não definido (migrações usam o papel dono, não o da aplicação).',
    );
    process.exit(2);
  }
  const res = await migrate(url);
  console.log(`migrações aplicadas: ${res.applied.length}, já existentes: ${res.skipped.length}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
