import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_CATEGORIES, DEMO_FEATURED, DEMO_GROUPS, DEMO_ITEMS } from './demo-data';
import { SECOND_LEVEL_SUFFIX, siteCandidate } from './host';
import { shuffleOffsets } from './Shuffle';
import { looksLikeUrl, parseItems, SAMPLE_ITEMS, SAMPLE_STORE, slugPreview } from './site-data';

const pub = (p: string) => join(__dirname, '../../public', p);

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

  it('domínio base com final de dois nomes (outra instalação em .com.br)', () => {
    expect(siteCandidate('comandou.com.br')).toBe(true);
    expect(siteCandidate('www.comandou.com.br')).toBe(true);
    expect(siteCandidate('empresa.co.uk')).toBe(true);
    expect(siteCandidate('fumaca.comandou.com.br')).toBe(false);
    expect(siteCandidate('admin.comandou.com.br')).toBe(false);
    // Restaurante num subdomínio de domínio comum continua sendo restaurante.
    expect(siteCandidate('fumaca.comandou.com')).toBe(false);
    // O boot.js (esqueleto antes do app) usa a mesma regra.
    const boot = readFileSync(join(__dirname, '../../public/boot.js'), 'utf8');
    expect(boot).toContain(SECOND_LEVEL_SUFFIX.source);
  });

  it('prévia do endereço segue a regra da API (trialSlug)', () => {
    expect(slugPreview('Fumaça Burger & Co.')).toBe('fumaca-burger-co');
    expect(slugPreview('  Pastelaria   da Vila! ')).toBe('pastelaria-da-vila');
    expect(slugPreview('Zé')).toBe('restaurante-ze');
    expect(slugPreview('Admin')).toBe('meu-admin');
    expect(slugPreview('   ')).toBe('');
  });

  it('Shuffle: as ímpares correm primeiro e as pares depois, como no React Bits', () => {
    const at = shuffleOffsets(4, 'evenodd', 350, 30);
    expect(at[1]).toBe(0);
    expect(at[3]).toBe(30);
    expect(at[0]).toBeCloseTo(266);
    expect(at[2]).toBeCloseTo(296);
    expect(shuffleOffsets(3, 'sequence', 350, 30)).toEqual([0, 30, 60]);
  });

  it('fotos do celular do topo e da lanchonete de demonstração existem', () => {
    for (const p of [SAMPLE_STORE.logo, SAMPLE_STORE.cover, ...SAMPLE_ITEMS.map((i) => i.photo!)])
      expect(existsSync(pub(p)), p).toBe(true);
    for (const i of DEMO_ITEMS) {
      expect(existsSync(pub(`site/food/${i.img}.webp`)), i.img).toBe(true);
      expect(existsSync(pub(`site/food/${i.img}-sm.webp`)), i.img).toBe(true);
      expect(
        DEMO_CATEGORIES.some((c) => c.key === i.cat),
        i.key,
      ).toBe(true);
      for (const g of i.groups ?? []) expect(DEMO_GROUPS[g], `${i.key}: ${g}`).toBeDefined();
    }
    for (const k of DEMO_FEATURED)
      expect(
        DEMO_ITEMS.some((i) => i.key === k),
        k,
      ).toBe(true);
  });
});
