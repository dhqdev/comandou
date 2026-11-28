import { describe, expect, it } from 'vitest';
import { isMapsLink, mapsPlaceName } from '../../common/maps-link';
import { trialSlug } from './site-util';
import { trialPassword } from './site.service';
import { TrialBody } from './site.schemas';
import { welcomeEmail } from './welcome-email';

describe('teste criado pelo site', () => {
  it('monta o endereço a partir do nome do restaurante', () => {
    expect(trialSlug('Fumaça Burger & Co.')).toBe('fumaca-burger-co');
    expect(trialSlug('  Pizzaria do Zé  ')).toBe('pizzaria-do-ze');
    expect(trialSlug('Zé')).toBe('restaurante-ze');
    // Reservado (admin) e nomes só com símbolos nunca viram um endereço inválido.
    expect(trialSlug('Admin')).toBe('meu-admin');
    expect(trialSlug('!!!')).toMatch(/^[a-z0-9-]{3,40}$/);
    expect(trialSlug('x'.repeat(90)).length).toBeLessThanOrEqual(40);
  });

  it('reconhece links do Google Maps e tira o nome do lugar', () => {
    const url = 'https://www.google.com/maps/place/Fuma%C3%A7a+Burger/@-23.5,-46.6,17z';
    expect(isMapsLink(url)).toBe(true);
    expect(mapsPlaceName(url)).toBe('Fumaça Burger');
    expect(mapsPlaceName('https://maps.app.goo.gl/AbCdEf123')).toBeNull();
    expect(mapsPlaceName('https://fumacaburger.com.br/cardapio')).toBeUndefined();
    expect(isMapsLink('https://www.google.com/search?q=pizza')).toBe(false);
    expect(isMapsLink('https://google.com.evil.example/maps')).toBe(false);
  });

  it('gera senha fácil de digitar, com pelo menos 10 caracteres', () => {
    const p = trialPassword();
    expect(p).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(p).not.toMatch(/[il1o0]/);
    expect(trialPassword()).not.toBe(p);
  });

  it('valida o cadastro e recusa o campo escondido preenchido', () => {
    const ok = TrialBody.parse({
      restaurant: ' Pastelaria da Lu ',
      name: 'Luciana',
      email: 'LU@Exemplo.com',
      phone: '(11) 98888-7777',
    });
    expect(ok).toMatchObject({
      restaurant: 'Pastelaria da Lu',
      email: 'lu@exemplo.com',
      phone: '11988887777',
      source: { kind: 'none', value: '' },
    });
    expect(TrialBody.safeParse({ ...ok, company: 'robô' }).success).toBe(false);
    expect(TrialBody.safeParse({ ...ok, email: 'sem-arroba' }).success).toBe(false);
    expect(TrialBody.safeParse({ ...ok, source: { kind: 'text', value: 'curto' } }).success).toBe(
      false,
    );
  });

  it('monta o e-mail de boas-vindas com o login e sem deixar HTML passar', () => {
    const m = welcomeEmail({
      restaurant: 'Bar <b>do</b> Zé',
      contactName: 'Zé Silva',
      url: 'https://bar-do-ze.comandou.com',
      loginEmail: 'ze@exemplo.com',
      password: 'abcd-efgh-2345',
      trialDays: 3,
      trialEndsAt: new Date('2026-11-18T18:00:00Z'),
      siteUrl: 'https://comandou.com',
    });
    expect(m.subject).toBe('Bar <b>do</b> Zé já está no ar no Comandou');
    expect(m.html).toContain('abcd-efgh-2345');
    expect(m.html).toContain('href="https://bar-do-ze.comandou.com"');
    expect(m.html).not.toContain('<b>do</b>');
    expect(m.html).toContain('por 3 dias');
    expect(m.text).toContain('Login: ze@exemplo.com');
    expect(m.text).toContain('Senha: abcd-efgh-2345');
  });
});

describe('combinado da conversa da criação (0.282)', () => {
  const base = {
    categories: [
      { name: 'Lanches', items: [{ name: 'X-Burger', description: null, price: '28.90' }] },
    ],
    store: {
      brandColor: '#E23A00',
      accentColor: null,
      logoUrl: null,
      whatsapp: null,
      address: null,
    },
    sell: { delivery: true, pickup: true, tables: false },
    eta: { min: 30, max: 45 },
  };
  const trial = (setup: unknown) =>
    TrialBody.safeParse({ restaurant: 'Lanche Bom', name: 'Ana', email: 'ana@x.test', setup });

  it('aceita o cardápio conferido e a cara da loja', () => {
    const r = trial(base);
    expect(r.success).toBe(true);
    expect(r.success && r.data.setup?.store.brandColor).toBe('#e23a00');
  });

  it('recusa logo que não é imagem nem link, preço estranho e cardápio grande demais', () => {
    expect(
      trial({ ...base, store: { ...base.store, logoUrl: 'javascript:alert(1)' } }).success,
    ).toBe(false);
    expect(
      trial({
        ...base,
        categories: [{ name: 'X', items: [{ name: 'A', description: null, price: '1,5' }] }],
      }).success,
    ).toBe(false);
    const many = Array.from({ length: 5 }, (_, c) => ({
      name: `C${c}`,
      items: Array.from({ length: 100 }, (_, i) => ({
        name: `I${i}`,
        description: null,
        price: '1.00',
      })),
    }));
    expect(trial({ ...base, categories: many }).success).toBe(false);
  });
});
