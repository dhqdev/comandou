import { afterEach, describe, expect, it } from 'vitest';
import { lastStaffApp, rememberStaffApp, staffTableLink } from './staff-app';

const ID = '0b6c1d2e-3f40-4a51-8b62-7c83d94e05f6';

describe('QR da mesa lido por quem é da equipe', () => {
  afterEach(() => localStorage.clear());

  it('garçom sempre cai no app dele', () => {
    expect(staffTableLink(ID, 'waiter', null)).toBe(`/garcom/mesas?mesa=${ID}`);
    expect(staffTableLink(ID, 'waiter', 'painel')).toBe(`/garcom/mesas?mesa=${ID}`);
  });

  it('dono ou gerente abre onde o aparelho estava: app do garçom ou Salão do painel', () => {
    expect(staffTableLink(ID, 'owner', null)).toBe(`/mesas?mesa=${ID}`);
    rememberStaffApp('garcom');
    expect(lastStaffApp()).toBe('garcom');
    expect(staffTableLink(ID, 'manager')).toBe(`/garcom/mesas?mesa=${ID}`);
    rememberStaffApp('painel');
    expect(staffTableLink(ID, 'manager')).toBe(`/mesas?mesa=${ID}`);
  });

  it('valor estranho guardado vale como nenhum', () => {
    localStorage.setItem('cm.staff.app', 'cozinha');
    expect(lastStaffApp()).toBeNull();
  });
});
