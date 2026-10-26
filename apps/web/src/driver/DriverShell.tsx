import { LogOut } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { Alert, Mascot, Spinner, ThemeToggle } from '../design-system';
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
  children,
}: {
  name: string | null;
  restaurant: string | null;
  error?: string | null;
  loading?: boolean;
  onLogout?: () => void;
  children: ReactNode;
}) {
  return (
    <main className="courier-page">
      <div className="courier-page__inner">
        <header className="courier-page__head">
          <Mascot size={40} badge title="Comandou" />
          <div>
            <strong>{name ? `Olá, ${name.split(' ')[0]}` : 'Entregas'}</strong>
            <span className="cm-hint">{restaurant ?? 'Painel do entregador'}</span>
          </div>
          <SoundControl only={['courier']} />
          <ThemeToggle />
          {onLogout && (
            <button type="button" className="dshell__out" onClick={onLogout} aria-label="Sair">
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
