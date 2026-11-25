import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Todos os testes usam o mesmo banco: dois arquivos com o mesmo prefixo no `seedTwoTenants`
 * tentam criar os mesmos restaurantes e o mesmo garçom (`garcom@<prefixo>-a.test`), e o segundo
 * a rodar quebra com "users_email_key". Cada arquivo precisa de um prefixo só dele.
 */
const ROOT = join(__dirname, '..');

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : testFiles(path);
    return e.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('prefixos do seedTwoTenants', () => {
  it('cada arquivo de teste usa um prefixo que nenhum outro usa', () => {
    const owners = new Map<string, string[]>();
    for (const file of [...testFiles(join(ROOT, 'src')), ...testFiles(join(ROOT, 'test'))]) {
      for (const m of readFileSync(file, 'utf8').matchAll(/seedTwoTenants\(\s*['"`]([^'"`]+)/g)) {
        const list = owners.get(m[1]!) ?? [];
        list.push(relative(ROOT, file));
        owners.set(m[1]!, list);
      }
    }
    expect(owners.size).toBeGreaterThan(10);
    const repeated = [...owners].filter(([, files]) => files.length > 1);
    expect(repeated).toEqual([]);
  });
});
