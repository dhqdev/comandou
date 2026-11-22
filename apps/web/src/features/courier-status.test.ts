import { describe, expect, it } from 'vitest';
import { courierState, lastSeen, phoneLabel, whatsappNumber } from './courier-status';

const now = Date.parse('2026-11-21T21:00:00Z');
const ago = (s: number) => new Date(now - s * 1000).toISOString();
const base = {
  active: true,
  userId: null,
  linkCreatedAt: null,
  linkSeenAt: null,
  appSeenAt: null,
} as const;

describe('courierState', () => {
  it('desligado vale mais que corrida aberta', () => {
    expect(courierState({ ...base, active: false }, 2, now)).toBe('desligado');
  });
  it('com corrida aberta está na rua', () => {
    expect(courierState({ ...base, linkCreatedAt: ago(9999) }, 1, now)).toBe('rua');
  });
  it('sem link e sem login não tem acesso ao app', () => {
    expect(courierState(base, 0, now)).toBe('sem-acesso');
  });
  it('link aberto agora é disponível; aberto há muito, offline', () => {
    const c = { ...base, linkCreatedAt: ago(9999) };
    expect(courierState({ ...c, linkSeenAt: ago(30) }, 0, now)).toBe('disponivel');
    expect(courierState({ ...c, linkSeenAt: ago(600) }, 0, now)).toBe('offline');
    expect(courierState(c, 0, now)).toBe('offline');
  });
  it('login com app aberto é disponível', () => {
    expect(courierState({ ...base, userId: 'u', appSeenAt: ago(10) }, 0, now)).toBe('disponivel');
  });
});

describe('ajudas', () => {
  it('lastSeen pega o mais recente', () => {
    expect(lastSeen({ linkSeenAt: ago(100), appSeenAt: ago(5) })).toBe(ago(5));
    expect(lastSeen({ linkSeenAt: null, appSeenAt: null })).toBeNull();
  });
  it('telefone e WhatsApp', () => {
    expect(phoneLabel('11987452201')).toBe('(11) 98745-2201');
    expect(phoneLabel('5511987452201')).toBe('(11) 98745-2201');
    expect(whatsappNumber('(11) 98745-2201')).toBe('5511987452201');
    expect(whatsappNumber('5511987452201')).toBe('5511987452201');
    expect(whatsappNumber(null)).toBe('');
  });
});
