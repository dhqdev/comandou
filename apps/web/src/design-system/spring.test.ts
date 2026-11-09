import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPRINGS, springAt, springDuration, springLinear } from './spring';

const tokens = readFileSync(join(__dirname, 'tokens.css'), 'utf8');
const flat = (s: string) => s.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/,? \)/g, ')');

describe('molas', () => {
  it('começa em 0, termina em 1 e a mola com pulo passa do ponto', () => {
    expect(springAt(0.4, 0.2, 0)).toBeCloseTo(0, 5);
    expect(springAt(0.4, 0.2, 2)).toBeCloseTo(1, 3);
    const peak = Math.max(...Array.from({ length: 200 }, (_, i) => springAt(0.4, 0.2, i / 200)));
    expect(peak).toBeGreaterThan(1.01);
    const flatPeak = Math.max(...Array.from({ length: 200 }, (_, i) => springAt(0.4, 0, i / 200)));
    expect(flatPeak).toBeLessThanOrEqual(1);
  });

  it('tokens.css tem as mesmas curvas e durações de spring.ts', () => {
    const css = flat(tokens);
    for (const [name, [r, b]] of Object.entries(SPRINGS)) {
      const prop = name === 'expand' ? '--cm-spring' : `--cm-spring-${name}`;
      expect(css).toContain(`/* spring(${r}, ${b}) */ ${prop}: ${springLinear(r, b)}`);
      expect(css).toContain(`${prop}-dur: ${Math.round(springDuration(r, b) * 1000)}ms;`);
    }
  });
});
