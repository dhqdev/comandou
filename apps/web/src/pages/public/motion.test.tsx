import { cleanup, fireEvent, render } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Photo } from './ui';

/** Blocos do CSS fora de "reduzir movimento" (o @media comum entra: vale numa tela ou outra). */
function cssOf(path: string) {
  const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const keyframes = new Map<string, string>();
  const rules: { selector: string; body: string }[] = [];
  const walk = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (depth && j < text.length) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith('@keyframes')) keyframes.set(head.split(/\s+/)[1]!, body);
      else if (head.startsWith('@media') && !/reduce/.test(head)) walk(body);
      else if (!head.startsWith('@')) rules.push({ selector: head, body });
      i = j;
    }
  };
  walk(css);
  return { keyframes, rules };
}

const FILES = [
  ...readdirSync(__dirname)
    .filter((f) => f.endsWith('.css'))
    .map((f) => join(__dirname, f)),
  join(__dirname, '../../features/store-chat/store-chat.css'),
];

/*
 * Animação que repete sem parar e mexe em opacidade fazia o Safari do iPhone esmaecer a tela
 * inteira e voltar (a tela do pedido e o cardápio "piscando"). No cardápio do cliente, o que fica
 * em laço anima só transform, cor ou traço.
 */
describe('Cardápio do cliente: movimento sem piscar', () => {
  afterEach(cleanup);

  it('nenhuma animação em laço mexe em opacidade', () => {
    const all = FILES.map(cssOf);
    const keyframes = new Map(all.flatMap((c) => [...c.keyframes]));
    const bad: string[] = [];
    for (const { rules } of all)
      for (const { selector, body } of rules) {
        const m = /(?:^|;)\s*animation\s*:\s*([^;]+)/.exec(body);
        if (!m) continue;
        const infinite =
          /\binfinite\b/.test(m[1]!) || /animation-iteration-count\s*:\s*infinite/.test(body);
        if (!infinite) continue;
        for (const name of m[1]!.split(/[\s,]+/).filter((w) => keyframes.has(w)))
          if (/opacity/.test(keyframes.get(name)!)) bad.push(`${selector.trim()} → ${name}`);
      }
    expect(bad).toEqual([]);
  });

  it('foto que já apareceu volta na hora, sem o fade de novo', () => {
    const first = render(<Photo src="/api/v1/media/um" alt="X-Burger" />);
    const ph = first.container.querySelector('.ph')!;
    expect(ph).toHaveAttribute('data-state', 'loading');
    fireEvent.load(first.container.querySelector('img')!);
    expect(ph).toHaveAttribute('data-state', 'ok');
    first.unmount();
    // Voltar ao cardápio monta a foto de novo: já pronta e sem transição.
    const again = render(<Photo src="/api/v1/media/um" alt="X-Burger" />);
    const back = again.container.querySelector('.ph')!;
    expect(back).toHaveAttribute('data-state', 'ok');
    expect(back).toHaveAttribute('data-instant');
  });
});
