import { describe, expect, it } from 'vitest';
import { siteCandidate } from './host';
import { looksLikeUrl, parseItems } from './site-data';

describe('site público', () => {
  it('transforma as linhas digitadas em itens com preço', () => {
    expect(parseItems('Pastel de carne 12\nPastel de queijo - R$ 11,5\nCoxinha\n')).toEqual([
      { name: 'Pastel de carne', price: '12,00' },
      { name: 'Pastel de queijo', price: '11,50' },
      { name: 'Coxinha' },
    ]);
    expect(parseItems('X-Burger: 28.90; Refri 7')).toEqual([
      { name: 'X-Burger', price: '28,90' },
      { name: 'Refri', price: '7,00' },
    ]);
    expect(parseItems('a\n'.repeat(20))).toHaveLength(0);
  });

  it('reconhece endereço de site com e sem https', () => {
    expect(looksLikeUrl('fumacaburger.com.br')).toBe(true);
    expect(looksLikeUrl('https://maps.app.goo.gl/AbC123')).toBe(true);
    expect(looksLikeUrl('minha pizzaria')).toBe(false);
    expect(looksLikeUrl('pizza')).toBe(false);
  });

  it('só o domínio base e o www são candidatos a site', () => {
    expect(siteCandidate('comandou.com')).toBe(true);
    expect(siteCandidate('www.comandou.com')).toBe(true);
    expect(siteCandidate('fumaca.comandou.com')).toBe(false);
    expect(siteCandidate('admin.comandou.com')).toBe(false);
    expect(siteCandidate('localhost')).toBe(false);
    expect(siteCandidate('192.168.0.10')).toBe(false);
  });
});
