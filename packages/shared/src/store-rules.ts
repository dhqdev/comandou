/**
 * Regras de cada cardápio do cliente. O mesmo cardápio online abre de dois jeitos:
 *
 * - **Mesa** (`table`): o cliente leu o QR Code da mesa e já está sentado. Ele só escolhe, envia e
 *   acompanha; a conversa com a loja, a entrega, a retirada, a reserva, os favoritos, a fidelidade
 *   e o aviso de instalar o app ficam de fora (quem resolve qualquer coisa é o garçom). O cliente
 *   pode entrar na conta dele (`accountLogin`): o pedido da mesa vai no nome dele e fica no
 *   histórico. Com o Perfil na mesa ligado pela loja (`tableAccount`), ganha a aba Perfil (dados,
 *   CPF, avisos, a loja; nada de endereço, pagamento ou entrega) e, com os Cupons na mesa
 *   (`tableCoupons`), usa os cupons da conta no pedido da mesa. Sem conta, o celular só vê os
 *   pedidos até a conta da mesa ser paga.
 * - **Online** (`online`): entrega e retirada pelo link da loja, com tudo o que a loja ligou.
 *
 * A API (cardápio e acompanhamento do pedido) e o cardápio leem daqui, para as duas pontas nunca
 * discordarem do que cada cardápio mostra.
 */
export type StoreMode = 'table' | 'online';

export interface StoreRules {
  mode: StoreMode;
  /** Conversa com a loja (aba Conversa e "Falar com a loja" no acompanhamento). */
  chat: boolean;
  /** Aba da conta do cliente nas abas do cardápio (na mesa, a aba Perfil). */
  accountTab: boolean;
  /**
   * Entrar na conta (botão do topo e "Tem conta? Entrar" na sacola). Na mesa também: o pedido vai
   * para a mesa no nome do cliente, sem entrega nem retirada.
   */
  accountLogin: boolean;
  /** Entrega e retirada (endereço, taxa, pedido mínimo, motoboy). */
  delivery: boolean;
  /** Reservar mesa. */
  reservations: boolean;
  /** Aba Favoritos e o coração dos produtos. */
  favorites: boolean;
  /** Faixa e tela da fidelidade. */
  loyalty: boolean;
  /**
   * Aba Cupons (vitrine e código) e o cupom na sacola: com a conta do cliente; na mesa, só com o
   * Perfil e os Cupons na mesa ligados.
   */
  coupons: boolean;
  /** Aviso de instalar o cardápio como app. */
  installHint: boolean;
  /** Aba do meio da mesa: chamar o garçom e fechar a conta pelo celular. */
  tableService: boolean;
}

/** Ligado pela loja em Loja online (o cardápio de mesa ainda filtra por cima). */
export interface StoreToggles {
  chatEnabled?: boolean | null;
  accountsEnabled?: boolean | null;
  /** Aba Perfil no cardápio da mesa (pede as contas ligadas). */
  tableAccount?: boolean | null;
  /** Cupons da conta no pedido da mesa (pede o Perfil na mesa). */
  tableCoupons?: boolean | null;
}

export function storeRules(mode: StoreMode, t: StoreToggles = {}): StoreRules {
  const chat = t.chatEnabled !== false;
  const accounts = !!t.accountsEnabled;
  if (mode === 'table') {
    // Sem o campo (cardápio guardado de uma versão antiga), a mesa segue sem a aba Perfil.
    const profile = accounts && t.tableAccount === true;
    return {
      mode,
      chat: false,
      accountTab: profile,
      accountLogin: accounts,
      delivery: false,
      reservations: false,
      favorites: false,
      loyalty: false,
      coupons: profile && t.tableCoupons === true,
      installHint: false,
      tableService: true,
    };
  }
  return {
    mode,
    chat,
    accountTab: accounts,
    accountLogin: accounts,
    delivery: true,
    reservations: true,
    favorites: true,
    loyalty: true,
    coupons: accounts,
    installHint: true,
    tableService: false,
  };
}

/** Telas do cardápio (/pedir/<tela>) que cada modo abre; as outras voltam para o início. */
export function storeScreenAllowed(rules: StoreRules, screen: string): boolean {
  if (screen.startsWith('conversa')) return rules.chat;
  if (screen.startsWith('favoritos')) return rules.favorites;
  if (screen.startsWith('fidelidade')) return rules.loyalty;
  if (screen.startsWith('cupons')) return rules.coupons;
  // Indique um amigo vale pontos: só onde há fidelidade.
  if (screen.startsWith('conta/indique')) return rules.loyalty;
  // Reservar e as reservas da conta (lista e acompanhamento pelo id).
  if (screen.startsWith('reservar') || screen.startsWith('reservas')) return rules.reservations;
  if (screen === 'mesa' || screen.startsWith('mesa/')) return rules.tableService;
  // Endereços salvos e a forma de pagar preferida só servem para a entrega (na mesa não há).
  if (screen.startsWith('conta/enderecos') || screen.startsWith('conta/pagamento'))
    return rules.delivery;
  return true;
}
