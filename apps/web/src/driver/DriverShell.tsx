import { LogOut, MessagesSquare } from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { Alert, BRAND_CACHED_EVENT, cachedBranding, Skeleton } from '../design-system';
import { openTeamChat, useChatUnread } from '../features/chat/TeamChat';
import { SoundControl } from '../features/SoundControl';
import { OfflineBanner } from '../app/OfflineBanner';
import { DriverGate } from './DriverGate';
import '../app/shell.css';
import '../app/ops.css';
import './driver.css';

/** O que o painel (aba Perfil) usa da moldura: o Sair e o aviso de que já está na tela. */
interface ShellCtx {
  onLogout?: () => void;
  /** O painel avisa que montou: o Sair sai do topo e passa para a aba Perfil. */
  setPanel(on: boolean): void;
}
const DriverShellContext = createContext<ShellCtx>({ setPanel: () => undefined });

/** O painel avisa a moldura que abriu (o Sair do topo passa para a aba Perfil). */
export function useDriverPanelMounted() {
  const ctx = useContext(DriverShellContext);
  useEffect(() => {
    ctx.setPanel(true);
    return () => ctx.setPanel(false);
  }, [ctx]);
}

/** Sair da conta, para a aba Perfil (sem login, pelo link, não existe). */
export function useDriverShell() {
  return useContext(DriverShellContext);
}

/**
 * Moldura do app do entregador (com login ou pelo link): no topo o ícone da loja (favicon, senão
 * o logo), o nome do entregador e da loja, o som e o chat. Tema e Sair ficam na aba Perfil
 * (antes do painel abrir, o Sair aparece no topo). Sem menu, busca ou outras telas da loja.
 */
export function DriverShell({
  name,
  restaurant,
  error,
  loading,
  onLogout,
  chat,
  preview,
  children,
}: {
  name: string | null;
  restaurant: string | null;
  error?: string | null;
  loading?: boolean;
  onLogout?: () => void;
  /** Mostra o botão do chat da equipe (só no app com login; o link não tem chat). */
  chat?: boolean;
  /**
   * Prévia do administrador (Equipe › Abrir): a faixa de cima explica e a tela abre sem pedir a
   * localização (a prévia não manda GPS).
   */
  preview?: ReactNode;
  children: ReactNode;
}) {
  const [panel, setPanel] = useState(false);
  const [ctx] = useState<ShellCtx>(() => ({ onLogout, setPanel }));
  ctx.onLogout = onLogout;
  return (
    <main className="courier-page">
      <div className="courier-page__inner">
        <header className="courier-page__head">
          <StoreIcon name={restaurant} />
          <div className="courier-page__who">
            <strong>{name ? `Olá, ${name.split(' ')[0]}` : 'Entregas'}</strong>
            <span>{restaurant ?? 'Painel do entregador'}</span>
          </div>
          <div className="courier-page__tools">
            <SoundControl only={['courier']} />
            {chat && <ChatButton />}
            {onLogout && !panel && (
              <button type="button" className="dshell__btn" onClick={onLogout} aria-label="Sair">
                <LogOut size={18} />
              </button>
            )}
          </div>
        </header>
        <OfflineBanner className="offline-banner courier-page__offline" />
        <DriverShellContext.Provider value={ctx}>
          {preview ? (
            <>
              {preview}
              {error && <Alert tone={loading ? 'danger' : 'warning'}>{error}</Alert>}
              {loading ? !error && <Skeleton /> : children}
            </>
          ) : (
            <DriverGate>
              {error && <Alert tone={loading ? 'danger' : 'warning'}>{error}</Alert>}
              {loading ? !error && <Skeleton /> : children}
            </DriverGate>
          )}
        </DriverShellContext.Provider>
      </div>
    </main>
  );
}

/** Ícone da loja (favicon, senão o logo); sem nenhum, a inicial do nome na cor da marca. */
function StoreIcon({ name }: { name: string | null }) {
  const pick = () => {
    const b = cachedBranding();
    return b?.faviconUrl || b?.logoUrl || null;
  };
  const [icon, setIcon] = useState(pick);
  const [broken, setBroken] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setIcon(pick());
    window.addEventListener(BRAND_CACHED_EVENT, sync);
    return () => window.removeEventListener(BRAND_CACHED_EVENT, sync);
  }, []);
  if (icon && broken !== icon)
    return (
      <img
        className="courier-page__logo"
        src={icon}
        alt=""
        width={40}
        height={40}
        decoding="async"
        onError={() => setBroken(icon)}
      />
    );
  return (
    <span className="courier-page__logo courier-page__logo--initial" aria-hidden>
      {(name?.trim()[0] ?? 'C').toUpperCase()}
    </span>
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
