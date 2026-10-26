import { LogOut } from 'lucide-react';
import { Navigate, Route, Routes } from 'react-router';
import { Mascot, ThemeToggle } from '../design-system';
import { useAuth } from '../app/auth';
import { SoundControl } from '../features/SoundControl';
import { KitchenPage } from '../pages/KitchenPage';
import { useOnline } from '../lib/connectivity';
import { useRealtimeStatus } from '../lib/realtime';
import '../app/shell.css';
import '../app/ops.css';
import './kitchen.css';

/**
 * App da cozinha (/cozinha): o login da cozinha abre só a fila de preparo, sem menu nem outras
 * telas, com botão de tela cheia para a TV ou o tablet. Qualquer outro endereço leva para cá.
 */
export function KitchenApp() {
  const { me, logout } = useAuth();
  const online = useOnline();
  const live = useRealtimeStatus();
  return (
    <Routes>
      <Route
        path="cozinha"
        element={
          <div className="kapp">
            <header className="kapp__top">
              <Mascot size={32} badge title="Comandou" />
              <strong className="kapp__name">{me?.tenant.name}</strong>
              <span
                className="kapp__live"
                data-state={!online ? 'off' : live === 'live' ? 'on' : 'wait'}
              >
                {!online ? 'Sem conexão' : live === 'live' ? 'Tempo real' : 'Reconectando…'}
              </span>
              <span className="kapp__spacer" />
              <SoundControl only={['kitchen', 'cancel']} />
              <ThemeToggle />
              <button
                type="button"
                className="kapp__out"
                onClick={() => void logout()}
                aria-label="Sair"
              >
                <LogOut size={18} />
              </button>
            </header>
            <main className="kapp__main">
              <KitchenPage />
            </main>
          </div>
        }
      />
      <Route path="*" element={<Navigate to="/cozinha" replace />} />
    </Routes>
  );
}
