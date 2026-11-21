import { DEFAULT_ROLE_PERMISSIONS, ROLES } from '@comandou/shared';
import { describe, expect, it } from 'vitest';
import { ACCESS_LINKS, loginAreaFor, ROLE_HOME, ROUTE_PERMS } from './role-home';

describe('links de acesso da Equipe', () => {
  it('todo papel tem exatamente um link', () => {
    for (const role of ROLES)
      expect(
        ACCESS_LINKS.filter((l) => l.roles.includes(role)),
        role,
      ).toHaveLength(1);
  });

  it('cada link abre o login da própria área', () => {
    for (const l of ACCESS_LINKS)
      for (const role of l.roles)
        expect(loginAreaFor(l.path), `${role} em ${l.path}`).toBe(
          role === 'owner' || role === 'manager' ? null : role,
        );
  });

  it('depois de entrar, o papel pode abrir a tela do link', () => {
    for (const l of ACCESS_LINKS)
      for (const role of l.roles) {
        // Papéis com app próprio caem na casa deles, que é o próprio link.
        if (ROLE_HOME[role]) {
          expect(ROLE_HOME[role].startsWith(l.path), role).toBe(true);
          continue;
        }
        const need = ROUTE_PERMS[l.path.slice(1)];
        if (!need) continue; // painel (/): começa no PDV ou em Pedidos
        expect(
          need.some((p) => (DEFAULT_ROLE_PERMISSIONS[role] as readonly string[]).includes(p)),
          `${role} em ${l.path}`,
        ).toBe(true);
      }
  });

  it('a sessão que vence numa tela de dentro volta ao login da mesma área', () => {
    expect(loginAreaFor('/garcom/mesas')).toBe('waiter');
    expect(loginAreaFor('/gar%C3%A7om')).toBe('waiter');
    expect(loginAreaFor('/entregas/historico')).toBe('driver');
    expect(loginAreaFor('/cozinha/')).toBe('kitchen');
    expect(loginAreaFor('/pedidos')).toBeNull();
    expect(loginAreaFor('/caixas')).toBeNull();
  });
});
