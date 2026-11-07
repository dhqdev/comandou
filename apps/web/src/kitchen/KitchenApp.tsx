import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from '../app/auth';
import { KitchenPage } from '../pages/KitchenPage';
import { useOnline } from '../lib/connectivity';
import { OfflineBanner } from '../app/OfflineBanner';
import { useRealtimeStatus } from '../lib/realtime';
import '../app/shell.css';
import '../app/ops.css';
import './kitchen.css';

/**
 * App da cozinha (/cozinha): o login da cozinha abre só a tela do KDS, sem menu nem outras
 * telas, com tela cheia para a TV ou o tablet. Qualquer outro endereço leva para cá.
 */
export function KitchenApp() {
  const { me, logout } = useAuth();
  const online = useOnline();
  const live = useRealtimeStatus();
  const state = !online ? 'off' : live === 'live' ? 'on' : 'wait';
  return (
    <Routes>
      <Route
        path="cozinha"
        element={
          <div className="kapp">
            <OfflineBanner />
            <KitchenPage
              standalone
              title={me?.tenant.name}
              onLogout={() => void logout()}
              status={
                <span
                  className="kapp__live"
                  data-state={state}
                  title={
                    state === 'off'
                      ? 'Sem conexão'
                      : state === 'on'
                        ? 'Tempo real'
                        : 'Reconectando…'
                  }
                >
                  <span className="kapp__live-dot" aria-hidden />
                  <span className="kapp__live-text">
                    {state === 'off' ? 'Sem conexão' : state === 'on' ? 'Ao vivo' : 'Reconectando…'}
                  </span>
                </span>
              }
            />
          </div>
        }
      />
      <Route path="*" element={<Navigate to="/cozinha" replace />} />
    </Routes>
  );
}
