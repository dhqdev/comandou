import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Mascot, useToast, Skeleton } from '../../design-system';
import { api } from '../../lib/api';
import { useRealtimeEvents } from '../../lib/realtime';
import { ChatMessage, ChatPane, mergeMessages } from '../store-chat/ChatKit';
import type { ChatTicket } from '../store-chat/chat-media';
import { HelpMessage, HelpState, helpToKit } from '../store-chat/help-chat';

interface TicketRow {
  id: string;
  code: string;
  title: string;
  statusLabel: string;
  done: boolean;
}

/**
 * Aba "Suporte" do chat: o dono ou gerente fala direto com a equipe da Comandou (dúvida, problema,
 * foto ou vídeo do erro). A Comandou responde pelo Super Admin › Conversas.
 */
export function HelpTab({
  pollMs,
  onRead,
  ticket,
  onTicket,
}: {
  pollMs: number;
  onRead(): void;
  /** Chamado que já vem citado (botão "Falar no chat" do chamado). */
  ticket?: ChatTicket | null;
  /** Abriu um chamado pelo cartão da mensagem. */
  onTicket?(): void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  // Chamados do restaurante para citar pelo clipe (os abertos primeiro).
  const [tickets, setTickets] = useState<ChatTicket[] | undefined>(undefined);
  useEffect(() => {
    api<TicketRow[]>('/support/tickets')
      .then((rows) =>
        setTickets(
          [...rows]
            .sort((a, b) => Number(a.done) - Number(b.done))
            .map((r) => ({
              id: r.id,
              code: r.code,
              title: r.title,
              statusLabel: r.statusLabel,
              done: r.done,
            })),
        ),
      )
      .catch(() => setTickets(undefined));
  }, []);
  const [d, setD] = useState<{
    messages: ChatMessage[];
    hasMore: boolean;
    otherReadAt: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const load = useCallback(async () => {
    try {
      const s = await api<HelpState>('/help/chat');
      setError(null);
      setD((x) => ({
        // Mantém as antigas já carregadas ao rolar para cima.
        messages: mergeMessages(x?.messages ?? [], s.messages.map(helpToKit)),
        hasMore: x && x.messages.length > s.messages.length ? x.hasMore : s.hasMore,
        otherReadAt: s.otherReadAt,
      }));
      if (s.unread > 0) await api('/help/chat/read', { method: 'POST' }).catch(() => undefined);
      onReadRef.current();
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => !document.hidden && void load(), pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  useRealtimeEvents((e) => {
    if (e.type === 'help.message' || e.type === 'help.read') void load();
  });

  if (error && !d)
    return (
      <div className="tc-placeholder">
        <p>{error}</p>
      </div>
    );
  if (!d)
    return (
      <div className="tc-placeholder">
        <Skeleton variant="chat" />
      </div>
    );

  return (
    <div className="tc-help">
      <header className="tc-help__head">
        <Mascot size={36} badge />
        <div className="tc-help__who">
          <strong>Suporte Comandou</strong>
          <small>Fale direto com a nossa equipe</small>
        </div>
      </header>
      <ChatPane
        side="customer"
        names={{ staff: 'Suporte Comandou' }}
        messages={d.messages}
        hasMore={d.hasMore}
        otherReadAt={d.otherReadAt}
        greeting={
          <>
            <strong>Como podemos ajudar?</strong>
            Conte o que aconteceu. Se for um erro, mande uma foto ou um vídeo da tela: ajuda a
            resolver mais rápido. Respondemos por aqui mesmo.
          </>
        }
        onLoadMore={async () => {
          const first = d.messages[0];
          if (!first) return;
          const older = await api<{ messages: HelpMessage[]; hasMore: boolean }>(
            `/help/chat/messages?before=${encodeURIComponent(first.createdAt)}`,
          );
          setD((x) =>
            x
              ? {
                  ...x,
                  messages: mergeMessages(older.messages.map(helpToKit), x.messages),
                  hasMore: older.hasMore,
                }
              : x,
          );
        }}
        uploadPath="/help/chat/files"
        send={async (input) =>
          helpToKit(
            await api<HelpMessage>('/help/chat/messages', {
              method: 'POST',
              json: {
                body: input.body,
                fileId: input.fileId ?? null,
                ticketId: input.ticketId ?? null,
              },
            }),
          )
        }
        tickets={tickets}
        initialTicket={ticket}
        onTicket={(t) => {
          navigate(`/chamados/${t.id}`);
          onTicket?.();
        }}
        onSent={(m) => setD((x) => (x ? { ...x, messages: mergeMessages(x.messages, [m]) } : x))}
        onError={(m) => toast(m, 'danger')}
        placeholder="Escreva para a Comandou"
      />
    </div>
  );
}
