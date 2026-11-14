import { LogOut, MessagesSquare } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { Alert, Mascot, Spinner, ThemeToggle } from '../design-system';
import { openTeamChat, useChatUnread } from '../features/chat/TeamChat';
import { SoundControl } from '../features/SoundControl';
import { DriverGate } from './DriverGate';
import '../app/shell.css';
import '../app/ops.css';
import './driver.css';

/**
 * Moldura do app do entregador (com login ou pelo link): só o nome, o som, o tema e as corridas.
 * Sem menu, busca ou outras telas da loja.
 */
export function DriverShell({
  name,
  restaurant,
  error,
  loading,
  onLogout,
  chat,
  children,
}: {
  name: string | null;
  restaurant: string | null;
  error?: string | null;
  loading?: boolean;
  onLogout?: () => void;
  /** Mostra o botão do chat da equipe (só no app com login; o link não tem chat). */
  chat?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="courier-page">
      <div className="courier-page__inner">
        <header className="courier-page__head">
          <Mascot size={40} badge title="Comandou" className="courier-page__logo" />
          <div>
            <strong>{name ? `Olá, ${name.split(' ')[0]}` : 'Entregas'}</strong>
            <span className="cm-hint">{restaurant ?? 'Painel do entregador'}</span>
          </div>
          {chat && <ChatButton />}
          <SoundControl only={['courier']} />
          <ThemeToggle />
          {onLogout && (
            <button type="button" className="dshell__btn" onClick={onLogout} aria-label="Sair">
              <LogOut size={18} />
            </button>
          )}
        </header>
        <DriverGate>
          {error && <Alert tone={loading ? 'danger' : 'warning'}>{error}</Alert>}
          {loading ? !error && <Spinner /> : children}
        </DriverGate>
      </div>
    </main>
  );
}

/** Chat da equipe no cabeçalho, com a bolinha de não lidas (no lugar do botão redondo flutuante). */
function ChatButton() {
  const unread = useChatUnread();
  return (
    <button
      type="button"
      className="dshell__btn"
      onClick={() => openTeamChat()}
      aria-label={unread > 0 ? `Chat da equipe, ${unread} não lidas` : 'Chat da equipe'}
    >
      <MessagesSquare size={18} />
      {unread > 0 && (
        <b className="dshell__badge" aria-hidden>
          {unread > 99 ? '99+' : unread}
        </b>
      )}
    </button>
  );
}

/** Recarrega a cada 15 s e quando a tela volta a aparecer (o app do motoboy não usa tempo real). */
export function usePolling(load: () => Promise<unknown>) {
  useEffect(() => {
    void load();
    const id = setInterval(load, 15_000);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);
}
