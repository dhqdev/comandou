import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  databaseList,
  describeDatabase,
  migrateAll,
  registeredDatabases,
} from '../src/database/migrate-all';
import { migrate } from '../src/database/migrator';
import { APP_URL, DEDICATED_OWNER_URL, OWNER_URL } from './env';

async function count(url: string): Promise<number> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const r = await c.query<{ n: number }>('SELECT count(*)::int n FROM schema_migrations');
    return r.rows[0]!.n;
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  const name = new URL(DEDICATED_OWNER_URL).pathname.slice(1);
  if (!name.endsWith('_test')) throw new Error(`Recusando limpar "${name}": só bancos *_test`);
  const c = new Client({ connectionString: DEDICATED_OWNER_URL });
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS public CASCADE');
  await c.query('CREATE SCHEMA public');
  await c.end();
});

describe('Migrações em uma lista de bancos', () => {
  it('lista: central primeiro, dedicados depois, sem repetidos', () => {
    expect(databaseList('postgres://a/c')).toEqual(['postgres://a/c']);
    expect(databaseList('postgres://a/c', ' postgres://b/d ,\npostgres://a/c\n')).toEqual([
      'postgres://a/c',
      'postgres://b/d',
    ]);
  });

  it('descrição do banco não mostra usuário nem senha', () => {
    expect(describeDatabase('postgres://dono:segredo@db:6543/comandou')).toBe('db:6543/comandou');
    expect(describeDatabase('postgres://dono:segredo@db/comandou')).toBe('db:5432/comandou');
  });

  it('aplica em todos os bancos e reexecutar não aplica de novo', async () => {
    const first = await migrateAll([OWNER_URL, DEDICATED_OWNER_URL]);
    expect(first.map((r) => r.status)).toEqual(['ok', 'ok']);
    expect(first[1]!.applied.length).toBeGreaterThan(0); // banco dedicado estava vazio
    expect(await count(DEDICATED_OWNER_URL)).toBe(await count(OWNER_URL));

    const again = await migrateAll([OWNER_URL, DEDICATED_OWNER_URL]);
    expect(again.map((r) => r.applied.length)).toEqual([0, 0]);
  });

  it('falha no central não toca os demais; falha num dedicado não para os outros', async () => {
    const calls: string[] = [];
    const run = async (url: string) => {
      calls.push(url);
      if (url.includes('quebrado')) throw new Error(`conexão recusada em ${url}`);
      return migrate(url, undefined, () => undefined);
    };
    const bad = 'postgres://dono:senha-secreta@quebrado:5432/x';

    const centralDown = await migrateAll([bad, DEDICATED_OWNER_URL], run);
    expect(centralDown.map((r) => r.status)).toEqual(['failed', 'not-run']);
    expect(calls).toEqual([bad]);
    expect(centralDown[0]!.error).not.toContain('senha-secreta');

    const oneDown = await migrateAll([OWNER_URL, bad, DEDICATED_OWNER_URL], run);
    expect(oneDown.map((r) => r.status)).toEqual(['ok', 'failed', 'ok']);
    expect(oneDown[1]!.error).toContain('quebrado:5432/x');
    expect(oneDown[1]!.error).not.toContain('senha-secreta');
  });

  it('lista os bancos dos restaurantes pelo registro e respeita a versão de cada um', async () => {
    const c = new Client({ connectionString: OWNER_URL });
    await c.connect();
    try {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO tenants (slug, name, status, app_version) VALUES
           ('tst-reg-a', 'Reg A', 'provisioned', NULL),
           ('tst-reg-b', 'Reg B', 'provisioned', 'v0.1.0'),
           ('tst-reg-c', 'Reg C', 'provisioned', NULL)
         RETURNING id`,
      );
      await c.query(
        `INSERT INTO tenant_databases (tenant_id, db_name, status) VALUES
           ($1, 'comandou_tst_reg_a', 'ready'),
           ($2, 'comandou_tst_reg_b', 'ready'),
           ($3, 'comandou_tst_reg_c', 'creating')`,
        rows.map((r) => r.id),
      );
      try {
        // Só os bancos deste teste: outros arquivos (platform.e2e, por exemplo) deixam bancos
        // próprios prontos no mesmo registro, e a ordem entre arquivos muda a cada execução.
        const names = (list: string[]) =>
          list
            .map((u) => new URL(u).pathname.slice(1))
            .filter((n) => n.startsWith('comandou_tst_reg_'));
        // Sem versão conhecida: todos os prontos. Com versão: o preso à v0.1.0 fica de fora.
        expect(names(await registeredDatabases(OWNER_URL, ''))).toEqual([
          'comandou_tst_reg_a',
          'comandou_tst_reg_b',
        ]);
        expect(names(await registeredDatabases(OWNER_URL, '0.2.0'))).toEqual([
          'comandou_tst_reg_a',
        ]);
        expect(names(await registeredDatabases(OWNER_URL, 'v0.1.0'))).toEqual([
          'comandou_tst_reg_a',
          'comandou_tst_reg_b',
        ]);
        // Não conseguiu ler o registro: é erro (antes virava lista vazia e ninguém migrava).
        await expect(registeredDatabases(APP_URL, '')).rejects.toThrow(/permission denied/);
      } finally {
        await c.query(`DELETE FROM tenant_databases WHERE tenant_id = ANY($1::uuid[])`, [
          rows.map((r) => r.id),
        ]);
        await c.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.id)]);
      }
    } finally {
      await c.end();
    }
  });
});
