import { NavLink } from 'react-router-dom';
import { useAuth } from '../App';
import { t } from '../i18n';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Tag,
  PiggyBank,
  LogOut,
} from 'lucide-react';

const navItems = [
  { to: '/',             icon: LayoutDashboard, label: t.nav.dashboard,     end: true },
  { to: '/transactions', icon: ArrowLeftRight,  label: t.nav.transactions },
  { to: '/categories',   icon: Tag,             label: t.nav.categories },
  { to: '/budgets',      icon: PiggyBank,       label: t.nav.budgets },
];

export default function Sidebar() {
  const { user, setUser } = useAuth();

  async function handleLogout() {
    await fetch('/auth/logout', { method: 'POST' });
    setUser(null);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-mark">S</span>
        <span className="sidebar-logo-text">Spendex</span>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar">{(user?.name || user?.email || '?')[0].toUpperCase()}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.name || user?.email}</div>
            {user?.name && <div className="sidebar-user-email">{user.email}</div>}
          </div>
        </div>
        <button className="sidebar-logout" onClick={handleLogout} title={t.common.logout}>
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}
