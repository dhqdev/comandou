import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MenuSkeleton } from './MenuSkeleton';

/** Desenho de um bloco: etiqueta, classes e estilo de cada peça, sem espaços nem aspas. */
function shape(el: Element): string {
  const cls = [...el.classList].filter((c) => c !== 'cm-msk--react').join('.');
  const style = (el.getAttribute('style') ?? '').replace(/\s+/g, '').replace(/;$/, '');
  const kids = [...el.children].map(shape).join(',');
  return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${style ? `{${style}}` : ''}${kids ? `[${kids}]` : ''}`;
}

describe('Esqueleto do cardápio', () => {
  it('é o mesmo desenho do index.html (sem trocar de desenho ao abrir)', () => {
    const html = readFileSync(join(__dirname, '../../index.html'), 'utf8');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const fromHtml = doc.querySelector('#cm-boot .cm-msk');
    expect(fromHtml).not.toBeNull();
    const { container } = render(<MenuSkeleton />);
    const fromReact = container.querySelector('.cm-msk');
    expect(fromReact).not.toBeNull();
    expect(shape(fromReact!)).toBe(shape(fromHtml!));
  });

  it('anuncia o carregamento para leitor de tela', () => {
    const { container } = render(<MenuSkeleton />);
    const status = container.querySelector('[role="status"]');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Abrindo o cardápio');
  });
});
