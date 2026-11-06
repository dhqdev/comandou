import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LivePanda } from './panda-live';

describe('LivePanda', () => {
  it('desenha o panda com degradês de id próprio', () => {
    const { container } = render(
      <>
        <LivePanda size={120} still />
        <LivePanda size={120} still />
      </>,
    );
    // dois pandas na tela não trocam as cores um do outro
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(container.querySelectorAll('.lp-pupil')).toHaveLength(4);
  });

  it('no quadradinho da marca não usa textura', () => {
    const { container } = render(<LivePanda size={40} badge />);
    expect(container.querySelector('.lp-fur')).toBeNull();
  });
});
