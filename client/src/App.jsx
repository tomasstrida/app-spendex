import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useState, useEffect, createContext, useContext } from 'react';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPage from './pages/ForgotPage';
import ResetPage from './pages/ResetPage';
import DashboardPage from './pages/DashboardPage';
import TransactionsPage from './pages/TransactionsPage';
import CategoriesPage from './pages/CategoriesPage';
import BudgetsPage from './pages/BudgetsPage';
import ImportPage from './pages/ImportPage';
import SettingsPage from './pages/SettingsPage';
import ReportPage from './pages/ReportPage';
import SavingsPage from './pages/SavingsPage';
import AnnualBudgetsPage from './pages/AnnualBudgetsPage';
import DuplicatesPage from './pages/DuplicatesPage';
import AccountsPage from './pages/AccountsPage';
import RulesPage from './pages/RulesPage';
import FixedExpensesPage from './pages/FixedExpensesPage';
import { PeriodProvider } from './contexts/PeriodContext';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    fetch('/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(u => setUser(u))
      .catch(() => setUser(null));
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

function RequireAuth({ children }) {
  const { user } = useAuth();
  if (user === undefined) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function GuestOnly({ children }) {
  const { user } = useAuth();
  if (user === undefined) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
}

const R = ({ el }) => <RequireAuth>{el}</RequireAuth>;

// Klik na push notifikaci → service worker pošle {type:'navigate'} → přesměrujeme
// přes router (spolehlivé i když je appka už otevřená na jiné stránce).
function SwNavigationBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event) => {
      const d = event.data;
      if (!d || d.type !== 'navigate' || !d.url) return;
      let target = d.url;
      try { target = new URL(d.url, window.location.origin).pathname + new URL(d.url, window.location.origin).search; } catch (_e) { /* použij raw */ }
      navigate(target);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);
  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <PeriodProvider>
          <SwNavigationBridge />
          <Routes>
            <Route path="/login"    element={<GuestOnly><LoginPage /></GuestOnly>} />
            <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
            <Route path="/forgot"   element={<GuestOnly><ForgotPage /></GuestOnly>} />
            <Route path="/reset"    element={<ResetPage />} />
            <Route path="/"             element={<R el={<DashboardPage />} />} />
            <Route path="/transactions" element={<R el={<TransactionsPage />} />} />
            <Route path="/categories"   element={<R el={<CategoriesPage />} />} />
            <Route path="/rules"        element={<R el={<RulesPage />} />} />
            <Route path="/fixed-expenses" element={<R el={<FixedExpensesPage />} />} />
            <Route path="/budgets"      element={<R el={<BudgetsPage />} />} />
            <Route path="/report"       element={<R el={<ReportPage />} />} />
            <Route path="/savings"      element={<R el={<SavingsPage />} />} />
            <Route path="/annual-budgets" element={<R el={<AnnualBudgetsPage />} />} />
            <Route path="/accounts"     element={<R el={<AccountsPage />} />} />
            <Route path="/import"       element={<R el={<ImportPage />} />} />
            <Route path="/duplicates"  element={<R el={<DuplicatesPage />} />} />
            <Route path="/settings"     element={<R el={<SettingsPage />} />} />
          </Routes>
        </PeriodProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}
