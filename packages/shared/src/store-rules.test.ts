import { describe, expect, it } from 'vitest';
import { storeRules, storeScreenAllowed } from './store-rules';

describe('regras de cada cardápio', () => {
  it('mesa: só pedir e acompanhar, mesmo com conversa e contas ligadas', () => {
    const r = storeRules('table', { chatEnabled: true, accountsEnabled: true });
    expect(r).toMatchObject({
      mode: 'table',
      chat: false,
      accountTab: false,
      // Entrar na conta vale na mesa: o pedido vai para a mesa no nome do cliente.
      accountLogin: true,
      delivery: false,
      reservations: false,
      favorites: false,
      loyalty: false,
      coupons: false,
      installHint: false,
      tableService: true,
    });
    for (const s of [
      'conversa',
      'favoritos',
      'fidelidade',
      'cupons',
      'conta/indique',
      'reservar',
      'reservas',
      'reservas/abc',
      'conta/enderecos',
    ])
      expect(storeScreenAllowed(r, s)).toBe(false);
    // Produto, sacola, pedidos, a conta (login do Pix) e a aba do garçom continuam abrindo.
    for (const s of [
      '',
      'produto/1',
      'sacola',
      'pedidos',
      'conta',
      'conta/dados',
      'mesa',
      'mesa/conta',
    ])
      expect(storeScreenAllowed(r, s)).toBe(true);
  });

  it('mesa com o Perfil e os Cupons ligados: aba Perfil e cupons, sem nada da entrega', () => {
    const r = storeRules('table', {
      accountsEnabled: true,
      tableAccount: true,
      tableCoupons: true,
    });
    expect(r).toMatchObject({ accountTab: true, coupons: true, delivery: false, loyalty: false });
    for (const s of ['conta', 'conta/dados', 'cupons']) expect(storeScreenAllowed(r, s)).toBe(true);
    for (const s of ['conta/enderecos', 'conta/pagamento', 'reservas', 'conversa'])
      expect(storeScreenAllowed(r, s)).toBe(false);
    // Cupons sem o Perfil não valem (o cupom é da conta), e sem contas nada disso aparece.
    expect(storeRules('table', { accountsEnabled: true, tableCoupons: true }).coupons).toBe(false);
    expect(
      storeRules('table', { accountsEnabled: true, tableAccount: true, tableCoupons: false })
        .coupons,
    ).toBe(false);
    expect(
      storeRules('table', { accountsEnabled: false, tableAccount: true, tableCoupons: true }),
    ).toMatchObject({ accountTab: false, coupons: false });
  });

  it('online: segue o que a loja ligou', () => {
    expect(storeRules('online', { chatEnabled: true, accountsEnabled: true })).toMatchObject({
      chat: true,
      accountTab: true,
      delivery: true,
      reservations: true,
      coupons: true,
    });
    const off = storeRules('online', { chatEnabled: false, accountsEnabled: false });
    expect(off.chat).toBe(false);
    expect(off.accountTab).toBe(false);
    expect(off.accountLogin).toBe(false);
    // Cupom pede a conta do cliente (limite por cliente e primeiro pedido).
    expect(off.coupons).toBe(false);
    expect(storeScreenAllowed(off, 'cupons')).toBe(false);
    expect(storeRules('table', { accountsEnabled: false }).accountLogin).toBe(false);
    expect(storeScreenAllowed(off, 'conta/enderecos')).toBe(true);
    expect(storeScreenAllowed(off, 'conversa')).toBe(false);
    // Chamar o garçom e fechar a conta pelo celular: só no cardápio da mesa.
    expect(storeScreenAllowed(off, 'mesa')).toBe(false);
    expect(storeScreenAllowed(off, 'mesa/conta')).toBe(false);
    // Sem o campo (loja antiga), a conversa vale ligada, como na tela da loja.
    expect(storeRules('online').chat).toBe(true);
  });
});
