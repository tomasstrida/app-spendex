import { NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useAuth } from '../App';
import { t } from '../i18n';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Tag,
  PiggyBank,
  ClipboardList,
  CalendarRange,
  Landmark,
  Upload,
  Settings,
  LogOut,
  CopyX,
  Wallet,
  ListFilter,
  Receipt,
  SearchCheck,
} from 'lucide-react';

const navGroups = [
  {
    label: t.nav.sectionReports,
    items: [
      { to: '/',             icon: LayoutDashboard, label: t.nav.dashboard, end: true },
      { to: '/report',       icon: ClipboardList,   label: t.nav.report },
      { to: '/savings',      icon: Landmark,        label: t.nav.savings },
      { to: '/annual-budgets', icon: CalendarRange, label: t.nav.annualBudgets },
      { to: '/transactions', icon: ArrowLeftRight,  label: t.nav.transactions },
    ],
  },
  {
    label: t.nav.sectionConfig,
    bottom: true,
    items: [
      { to: '/categories', icon: Tag,        label: t.nav.categories },
      { to: '/rules',      icon: ListFilter, label: t.nav.rules },
      { to: '/fixed-expenses', icon: Receipt, label: t.nav.fixedExpenses },
      { to: '/budgets',    icon: PiggyBank, label: t.nav.budgets },
      { to: '/accounts',   icon: Wallet,    label: t.nav.accounts },
      { to: '/import',     icon: Upload,    label: t.nav.import },
      { to: '/duplicates', icon: CopyX,     label: t.nav.duplicates },
      { to: '/review',     icon: SearchCheck, label: t.nav.review },
      { to: '/settings',   icon: Settings,  label: t.nav.settings },
    ],
  },
];

export default function Sidebar({ open = false, onClose }) {
  const { user, setUser } = useAuth();
  const [version, setVersion] = useState('');

  useEffect(() => {
    fetch('/health').then(r => r.json()).then(d => setVersion(d.version || ''));
  }, []);

  async function handleLogout() {
    await fetch('/auth/logout', { method: 'POST' });
    setUser(null);
  }

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="sidebar-logo">
        <span className="sidebar-logo-mark">$</span>
        <div>
          <div className="sidebar-logo-text">Spendex</div>
          {version && <div className="sidebar-version">v{version}</div>}
        </div>
      </div>

      <nav className="sidebar-nav">
        {navGroups.map(group => (
          <div key={group.label} className={`sidebar-group${group.bottom ? ' sidebar-group-bottom' : ''}`}>
            <div className="sidebar-section-label">{group.label}</div>
            {group.items.map(({ to, icon: Icon, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={onClose}
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              >
                <Icon size={18} />
                {label}
              </NavLink>
            ))}
          </div>
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
