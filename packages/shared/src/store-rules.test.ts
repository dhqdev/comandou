import { describe, expect, it } from 'vitest';
import { storeRules, storeScreenAllowed } from './store-rules';

describe('regras de cada cardápio', () => {
  it('mesa: só pedir e acompanhar, mesmo com conversa e contas ligadas', () => {
    const r = storeRules('table', { chatEnabled: true, accountsEnabled: true });
    expect(r).toMatchObject({
      mode: 'table',
      chat: false,
      accountTab: false,
      delivery: false,
      reservations: false,
      favorites: false,
      loyalty: false,
      installHint: false,
    });
    for (const s of ['conversa', 'favoritos', 'fidelidade', 'reservar'])
      expect(storeScreenAllowed(r, s)).toBe(false);
    // Produto, sacola, pedidos e a conta (login do Pix) continuam abrindo.
    for (const s of ['', 'produto/1', 'sacola', 'pedidos', 'conta'])
      expect(storeScreenAllowed(r, s)).toBe(true);
  });

  it('online: segue o que a loja ligou', () => {
    expect(storeRules('online', { chatEnabled: true, accountsEnabled: true })).toMatchObject({
      chat: true,
      accountTab: true,
      delivery: true,
      reservations: true,
    });
    const off = storeRules('online', { chatEnabled: false, accountsEnabled: false });
    expect(off.chat).toBe(false);
    expect(off.accountTab).toBe(false);
    expect(storeScreenAllowed(off, 'conversa')).toBe(false);
    // Sem o campo (loja antiga), a conversa vale ligada, como na tela da loja.
    expect(storeRules('online').chat).toBe(true);
  });
});
