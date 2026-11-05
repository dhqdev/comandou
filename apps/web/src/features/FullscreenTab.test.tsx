import { describe, expect, it } from 'vitest';
import { isPublicPath } from './FullscreenTab';

describe('isPublicPath', () => {
  it('esconde a aba nas telas do cliente final', () => {
    for (const p of [
      '/pedir',
      '/pedir/carrinho',
      '/pedido/abc',
      '/rastreio/x',
      '/mesa/3',
      '/precos',
      '/pre%C3%A7os',
    ])
      expect(isPublicPath(p)).toBe(true);
  });
  it('mostra a aba nas telas do sistema', () => {
    for (const p of ['/', '/pdv', '/pedidos', '/cardapio', '/garcom/mesas', '/cozinha', '/precosx'])
      expect(isPublicPath(p)).toBe(false);
  });
});
