/**
 * Regras de cada cardápio do cliente. O mesmo cardápio online abre de dois jeitos:
 *
 * - **Mesa** (`table`): o cliente leu o QR Code da mesa e já está sentado. Ele só escolhe, envia e
 *   acompanha; a conversa com a loja, a entrega, a retirada, a reserva, os favoritos, a fidelidade
 *   e o aviso de instalar o app ficam de fora (quem resolve qualquer coisa é o garçom). A conta do
 *   cliente só aparece quando ele escolhe pagar pelo Pix no app, que pede login.
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
  /** Aba e botão da conta do cliente (o login do Pix na mesa continua, só pelo pagamento). */
  accountTab: boolean;
  /** Entrega e retirada (endereço, taxa, pedido mínimo, motoboy). */
  delivery: boolean;
  /** Reservar mesa. */
  reservations: boolean;
  /** Aba Favoritos e o coração dos produtos. */
  favorites: boolean;
  /** Faixa e tela da fidelidade. */
  loyalty: boolean;
  /** Aviso de instalar o cardápio como app. */
  installHint: boolean;
}

/** Ligado pela loja em Loja online (o cardápio de mesa ainda filtra por cima). */
export interface StoreToggles {
  chatEnabled?: boolean | null;
  accountsEnabled?: boolean | null;
}

export function storeRules(mode: StoreMode, t: StoreToggles = {}): StoreRules {
  const chat = t.chatEnabled !== false;
  const accounts = !!t.accountsEnabled;
  if (mode === 'table')
    return {
      mode,
      chat: false,
      accountTab: false,
      delivery: false,
      reservations: false,
      favorites: false,
      loyalty: false,
      installHint: false,
    };
  return {
    mode,
    chat,
    accountTab: accounts,
    delivery: true,
    reservations: true,
    favorites: true,
    loyalty: true,
    installHint: true,
  };
}

/** Telas do cardápio (/pedir/<tela>) que cada modo abre; as outras voltam para o início. */
export function storeScreenAllowed(rules: StoreRules, screen: string): boolean {
  if (screen.startsWith('conversa')) return rules.chat;
  if (screen.startsWith('favoritos')) return rules.favorites;
  if (screen.startsWith('fidelidade')) return rules.loyalty;
  if (screen.startsWith('reservar')) return rules.reservations;
  return true;
}
