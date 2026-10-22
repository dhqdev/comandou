import {
  BarChart3,
  BookOpen,
  CreditCard,
  Boxes,
  ChefHat,
  ClipboardList,
  LayoutGrid,
  LogOut,
  KeyRound,
  Menu,
  MessageCircle,
  FileText,
  Printer,
  Receipt,
  UserCog,
  Settings,
  Sparkles,
  Store,
  Truck,
  Users,
  Wallet,
  WifiOff,
} from 'lucide-react';
import { ReactNode, useState } from 'react';
import { CURRENT_RELEASE } from '@comandou/shared';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Badge, Button, Logo, useGlider } from '../design-system';
import { useOnline } from '../lib/connectivity';
import { useRealtimeStatus } from '../lib/realtime';
import { useHasUnseenRelease } from '../lib/releases';
import { ChangePasswordModal } from '../pages/TeamPage';
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
      {
        to: '/entregas',
        label: 'Entregas',
        icon: <Truck size={18} />,
        perms: ['delivery:manage', 'delivery:operate'],
      },
    ],
  },
  {
    group: 'Gestão',
    items: [
      { to: '/cardapio', label: 'Cardápio', icon: <BookOpen size={18} /> },
      { to: '/clientes', label: 'Clientes', icon: <Users size={18} />, soon: true },
      { to: '/estoque', label: 'Estoque', icon: <Boxes size={18} />, perms: ['stock:read'] },
      {
        to: '/financeiro',
        label: 'Financeiro',
        icon: <Receipt size={18} />,
        perms: ['finance:read'],
      },
      {
        to: '/relatorios',
        label: 'Relatórios',
        icon: <BarChart3 size={18} />,
        perms: ['reports:read'],
      },
      { to: '/equipe', label: 'Equipe', icon: <UserCog size={18} />, perms: ['users:manage'] },
      {
        to: '/impressao',
        label: 'Impressão',
        icon: <Printer size={18} />,
        perms: ['printing:manage'],
      },
      {
        to: '/nota-fiscal',
        label: 'Nota fiscal',
        icon: <FileText size={18} />,
        perms: ['fiscal:emit', 'fiscal:manage'],
      },
      {
        to: '/whatsapp',
        label: 'WhatsApp',
        icon: <MessageCircle size={18} />,
        perms: ['messaging:manage'],
      },
      {
        to: '/plano',
        label: 'Plano e domínio',
        icon: <CreditCard size={18} />,
        perms: ['plan:read', 'domains:manage'],
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
  const unseen = useHasUnseenRelease();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const location = useLocation();
  const nav = useGlider<HTMLDivElement>({ selector: '.nav-link.active' });
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
          <Logo size={30} />
          <div className="brand__tenant" title={me?.tenant.name}>
            {me?.tenant.name}
          </div>
        </div>
        <div className="sidebar__nav cm-glide" ref={nav.ref}>
          {NAV.map((g) => (
            <nav key={g.group} aria-label={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items
                .filter(
                  (item) => !item.perms || item.perms.some((p) => me?.permissions.includes(p)),
                )
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
          {nav.glider}
        </div>
        <div className="sidebar__footer">
          <NavLink
            to="/novidades"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={() => setMenuOpen(false)}
          >
            <Sparkles size={18} />
            Novidades
            <Badge tone={unseen ? 'warning' : 'neutral'}>v{CURRENT_RELEASE.version}</Badge>
          </NavLink>
          <div className="user-chip">
            <div className="user-chip__avatar" aria-hidden>
              {initials}
            </div>
            <div className="user-chip__who">
              <div>{me?.user.name}</div>
              <div className="brand__tenant">{me?.user.roleLabel}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Trocar senha"
              title="Trocar senha"
              onClick={() => setPwOpen(true)}
              icon={<KeyRound size={16} />}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label="Sair"
              title="Sair"
              onClick={logout}
              icon={<LogOut size={16} />}
            />
          </div>
        </div>
      </aside>
      <div className="scrim" aria-hidden onClick={() => setMenuOpen(false)} />
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
              className="cm-input"
              placeholder="Buscar mesa, comanda, pedido ou cliente…"
              aria-label="Buscar"
            />
          </div>
          <div className="topbar__spacer" />
          {!online ? (
            <Badge tone="warning">Sem conexão</Badge>
          ) : live === 'live' ? (
            <Badge tone="success">
              <span className="cm-dot cm-dot--pulse" /> Tempo real
            </Badge>
          ) : (
            <Badge tone="warning">Reconectando…</Badge>
          )}
        </header>
        {me?.support && (
          <div className="offline-banner support-banner" role="status">
            Acesso de suporte: {me.support.adminName} entrou como {me.user.name}. Tudo fica
            registrado. <button onClick={logout}>Encerrar acesso</button>
          </div>
        )}
        {!online && (
          <div className="offline-banner" role="status">
            <WifiOff size={14} style={{ verticalAlign: -2 }} /> Você está offline. Pagamentos, caixa
            e confirmação de pedidos ficam bloqueados até a conexão voltar.
          </div>
        )}
        {/* A chave reinicia a animação de entrada a cada troca de tela. */}
        <main className="content cm-enter" key={location.pathname}>
          <Outlet />
        </main>
        <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      </div>
    </div>
  );
}
