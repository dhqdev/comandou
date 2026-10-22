import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RELEASES } from './releases';

describe('releases', () => {
  it('versões únicas, em ordem decrescente, com datas válidas e notas', () => {
    const v = RELEASES.map((r) => r.version.split('.').map(Number));
    expect(new Set(RELEASES.map((r) => r.version)).size).toBe(RELEASES.length);
    for (let i = 1; i < v.length; i++) {
      const [a, b] = [v[i - 1], v[i]];
      const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      expect(cmp).toBeGreaterThan(0);
    }
    for (const r of RELEASES) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.notes.length).toBeGreaterThan(0);
    }
  });

  it('versão atual do sistema = primeira release (atualize as duas juntas)', () => {
    for (const f of ['../../../package.json', '../package.json']) {
      const pkg = JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8')) as {
        version: string;
      };
      expect(pkg.version, f).toBe(RELEASES[0].version);
    }
  });
});
