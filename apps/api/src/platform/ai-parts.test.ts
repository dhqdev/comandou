import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_PARTS, groupParts, partOf, TENANT_SOURCE_LABEL } from './ai-parts';

/** Todos os `source:` gravados pelo restaurante (recordAiUsage) no código da API. */
function recordedSources(): string[] {
  const root = join(__dirname, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p);
    }
  };
  walk(root);
  const found = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (!/recordAiUsage|recordUsage\(/.test(src)) continue;
    for (const m of src.matchAll(/source:\s*'([a-z_]+)'/g)) found.add(m[1]!);
    for (const m of src.matchAll(/source:\s*'([a-z_]+)'\s*\|\s*'([a-z_]+)'/g)) {
      found.add(m[1]!);
      found.add(m[2]!);
    }
    for (const m of src.matchAll(/recordUsage\([^)]*'([a-z_]+)'\)/g)) found.add(m[1]!);
  }
  return [...found];
}

describe('partes da IA do restaurante', () => {
  it('toda fonte gravada pelo restaurante tem parte e nome (nada cai em "Outros")', () => {
    const sources = recordedSources();
    // Confere que a busca achou as fontes de verdade (se o código mudar de jeito, o teste avisa).
    expect(sources).toEqual(expect.arrayContaining(['chat', 'whatsapp', 'print_template']));
    for (const s of sources) {
      expect(partOf(s).key, s).not.toBe('other');
      expect(TENANT_SOURCE_LABEL[s], s).toBeTruthy();
    }
  });

  it('cada fonte está numa parte só', () => {
    const all = AI_PARTS.flatMap((p) => p.sources);
    expect(new Set(all).size).toBe(all.length);
  });

  it('junta por parte, na ordem fixa, com a porcentagem dos tokens', () => {
    const parts = groupParts([
      { source: 'chat', tokens: 1000, costUsd: 0.001, calls: 2 },
      { source: 'whatsapp', tokens: 2500, costUsd: 0.002, calls: 5 },
      { source: 'agent_test', tokens: 500, costUsd: 0.0005, calls: 1 },
      { source: 'photo_clean', tokens: 4175, costUsd: 0.04, calls: 1 },
      { source: 'photo_tune', tokens: 1825, costUsd: 0.0002, calls: 3 },
      { source: 'nova_fonte', tokens: 0, costUsd: 0, calls: 0 },
    ]);
    expect(parts.map((p) => p.key)).toEqual(['whatsapp', 'chat', 'photos']);
    const wa = parts[0]!;
    expect(wa).toMatchObject({ label: 'IA do WhatsApp', tokens: 3000, calls: 6, percent: 30 });
    expect(wa.sources.map((s) => s.source)).toEqual(['whatsapp', 'agent_test']);
    expect(parts[2]).toMatchObject({ tokens: 6000, percent: 60, costUsd: 0.0402 });
    expect(parts.reduce((n, p) => n + p.percent, 0)).toBeCloseTo(100, 5);
  });

  it('fonte desconhecida que gastou vai para "Outros", no fim', () => {
    const parts = groupParts([
      { source: 'nova_fonte', tokens: 10, costUsd: 0, calls: 1 },
      { source: 'chat', tokens: 10, costUsd: 0, calls: 1 },
    ]);
    expect(parts.map((p) => p.key)).toEqual(['chat', 'other']);
    expect(parts[1]!.sources[0]!.label).toBe('nova_fonte');
  });

  it('sem uso, sem partes', () => {
    expect(groupParts([])).toEqual([]);
  });
});
