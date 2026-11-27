import { FOCUS_TARGETS, focusHref, isKnownAppPath } from '@comandou/shared';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Todo .tsx do app (sem testes): onde os alvos do assistente de IA precisam existir. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (name.endsWith('.tsx') && !name.includes('.test.')) out.push(p);
  }
  return out;
}

const SRC = join(__dirname, '..');
const code = sources(SRC)
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');
const account = readFileSync(join(SRC, 'pages', 'AccountPage.tsx'), 'utf8');

/** O id aparece num `data-search-id`, `searchId` ou `focusId` (ou é um bloco da Conta). */
function exists(id: string): boolean {
  if (id.startsWith('conta-')) {
    // Os blocos da Conta ganham `data-search-id={`conta-${a.key}`}`: basta a chave existir.
    return account.includes(`key: '${id.slice('conta-'.length)}'`);
  }
  return [`data-search-id="${id}"`, `searchId="${id}"`, `focusId="${id}"`].some((s) =>
    code.includes(s),
  );
}

describe('assistente de IA: campos que piscam', () => {
  it('todo alvo existe em alguma tela (senão o link leva e nada pisca)', () => {
    const missing = FOCUS_TARGETS.filter((t) => !exists(t.id)).map((t) => t.id);
    expect(missing).toEqual([]);
  });

  it('o link de cada alvo é um caminho do app', () => {
    for (const t of FOCUS_TARGETS) {
      const href = focusHref(t);
      expect(isKnownAppPath(href), href).toBe(true);
      expect(href).toContain(`foco=${t.id}`);
    }
  });
});
