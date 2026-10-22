import { Client } from 'pg';
import { migrate } from '../src/database/migrator';
import { OWNER_URL } from './env';

/** Recria o schema do banco de TESTE e aplica todas as migrações do zero. */
export default async function setup() {
  const dbName = new URL(OWNER_URL).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Recusando limpar banco "${dbName}": testes só rodam em bancos *_test`);
  }
  const c = new Client({ connectionString: OWNER_URL });
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS public CASCADE');
  await c.query('CREATE SCHEMA public');
  await c.end();
  await migrate(OWNER_URL, undefined, () => undefined);
}
