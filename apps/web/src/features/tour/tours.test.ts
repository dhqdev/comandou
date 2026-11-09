import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { STATIC_ENTRIES } from '@comandou/shared';
import { describe, expect, it } from 'vitest';
import type { TourStop } from './GuidedTour';
import * as T from './tours';

const tours = Object.entries(T).filter(([k, v]) => k.endsWith('_STOPS') && Array.isArray(v)) as [
  string,
  TourStop[],
][];
const screens = new Set(STATIC_ENTRIES.filter((e) => e.to).map((e) => e.to!.split('?')[0]));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(n) ? [p] : [];
  });
}

describe('tutoriais', () => {
  it('toda parada abre uma tela do menu', () => {
    const menu = readFileSync(join(process.cwd(), 'src/app/AppShell.tsx'), 'utf8');
    for (const [name, stops] of tours)
      for (const s of stops)
        expect(
          s.path === '/' || screens.has(s.path) || menu.includes(`to: '${s.path}'`),
          `${name} → ${s.path}`,
        ).toBe(true);
  });

  it('toda parada diz o que fazer', () => {
    for (const [name, stops] of tours)
      for (const s of stops) expect(s.steps?.length, `${name} › ${s.title}`).toBeGreaterThan(0);
  });

  it('todo botão Tutorial aponta para um tutorial registrado', () => {
    const host = readFileSync(join(process.cwd(), 'src/features/tour/PageTour.tsx'), 'utf8');
    const used = new Set<string>();
    for (const f of files(join(process.cwd(), 'src')))
      for (const m of readFileSync(f, 'utf8').matchAll(/<TourButton tour="([a-z]+)"/g))
        used.add(m[1]!);
    expect(used.size).toBeGreaterThan(8);
    for (const id of used) expect(host, id).toMatch(new RegExp(`'${id}'`));
  });
});
