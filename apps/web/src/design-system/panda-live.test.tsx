import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LivePanda } from './panda-live';

describe('LivePanda', () => {
  it('veste as peças por cima do mesmo panda', () => {
    const { container } = render(
      <LivePanda size={120} still outfit={{ head: 'chef', neck: 'bandana' }} />,
    );
    expect(container.querySelectorAll('.lp-wear')).toHaveLength(2);
    expect(container.querySelector('.lp-wear--head')).not.toBeNull();
    // degradês com id próprio: dois pandas na tela não trocam as cores um do outro
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sem roupa não desenha peça; no quadradinho da marca não usa textura', () => {
    const { container } = render(<LivePanda size={40} badge />);
    expect(container.querySelector('.lp-wear')).toBeNull();
    expect(container.querySelector('.lp-fur')).toBeNull();
  });
});
