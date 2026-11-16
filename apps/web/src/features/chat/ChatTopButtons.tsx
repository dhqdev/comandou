import { MessagesSquare, Sparkles } from 'lucide-react';
import { useCan } from '../../app/auth';
import { useSupportUnread } from '../store-chat/SupportInbox';
import { openTeamChat, useChatUnreadParts } from './TeamChat';

const count = (n: number) => (n > 99 ? '99+' : String(n));

/**
 * Dois botões no topo, ao lado do sino (celular e computador).
 * "IA" abre só o assistente, direto. "Chat" abre o painel de conversas já numa conversa, com
 * as abas da equipe, dos clientes do cardápio online e do suporte da Comandou ao lado.
 */
export function ChatTopButtons() {
  const { team, help } = useChatUnreadParts();
  const canCustomers = useCan('orders:manage');
  const { chats } = useSupportUnread();
  const unread = team + help + (canCustomers ? chats : 0);

  return (
    <>
      <button
        type="button"
        className="tc-top tc-top--ai"
        onClick={() => openTeamChat('ia')}
        aria-label="Assistente de IA: tire dúvidas e peça ajuda"
        title="Assistente de IA"
      >
        <Sparkles size={18} aria-hidden />
        <span className="tc-top__label" aria-hidden>
          IA
        </span>
      </button>
      <button
        type="button"
        className="tc-top"
        onClick={() => openTeamChat('conversas')}
        aria-label={unread ? `Chat: ${unread} não ${unread === 1 ? 'lida' : 'lidas'}` : 'Chat'}
        title="Chat com a equipe, clientes e suporte"
      >
        <MessagesSquare size={18} aria-hidden />
        <span className="tc-top__label" aria-hidden>
          Chat
        </span>
        {unread > 0 && (
          <span className="tc-top__badge" aria-hidden>
            {count(unread)}
          </span>
        )}
      </button>
    </>
  );
}
