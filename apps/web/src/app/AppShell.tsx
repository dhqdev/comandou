import {
  BarChart3,
  BookOpen,
  Boxes,
  ChefHat,
  ClipboardList,
  LayoutGrid,
  LogOut,
  Menu,
  Receipt,
  Settings,
  Store,
  Truck,
  Users,
  Wallet,
  WifiOff,
} from 'lucide-react';
import { ReactNode, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { Badge, Button } from '../design-system';
import { useOnline } from '../lib/connectivity';
import { useRealtimeStatus } from '../lib/realtime';
import { useAuth } from './auth';
import './shell.css';
import './ops.css';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  soon?: boolean;
  /** Mostra o item se o usuário tiver ao menos uma destas permissões. */
  perms?: string[];
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Operação',
    items: [
      { to: '/', label: 'PDV', icon: <Store size={18} /> },
      {
        to: '/pedidos',
        label: 'Pedidos',
        icon: <ClipboardList size={18} />,
        perms: ['orders:read'],
      },
      {
        to: '/mesas',
        label: 'Salão',
        icon: <LayoutGrid size={18} />,
        perms: ['tables:operate', 'payments:create'],
      },
      {
        to: '/cozinha',
        label: 'Cozinha',
        icon: <ChefHat size={18} />,
        perms: ['kitchen:operate', 'orders:read'],
      },
      {
        to: '/caixa',
        label: 'Caixa',
        icon: <Wallet size={18} />,
        perms: ['cash:operate', 'cash:close', 'reports:read'],
      },
      { to: '/entregas', label: 'Entregas', icon: <Truck size={18} />, soon: true },
    ],
  },
  {
    group: 'Gestão',
    items: [
      { to: '/cardapio', label: 'Cardápio', icon: <BookOpen size={18} /> },
      { to: '/clientes', label: 'Clientes', icon: <Users size={18} />, soon: true },
      { to: '/estoque', label: 'Estoque', icon: <Boxes size={18} />, soon: true },
      { to: '/financeiro', label: 'Financeiro', icon: <Receipt size={18} />, soon: true },
      {
        to: '/relatorios',
        label: 'Relatórios',
        icon: <BarChart3 size={18} />,
        perms: ['reports:read'],
      },
      {
        to: '/configuracoes',
        label: 'Ajustes',
        icon: <Settings size={18} />,
        perms: ['settings:manage', 'orders:read'],
      },
    ],
  },
];

export function AppShell() {
  const { me, logout } = useAuth();
  const online = useOnline();
  const live = useRealtimeStatus();
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = (me?.user.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="shell" data-menu={menuOpen ? 'open' : 'closed'}>
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="brand">
          <div className="brand__mark" aria-hidden>
            P+
          </div>
          <div>
            <div className="brand__name">PedeMais</div>
            <div className="brand__tenant">{me?.tenant.name}</div>
          </div>
        </div>
        {NAV.map((g) => (
          <nav key={g.group} aria-label={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items
              .filter((item) => !item.perms || item.perms.some((p) => me?.permissions.includes(p)))
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.icon}
                  {item.label}
                  {item.soon && <Badge>em breve</Badge>}
                </NavLink>
              ))}
          </nav>
        ))}
        <div className="sidebar__footer">
          <div className="user-chip">
            <div className="user-chip__avatar" aria-hidden>
              {initials}
            </div>
            <div>
              <div>{me?.user.name}</div>
              <div className="brand__tenant">{me?.user.roleLabel}</div>
            </div>
          </div>
          <button
            className="nav-link"
            style={{ border: 0, background: 'none', cursor: 'pointer' }}
            onClick={logout}
          >
            <LogOut size={18} /> Sair
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Button
            variant="ghost"
            className="menu-toggle"
            aria-label="Abrir menu"
            onClick={() => setMenuOpen((v) => !v)}
            icon={<Menu size={20} />}
          />
          <div className="topbar__search">
            <input
              className="pm-input"
              placeholder="Buscar mesa, comanda, pedido ou cliente…"
              aria-label="Buscar"
            />
          </div>
          <div className="topbar__spacer" />
          {!online ? (
            <Badge tone="warning">Sem conexão</Badge>
          ) : live === 'live' ? (
            <Badge tone="success">● Tempo real</Badge>
          ) : (
            <Badge tone="warning">Reconectando…</Badge>
          )}
        </header>
        {!online && (
          <div className="offline-banner" role="status">
            <WifiOff size={14} style={{ verticalAlign: -2 }} /> Você está offline. Pagamentos, caixa
            e confirmação de pedidos ficam bloqueados até a conexão voltar.
          </div>
        )}
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
