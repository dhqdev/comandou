import { describe, expect, it } from 'vitest';
import { brandCss, brandTokens, contrast, isCustomerPath, onColor } from './brand';

const SAMPLES = [
  '#e23a00',
  '#ffd23f',
  '#ffffff',
  '#000000',
  '#d62828',
  '#1f6feb',
  '#2b9348',
  '#a3d633',
  '#7b4ae2',
  '#00ffff',
  '#ff00ff',
  '#8c1c3a',
  '#2f3437',
];

describe('identidade visual: tons gerados a partir da cor do restaurante', () => {
  it.each(SAMPLES)('%s: texto e links sempre legíveis nos dois temas', (hex) => {
    const { light, dark } = brandTokens(hex);
    expect(light['--cm-brand-500']).toBe(hex);
    // Texto/link colorido sobre branco e sobre o cartão escuro.
    expect(contrast(light['--cm-brand-700']!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark['--cm-brand-700']!, '#1a1816')).toBeGreaterThanOrEqual(4.5);
    // Botão principal: escolhe texto escuro ou branco, o que ler melhor.
    expect(contrast(light['--cm-brand-600']!, light['--cm-on-brand']!)).toBeGreaterThanOrEqual(3.9);
    expect(contrast(dark['--cm-brand-600']!, dark['--cm-on-brand']!)).toBeGreaterThanOrEqual(3.9);
    // O escuro redefine todos os tons que o tema escuro do Comandou também redefine.
    for (const k of ['300', '400', '500', '600', '700', '800'])
      expect(dark[`--cm-brand-${k}`]).toMatch(/^#[0-9a-f]{6}$/);
    // Fundo "deep" leva texto branco.
    expect(contrast(light['--cm-brand-deep']!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    for (const [k, v] of [...Object.entries(light), ...Object.entries(dark)])
      if (k !== '--cm-focus') expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('texto por cima: escuro no amarelo, branco no azul-marinho', () => {
    expect(onColor('#ffd23f')).toBe('#1a1613');
    expect(onColor('#14213d')).toBe('#ffffff');
  });

  it('sem nada escolhido não gera estilo (vale o tema do Comandou)', () => {
    const base = {
      brandColor: null,
      accentColor: null,
      fontStyle: 'padrao',
      cornerStyle: 'padrao',
    } as const;
    expect(brandCss(base, { colors: true, shape: true })).toBe('');
    const css = brandCss(
      { ...base, brandColor: '#1f6feb', fontStyle: 'classica', cornerStyle: 'reto' },
      { colors: true, shape: false },
    );
    expect(css).toContain('--cm-brand-500:#1f6feb');
    expect(css).toContain("html:root[data-theme='dark']");
    expect(css).not.toContain('--cm-font'); // fonte e cantos só no cardápio
    expect(brandCss({ ...base, cornerStyle: 'reto' }, { colors: false, shape: true })).toContain(
      '--cm-radius-lg:6px',
    );
  });

  it('telas do cliente final', () => {
    expect(isCustomerPath('/pedir')).toBe(true);
    expect(isCustomerPath('/pedir/produto/1')).toBe(true);
    expect(isCustomerPath('/rastreio/abc')).toBe(true);
    expect(isCustomerPath('/pedidos')).toBe(false);
    expect(isCustomerPath('/cardapio')).toBe(false);
  });
});
