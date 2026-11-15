import {
  ChevronRight,
  LifeBuoy,
  MessageCircle,
  MessagesSquare,
  Sparkles,
  Users,
} from 'lucide-react';
import { ReactNode, useState } from 'react';
import { useCan } from '../../app/auth';
import { Sheet } from '../../design-system';
import { openSupportInbox, useSupportUnread } from '../store-chat/SupportInbox';
import { openTeamChat, useChatUnreadParts } from './TeamChat';

interface Choice {
  key: string;
  icon: ReactNode;
  title: string;
  detail: string;
  badge: number;
  open: () => void;
}

const count = (n: number) => (n > 99 ? '99+' : String(n));

/**
 * Celular: dois botões no topo, ao lado do sino, no lugar do botão redondo de baixo.
 * "IA" abre o assistente. "Chat" junta todas as conversas: com a equipe, com os clientes do
 * delivery e com o suporte da Comandou. Com mais de uma, abre uma folha que diz o que é cada
 * uma; com só a da equipe, abre direto. Cada botão tem a palavra embaixo do ícone.
 * No computador não aparecem: lá o chat continua no botão do canto.
 */
export function ChatTopButtons() {
  const { team, help, helpOn } = useChatUnreadParts();
  const canCustomers = useCan('orders:manage');
  const { chats } = useSupportUnread();
  const [pick, setPick] = useState(false);

  const choices: Choice[] = [
    {
      key: 'equipe',
      icon: <Users size={20} />,
      title: 'Equipe',
      detail: 'Conversas, mural e avisos com quem trabalha com você',
      badge: team,
      open: () => openTeamChat('conversas'),
    },
    ...(canCustomers
      ? [
          {
            key: 'clientes',
            icon: <MessageCircle size={20} />,
            title: 'Clientes',
            detail: 'Mensagens de quem pede pelo seu cardápio online',
            badge: chats,
            open: () => openSupportInbox(),
          },
        ]
      : []),
    ...(helpOn
      ? [
          {
            key: 'suporte',
            icon: <LifeBuoy size={20} />,
            title: 'Suporte Comandou',
            detail: 'Fale com a gente: dúvidas, ajustes e problemas',
            badge: help,
            open: () => openTeamChat('suporte'),
          },
        ]
      : []),
  ];
  const unread = choices.reduce((n, c) => n + c.badge, 0);

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
        onClick={() => (choices.length > 1 ? setPick(true) : choices[0].open())}
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
      <Sheet open={pick} title="Com quem você quer falar?" onClose={() => setPick(false)}>
        <div className="tc-pick">
          {choices.map((c) => (
            <button
              key={c.key}
              type="button"
              className="tc-pick__item"
              onClick={() => {
                setPick(false);
                c.open();
              }}
            >
              <span className="tc-pick__icon" aria-hidden>
                {c.icon}
              </span>
              <span className="tc-pick__text">
                <strong>{c.title}</strong>
                <small>{c.detail}</small>
              </span>
              {c.badge > 0 && (
                <span className="tc-pick__badge" aria-label={`${c.badge} não lidas`}>
                  {count(c.badge)}
                </span>
              )}
              <ChevronRight size={18} className="tc-pick__go" aria-hidden />
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}
