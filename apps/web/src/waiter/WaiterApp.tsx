import { waiterLevel } from '@comandou/shared';
import {
  CircleUserRound,
  ClipboardList,
  KeyRound,
  LayoutGrid,
  LogOut,
  Medal,
  MessagesSquare,
} from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { Modal, ThemeToggle } from '../design-system';
import { useAuth } from '../app/auth';
import { openTeamChat, useChatUnread } from '../features/chat/TeamChat';
import { api } from '../lib/api';
import { useOnline } from '../lib/connectivity';
import { rememberStaffApp } from '../lib/staff-app';
import { OfflineBanner } from '../app/OfflineBanner';
import { useDebounced, useRealtime, useRealtimeStatus } from '../lib/realtime';
import { ChangePasswordModal } from '../pages/TeamPage';
import { Seal, WaiterStats, WaiterStatsContext } from './common';
import { WaiterChallenges } from './WaiterChallenges';
import { WaiterOrder } from './WaiterOrder';
import { WaiterOrders } from './WaiterOrders';
import { WaiterTab } from './WaiterTab';
import { WaiterTables } from './WaiterTables';
import './waiter.css';

const NAV = [
  { to: '/garcom/mesas', label: 'Mesas', long: 'Mesas e comandas', icon: <LayoutGrid /> },
  { to: '/garcom/pedidos', label: 'Pedidos', long: 'Meus pedidos', icon: <ClipboardList /> },
  { to: '/garcom/desafios', label: 'Desafios', long: 'Desafios', icon: <Medal /> },
];

/**
 * App do garçom (/garcom), no molde do Anota AI e do PedidoJá: só o que o garçom usa no salão.
 * Mapa de mesas e comandas, lançar pedido (mesa, comanda, delivery ou para levar), pedir a
 * conta, transferir mesa, acompanhar os próprios pedidos e os desafios com selos. Sem caixa,
 * desconto, cancelamento direto, relatórios ou configurações (o servidor também bloqueia).
 * Celular: abas embaixo. Notebook/tablet: menu fixo à esquerda.
 */
export function WaiterApp() {
  const { me, logout } = useAuth();
  const { pathname } = useLocation();
  const online = useOnline();
  const live = useRealtimeStatus();
  const [stats, setStats] = useState<WaiterStats | null>(null);
  const [account, setAccount] = useState(false);
  const [pw, setPw] = useState(false);

  // QR da mesa lido pela câmera deste aparelho abre aqui, no app do garçom (lib/staff-app.ts).
  useEffect(() => rememberStaffApp('garcom'), []);

  const load = useCallback(() => {
    api<WaiterStats>('/waiter/me').then(setStats, () => undefined);
  }, []);
  const reload = useDebounced(load, 800);
  useEffect(load, [load]);
  useRealtime((e) => {
    if (e.type === 'order.changed') reload();
  }, load);

  const chatUnread = useChatUnread();
  // Lançando pedido ou dentro da comanda: tela cheia, sem as abas de baixo. "/garcom/pedidos"
  // (Meus pedidos) é uma aba como as outras e mantém a barra.
  const focused = /^\/garcom\/(pedido|comanda)(\/|$)/.test(pathname);
  const tab = NAV.findIndex((n) => pathname.startsWith(n.to));
  const level = waiterLevel(stats?.totalOrders ?? 0);
  const initials = (me?.user.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <WaiterStatsContext.Provider value={{ stats, reload: load }}>
      <div className="wt" data-focused={focused || undefined}>
        <aside className="wt-side" aria-label="Menu do garçom">
          <div className="wt-side__brand">
            <span className="wt-side__store">{me?.tenant.name}</span>
            <span className="wt-side__app">App do garçom</span>
          </div>
          <NavLink to="/garcom/desafios" className="wt-player">
            <Seal seal={level.seal} earned size={40} />
            <span className="wt-player__text">
              <strong>{me?.user.name}</strong>
              <span>
                {level.seal.name} · {stats?.totalOrders ?? 0} pedidos
              </span>
              <span className="wt-bar" aria-hidden>
                <span style={{ width: `${Math.round(level.progress * 100)}%` }} />
              </span>
            </span>
          </NavLink>
          <nav className="wt-side__nav">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className="wt-side__link">
                {n.icon}
                {n.long}
              </NavLink>
            ))}
          </nav>
          <div className="wt-side__foot">
            <div className="wt-side__row">
              <span>Tema</span>
              <ThemeToggle />
            </div>
            <button type="button" className="wt-side__link" onClick={() => setPw(true)}>
              <KeyRound /> Trocar senha
            </button>
            <button type="button" className="wt-side__link" onClick={() => void logout()}>
              <LogOut /> Sair
            </button>
          </div>
        </aside>

        <main className="wt-main">
          <OfflineBanner className="wt-offline" />
          {online && live === 'offline' && (
            <div className="wt-offline" role="status">
              Reconectando ao restaurante…
            </div>
          )}
          <Routes>
            <Route index element={<Navigate to="/garcom/mesas" replace />} />
            <Route path="mesas" element={<WaiterTables />} />
            <Route path="pedido" element={<WaiterOrder />} />
            <Route path="comanda/:id" element={<WaiterTab />} />
            <Route path="pedidos" element={<WaiterOrders />} />
            <Route path="desafios" element={<WaiterChallenges />} />
            <Route path="*" element={<Navigate to="/garcom/mesas" replace />} />
          </Routes>
        </main>

        <nav
          className="wt-tabs"
          aria-label="Telas do garçom"
          style={{ '--wt-tab': tab } as CSSProperties}
          data-tab={tab >= 0 ? tab : undefined}
        >
          <span className="wt-tabs__pill" aria-hidden />
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className="wt-tabs__item">
              {n.icon}
              <span>{n.label}</span>
            </NavLink>
          ))}
          {/* No celular o chat da equipe fica aqui, não num botão por cima dos preços. */}
          <button
            type="button"
            className="wt-tabs__item"
            onClick={() => openTeamChat()}
            aria-label={chatUnread > 0 ? `Chat, ${chatUnread} não lidas` : 'Chat'}
          >
            <MessagesSquare />
            <span>Chat</span>
            {chatUnread > 0 && (
              <b className="wt-tabs__badge" aria-hidden>
                {chatUnread > 99 ? '99+' : chatUnread}
              </b>
            )}
          </button>
          <button type="button" className="wt-tabs__item" onClick={() => setAccount(true)}>
            <CircleUserRound />
            <span>Conta</span>
          </button>
        </nav>
      </div>

      <Modal open={account} onClose={() => setAccount(false)} title="Conta">
        <div className="wt-account">
          <div className="wt-account__who">
            <span className="wt-avatar" aria-hidden>
              {initials}
            </span>
            <span>
              <strong>{me?.user.name}</strong>
              <span className="cm-hint">
                {me?.user.roleLabel} · {me?.tenant.name}
              </span>
            </span>
          </div>
          <div className="wt-side__row">
            <span>Tema</span>
            <ThemeToggle />
          </div>
          <button
            type="button"
            className="wt-side__link"
            onClick={() => {
              setAccount(false);
              setPw(true);
            }}
          >
            <KeyRound /> Trocar senha
          </button>
          <button type="button" className="wt-side__link" onClick={() => void logout()}>
            <LogOut /> Sair
          </button>
        </div>
      </Modal>
      <ChangePasswordModal open={pw} onClose={() => setPw(false)} />
    </WaiterStatsContext.Provider>
  );
}
