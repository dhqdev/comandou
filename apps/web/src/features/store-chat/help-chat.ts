import type { ChatMessage, ChatTicket } from './chat-media';

/**
 * Conversa do restaurante com a Comandou (suporte da plataforma). Usa a mesma conversa (ChatKit)
 * do cardápio: o restaurante fica no lugar do "cliente" e a Comandou no da "equipe".
 */
export interface HelpMessage {
  id: string;
  sender: 'tenant' | 'admin' | 'system';
  authorName: string | null;
  body: string;
  file: ChatMessage['file'];
  fileGone: ChatMessage['fileGone'];
  ticket?: ChatTicket | null;
  createdAt: string;
}

export interface HelpState {
  status: 'open' | 'closed';
  messages: HelpMessage[];
  hasMore: boolean;
  otherReadAt: string | null;
  unread: number;
}

export function helpToKit(m: HelpMessage): ChatMessage {
  return {
    ...m,
    sender: m.sender === 'tenant' ? 'customer' : m.sender === 'admin' ? 'staff' : 'system',
    orderNumber: null,
    orderId: null,
  };
}
