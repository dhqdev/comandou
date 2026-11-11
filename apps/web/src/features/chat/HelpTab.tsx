import { useCallback, useEffect, useRef, useState } from 'react';
import { Mascot, Spinner, useToast } from '../../design-system';
import { api } from '../../lib/api';
import { useRealtimeEvents } from '../../lib/realtime';
import { ChatMessage, ChatPane, mergeMessages } from '../store-chat/ChatKit';
import { HelpMessage, HelpState, helpToKit } from '../store-chat/help-chat';

/**
 * Aba "Suporte" do chat: o dono ou gerente fala direto com a equipe da Comandou (dúvida, problema,
 * foto ou vídeo do erro). A Comandou responde pelo Super Admin › Conversas.
 */
export function HelpTab({ pollMs, onRead }: { pollMs: number; onRead(): void }) {
  const toast = useToast();
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
        <Spinner />
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
              json: { body: input.body, fileId: input.fileId ?? null },
            }),
          )
        }
        onSent={(m) => setD((x) => (x ? { ...x, messages: mergeMessages(x.messages, [m]) } : x))}
        onError={(m) => toast(m, 'danger')}
        placeholder="Escreva para a Comandou"
      />
    </div>
  );
}
